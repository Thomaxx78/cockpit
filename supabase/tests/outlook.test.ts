// Tests de l'import Outlook (flux ICS au format Exchange), sans réseau.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import ICAL from 'ical.js';
import { parseOutlook, planSync, stableId, type ExistingEvent } from '../functions/outlook-sync/sync.ts';

// Fuseau Windows tel que publié par Exchange (« Romance Standard Time » = Paris)
const TZ = `BEGIN:VTIMEZONE
TZID:Romance Standard Time
BEGIN:STANDARD
DTSTART:16010101T030000
TZOFFSETFROM:+0200
TZOFFSETTO:+0100
RRULE:FREQ=YEARLY;INTERVAL=1;BYDAY=-1SU;BYMONTH=10
END:STANDARD
BEGIN:DAYLIGHT
DTSTART:16010101T020000
TZOFFSETFROM:+0100
TZOFFSETTO:+0200
RRULE:FREQ=YEARLY;INTERVAL=1;BYDAY=-1SU;BYMONTH=3
END:DAYLIGHT
END:VTIMEZONE`;

const cal = (...events: string[]) => ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:Microsoft Exchange Server 2010', TZ, ...events, 'END:VCALENDAR'].join('\r\n');
const vevent = (lines: string) => `BEGIN:VEVENT\r\n${lines.trim().split('\n').map(l => l.trim()).join('\r\n')}\r\nEND:VEVENT`;

const ICS = cal(
  vevent(`UID:simple
SUMMARY:Point d'avancement IA
DTSTART;TZID=Romance Standard Time:20261109T150000
DTEND;TZID=Romance Standard Time:20261109T160000
STATUS:CONFIRMED`),
  // Hebdomadaire le lundi 10h, qui traverse le passage à l'heure d'hiver (25/10), avec une date exclue et une exception déplacée
  vevent(`UID:weekly
SUMMARY:Daily équipe
DTSTART;TZID=Romance Standard Time:20261019T100000
DTEND;TZID=Romance Standard Time:20261019T103000
RRULE:FREQ=WEEKLY;COUNT=4;BYDAY=MO
EXDATE;TZID=Romance Standard Time:20261102T100000`),
  vevent(`UID:weekly
RECURRENCE-ID;TZID=Romance Standard Time:20261026T100000
SUMMARY:Daily équipe (décalé)
DTSTART;TZID=Romance Standard Time:20261026T140000
DTEND;TZID=Romance Standard Time:20261026T143000`),
  vevent(`UID:allday
SUMMARY:Formation
DTSTART;VALUE=DATE:20270125
DTEND;VALUE=DATE:20270127`),
  vevent(`UID:cancelled
SUMMARY:Annulé : réunion
STATUS:CANCELLED
DTSTART;TZID=Romance Standard Time:20261112T090000
DTEND;TZID=Romance Standard Time:20261112T100000`),
  vevent(`UID:old
SUMMARY:Trop ancien
DTSTART;TZID=Romance Standard Time:20250101T090000
DTEND;TZID=Romance Standard Time:20250101T100000`),
);

const parse = () => parseOutlook(ICAL, ICS, '2026-09-26', '2027-04-24');

test('fuseau Windows converti en heure de Paris, y compris après le passage à l’heure d’hiver', () => {
  const occ = parse();
  const p = occ.find(o => o.name === "Point d'avancement IA")!;
  assert.deepEqual([p.date, p.start_time, p.end_time], ['2026-11-09', '15:00', '16:00']);
  const weekly = occ.filter(o => o.name.startsWith('Daily')).map(o => `${o.date} ${o.start_time} ${o.name}`).sort();
  assert.deepEqual(weekly, [
    '2026-10-19 10:00 Daily équipe',
    '2026-10-26 14:00 Daily équipe (décalé)', // exception appliquée
    '2026-11-09 10:00 Daily équipe',          // 2/11 exclue (EXDATE), 10h toujours après le changement d'heure
  ]);
});

test('journées entières dépliées jour par jour, annulés et hors fenêtre ignorés', () => {
  const occ = parse();
  assert.deepEqual(occ.filter(o => o.name === 'Formation').map(o => [o.date, o.start_time]), [['2027-01-25', null], ['2027-01-26', null]]);
  assert.ok(!occ.some(o => o.name.startsWith('Annulé')), 'annulé ignoré');
  assert.ok(!occ.some(o => o.name === 'Trop ancien'), 'hors fenêtre');
});

test('synchronisation : doublons évités, écritures minimales, suppressions limitées à Outlook', () => {
  const occ = parse();
  const manual: ExistingEvent = { id: 'e-manuel', date: '2026-11-09', name: 'Point IA', kind: 'Réunion', start_time: '15:00:00', end_time: '16:00:00' };
  const first = planSync(occ, [manual], '2026-09-26');
  assert.equal(first.duplicates, 1, 'la réunion déjà saisie dans le Cockpit n’est pas dupliquée');
  assert.ok(first.upserts.every(r => r.id.startsWith('ol-') && r.kind === 'Outlook' && !('subject_id' in r)));
  assert.equal(first.deletes.length, 0);

  // Deuxième passage : rien n'a changé → aucune écriture
  const stored: ExistingEvent[] = [manual, ...first.upserts.map(r => ({ ...r, start_time: r.start_time && r.start_time + ':00', end_time: r.end_time && r.end_time + ':00' }))];
  const second = planSync(occ, stored, '2026-09-26');
  assert.equal(second.upserts.length, 0);
  assert.equal(second.deletes.length, 0);

  // Une réunion disparue d'Outlook est retirée ; un événement manuel n'est jamais supprimé
  const third = planSync(occ.filter(o => o.name !== 'Formation'), stored, '2026-09-26');
  assert.equal(third.deletes.length, 2);
  assert.ok(third.deletes.every(id => id.startsWith('ol-')));
});

test('identifiants stables et distincts', () => {
  assert.equal(stableId('a|b'), stableId('a|b'));
  assert.notEqual(stableId('a|b'), stableId('a|c'));
  assert.match(stableId('x'), /^ol-[0-9a-f]{16}$/);
});
