// Tests du rappel quotidien (contenu et horaire), sans réseau.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildEmail, parisNow, selectForDay, type ReminderEvent, type ReminderTask } from '../functions/daily-reminder/reminder.ts';

const ev = (p: Partial<ReminderEvent>): ReminderEvent => ({ id: 'e', date: '2026-11-09', name: 'X', kind: 'Réunion', start_time: null, end_time: null, subject_id: null, ...p });
const tk = (p: Partial<ReminderTask>): ReminderTask => ({ id: 't', name: 'T', status: 'À faire', priority: 'P2', owner: '', due_date: '2026-11-09', subject_id: null, ...p });

test('9h à Paris : 7h UTC en heure d’été, 8h UTC en heure d’hiver', () => {
  assert.deepEqual(parisNow(new Date('2026-10-22T07:00:00Z')), { date: '2026-10-22', hour: 9 }); // été (UTC+2)
  assert.equal(parisNow(new Date('2026-10-22T08:00:00Z')).hour, 10);
  assert.deepEqual(parisNow(new Date('2026-11-09T08:00:00Z')), { date: '2026-11-09', hour: 9 }); // hiver (UTC+1)
  assert.equal(parisNow(new Date('2026-11-09T07:00:00Z')).hour, 8);
  assert.equal(parisNow(new Date('2026-11-09T23:30:00Z')).date, '2026-11-10', 'date locale de Paris');
});

test('sélection : réunions du jour triées, sans cours ; échéances actives seulement', () => {
  const sel = selectForDay('2026-11-09', [
    ev({ id: 'a', name: 'Point IA', start_time: '15:00:00', end_time: '16:00:00' }),
    ev({ id: 'b', name: 'Café', start_time: '09:30:00' }),
    ev({ id: 'c', name: 'Cours · Data', kind: 'Cours', start_time: '09:30:00' }),
    ev({ id: 'd', date: '2026-11-10', name: 'Demain' }),
  ], [
    tk({ id: 't1', priority: 'P2' }), tk({ id: 't2', priority: 'P1' }),
    tk({ id: 't3', status: 'Terminé' }), tk({ id: 't4', status: 'Backlog' }), tk({ id: 't5', due_date: '2026-11-10' }),
  ])!;
  assert.deepEqual(sel.events.map(e => e.id), ['b', 'a']);
  assert.deepEqual(sel.tasks.map(t => t.id), ['t2', 't1']);
});

test('rien de prévu (ou seulement des cours) → pas de mail', () => {
  assert.equal(selectForDay('2026-11-02', [ev({ date: '2026-11-02', kind: 'Cours' })], [tk({ status: 'Terminé', due_date: '2026-11-02' })]), null);
});

test('mail : objet clair, horaires, sujet, texte brut et HTML échappé', () => {
  const sel = selectForDay('2026-11-09', [
    ev({ name: 'Point d’avancement IA', start_time: '15:00:00', end_time: '16:00:00', subject_id: 'gov' }),
    ev({ id: 'z', name: '<script>alert(1)</script>', start_time: '17:30:00' }),
  ], [tk({ name: 'Billets Créteil', priority: 'P1' })])!;
  const m = buildEmail('2026-11-09', sel, [{ id: 'gov', name: 'Pilotage mensuel', color: '#64748b' }], 'https://cockpit.example');
  assert.equal(m.subject, '📅 Aujourd’hui : Point d’avancement IA à 15h (+1)');
  assert.match(m.text, /lundi 9 novembre/);
  assert.match(m.text, /15h–16h · Point d’avancement IA \(Pilotage mensuel\)/);
  assert.match(m.text, /\[P1\] Billets Créteil/);
  assert.match(m.html, /&lt;script&gt;/);
  assert.doesNotMatch(m.html, /<script>/);
  assert.match(m.html, /https:\/\/cockpit\.example#\/calendrier/);
});

test('jour avec seulement des échéances', () => {
  const m = buildEmail('2026-11-09', selectForDay('2026-11-09', [], [tk({}), tk({ id: 'u' })])!, []);
  assert.equal(m.subject, '✅ Aujourd’hui : 2 échéances');
});
