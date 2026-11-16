// Tests de l'import Outlook (flux ICS au format Exchange), sans réseau.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import ICAL from 'ical.js';
import { matchSubject, parseOutlook, planSync, stableId, subjectKeywords, type ExistingEvent, type Occurrence, type SubjectRef } from '../functions/outlook-sync/sync.ts';

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

test('description récupérée, invitation Teams réduite à son lien', () => {
  const ics = cal(vevent(`UID:desc
SUMMARY:Comité projet
DESCRIPTION:Ordre du jour :\\n- budget\\n- planning\\n\\n\\n\\n________________________________________________________________________________\\nRéunion Microsoft Teams\\nRejoindre sur votre ordinateur\\, une application mobile ou un appareil de salle\\nCliquez ici pour rejoindre la réunion<https://teams.microsoft.com/l/meetup-join/19%3ameeting_abc%40thread.v2/0?context=x>\\nID de la réunion : 123 456\\n________________________________________________________________________________
DTSTART;TZID=Romance Standard Time:20261110T090000
DTEND;TZID=Romance Standard Time:20261110T100000`));
  const [o] = parseOutlook(ICAL, ics, '2026-09-26', '2027-04-24');
  assert.equal(o.description, 'Ordre du jour :\n- budget\n- planning\n\nRéunion Teams : https://teams.microsoft.com/l/meetup-join/19%3ameeting_abc%40thread.v2/0?context=x');
  assert.equal(parse().find(o => o.name === 'Formation')!.description, '', 'sans description : chaîne vide');
});

test('synchronisation : une description modifiée est réécrite ; sans la colonne, elle est ignorée', () => {
  const occ = parse();
  const first = planSync(occ, [], '2026-09-26');
  const stored: ExistingEvent[] = first.upserts.map(r => ({ ...r }));
  const changed = occ.map(o => (o.name === 'Formation' ? { ...o, description: 'Salle B' } : o));
  assert.equal(planSync(changed, stored, '2026-09-26').upserts.length, 2, 'les 2 jours de formation');

  const legacy = planSync(changed, stored.map(({ description: _, ...r }) => r), '2026-09-26', { withDescription: false });
  assert.equal(legacy.upserts.length, 0);
  assert.ok(first.upserts.every(r => 'description' in r));
  assert.ok(planSync(occ, [], '2026-09-26', { withDescription: false }).upserts.every(r => !('description' in r)));
});

test('identifiants stables et distincts', () => {
  assert.equal(stableId('a|b'), stableId('a|b'));
  assert.notEqual(stableId('a|b'), stableId('a|c'));
  assert.match(stableId('x'), /^ol-[0-9a-f]{16}$/);
});

// --- Rattachement automatique à un sujet ---
const SUBJECTS: SubjectRef[] = [
  { id: 'moon', name: 'Moon by DFM — agent data room', category: 'Client', status: 'En cours' },
  { id: 'edison', name: 'Edison - analyse des contrats', category: 'Client', status: 'À faire' },
  { id: 'besancon', name: 'Projet Besançon', category: 'Interne', status: 'En cours' },
  { id: 'lumina', name: 'Lumina', category: 'Client', status: 'En attente' },
  { id: 'guillaume', name: 'Point avec Guillaume', category: 'Équipe', status: 'En cours' },
  { id: 'old', name: 'Orion — refonte', category: 'Client', status: 'Terminé' },
];

test('mots-clés : partie avant le tiret et mots distinctifs, sans mots vides', () => {
  assert.deepEqual(subjectKeywords('Moon by DFM — agent data room'), ['moon by dfm', 'moon']);
  assert.deepEqual(subjectKeywords('Point avec Guillaume'), ['guillaume']);
  assert.deepEqual(subjectKeywords('Edison - analyse des contrats'), ['edison']);
});

test('rattachement : correspondance unique, accents et casse ignorés', () => {
  assert.equal(matchSubject('Démo MOON avec l’équipe DFM', '', SUBJECTS), 'moon');
  assert.equal(matchSubject('Comité BESANCON', '', SUBJECTS), 'besancon');
  assert.equal(matchSubject('Café avec guillaume', null, SUBJECTS), 'guillaume');
  assert.equal(matchSubject('Revue mensuelle', 'Ordre du jour : lancement Lumina', SUBJECTS), 'lumina', 'description si rien dans le titre');
  assert.equal(matchSubject('Lumina', 'voir aussi Edison', SUBJECTS), 'lumina', 'le titre est prioritaire');
  assert.equal(matchSubject('Point d’avancement', 'Réunion Teams : https://teams.microsoft.com/l/meetup-join/x', SUBJECTS), null, 'mots vides seuls : rien');
  assert.equal(matchSubject('Moonlight', '', SUBJECTS), null, 'mot entier uniquement');
});

test('rattachement : ambigu → aucun sujet ; sujet terminé ignoré', () => {
  assert.equal(matchSubject('Edison et Lumina', '', SUBJECTS), null);
  assert.equal(matchSubject('Orion refonte', '', SUBJECTS), null);
  const moon2 = [...SUBJECTS, { id: 'moon2', name: 'Moon — facturation', status: 'En cours' }];
  assert.equal(matchSubject('Moon hebdo', '', moon2), null, 'deux sujets « moon » à égalité');
  assert.equal(matchSubject('Moon by DFM hebdo', '', moon2), 'moon', 'le nom complet départage');
});

test('synchronisation : sujet proposé pour les nouvelles réunions ou sans sujet, jamais à la place d’un choix manuel', () => {
  const occs: Occurrence[] = [
    { key: 'a', date: '2026-11-20', name: 'Atelier Moon', start_time: '10:00', end_time: '11:00', description: '' },
    { key: 'b', date: '2026-11-20', name: 'Lumina', start_time: '14:00', end_time: '15:00', description: '' },
    { key: 'c', date: '2026-11-21', name: 'Edison', start_time: '09:00', end_time: '10:00', description: '' },
    { key: 'd', date: '2026-11-21', name: 'Déjeuner', start_time: '12:00', end_time: '13:00', description: '' },
  ];
  const first = planSync(occs, [], '2026-11-01', { subjects: SUBJECTS });
  const sid = (k: string) => first.upserts.find(r => r.id === stableId(k))!;
  assert.equal(sid('a').subject_id, 'moon');
  assert.equal(sid('b').subject_id, 'lumina');
  assert.ok(!('subject_id' in sid('d')), 'sans correspondance : champ non envoyé');
  assert.equal(first.linked, 3);

  const stored: ExistingEvent[] = first.upserts.map(r => ({ ...r, subject_id: r.subject_id ?? null }));
  stored.find(e => e.id === stableId('a'))!.subject_id = 'besancon'; // corrigé à la main dans le Cockpit
  stored.find(e => e.id === stableId('b'))!.subject_id = null;       // encore sans sujet
  const second = planSync(occs, stored, '2026-11-01', { subjects: SUBJECTS });
  assert.deepEqual(second.upserts.map(r => [r.id, r.subject_id]), [[stableId('b'), 'lumina']], 'seule la ligne sans sujet est réécrite');

  // Réunion renommée mais avec un sujet manuel : réécrite sans le champ subject_id
  const renamed = planSync(occs.map(o => (o.key === 'a' ? { ...o, name: 'Atelier Edison' } : o)), stored, '2026-11-01', { subjects: SUBJECTS });
  const a = renamed.upserts.find(r => r.id === stableId('a'))!;
  assert.equal(a.name, 'Atelier Edison');
  assert.ok(!('subject_id' in a), 'le choix manuel n’est jamais envoyé');
});
