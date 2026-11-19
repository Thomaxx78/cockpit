// Tests du résumé hebdomadaire (contenu et horaire), sans réseau.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildWeekly, collectWeek, parisNow, weekRange, type WActivity, type WEvent, type WNote, type WTask } from '../functions/weekly-summary/summary.ts';

const FRIDAY = '2026-11-20';
const act = (p: Partial<WActivity>): WActivity => ({ at: '2026-11-18T10:00:00Z', entity: 'task', entity_id: 't1', subject_id: null, kind: 'status', label: 'T', from_status: 'À faire', to_status: 'En cours', ...p });
const tk = (p: Partial<WTask>): WTask => ({ id: 't1', name: 'T', status: 'À faire', priority: 'P2', owner: '', due_date: null, subject_id: null, ...p });
const ev = (p: Partial<WEvent>): WEvent => ({ id: 'e', date: '2026-11-18', name: 'Réunion', kind: 'Réunion', start_time: '10:00', end_time: '11:00', subject_id: null, ...p });
const note = (p: Partial<WNote>): WNote => ({ id: 'n', name: 'Note', kind: 'file', created_at: '2026-11-17T09:00:00Z', updated_at: '2026-11-17T09:00:00Z', ...p });

test('vendredi 19h à Paris : 18h UTC en hiver, 17h UTC en été', () => {
  assert.deepEqual(parisNow(new Date('2026-11-20T18:00:00Z')), { date: '2026-11-20', hour: 19, weekday: 5 });
  assert.equal(parisNow(new Date('2026-11-20T17:00:00Z')).hour, 18);
  assert.deepEqual(parisNow(new Date('2026-06-19T17:00:00Z')), { date: '2026-06-19', hour: 19, weekday: 5 });
});

test('semaine : du lundi au vendredi, semaine suivante du lundi au dimanche', () => {
  assert.deepEqual(weekRange(FRIDAY), { from: '2026-11-16', to: '2026-11-20', nextFrom: '2026-11-23', nextTo: '2026-11-29' });
});

test('regroupement : dernier état par ticket, créés, supprimés ignorés, hors semaine ignoré', () => {
  const w = collectWeek(FRIDAY, {
    activity: [
      act({ entity_id: 't1', label: 'Rapport', from_status: 'À faire', to_status: 'En cours', at: '2026-11-16T08:00:00Z' }),
      act({ entity_id: 't1', label: 'Rapport', from_status: 'En cours', to_status: 'Terminé', at: '2026-11-18T08:00:00Z' }),
      act({ entity_id: 't2', label: 'Devis', from_status: 'À faire', to_status: 'En attente' }),
      act({ entity_id: 't3', label: 'Nouveau', kind: 'created', to_status: 'À faire' }),
      act({ entity_id: 't4', label: 'Supprimé', kind: 'created', to_status: 'À faire' }),
      act({ entity_id: 't4', label: 'Supprimé', kind: 'deleted', from_status: 'À faire', to_status: null }),
      act({ entity_id: 't5', label: 'Aller-retour', from_status: 'À faire', to_status: 'En cours' }),
      act({ entity_id: 't5', label: 'Aller-retour', from_status: 'En cours', to_status: 'À faire', at: '2026-11-19T08:00:00Z' }),
      act({ entity_id: 't6', label: 'Vieux', to_status: 'Terminé', at: '2026-11-13T08:00:00Z' }),
      act({ entity: 'subject', entity_id: 's1', label: 'Moon', kind: 'created', to_status: 'À cadrer' }),
    ],
    tasks: [tk({ id: 't1', name: 'Rapport final' }), tk({ id: 't2', name: 'Devis' }), tk({ id: 't3', name: 'Nouveau' })],
    events: [
      ev({ id: 'a', date: '2026-11-17' }), ev({ id: 'c', date: '2026-11-18', kind: 'Cours' }),
      ev({ id: 'n1', date: '2026-11-24', name: 'Comité' }), ev({ id: 'old', date: '2026-11-10' }),
    ],
    notes: [
      note({ id: 'new', name: 'CR comité' }),
      note({ id: 'ed', name: 'Plan', created_at: '2026-10-01T09:00:00Z', updated_at: '2026-11-19T09:00:00Z' }),
      note({ id: 'f', kind: 'folder', name: 'Réunions' }),
      note({ id: 'old', created_at: '2026-10-01T09:00:00Z', updated_at: '2026-10-02T09:00:00Z' }),
    ],
  });
  assert.deepEqual(w.done.map(t => t.name), ['Rapport final'], 'nom actuel du ticket');
  assert.deepEqual(w.moved.map(t => `${t.name}:${t.from}→${t.to}`), ['Devis:À faire→En attente'], 'aller-retour sans effet ignoré');
  assert.deepEqual(w.created.map(t => t.name), ['Nouveau']);
  assert.deepEqual(w.subjects, [{ name: 'Moon', what: 'nouveau sujet' }]);
  assert.deepEqual(w.meetings.map(e => e.id), ['a'], 'cours exclus');
  assert.deepEqual(w.next.map(e => e.id), ['n1']);
  assert.deepEqual(w.notesNew.map(n => n.id), ['new']);
  assert.deepEqual(w.notesEdited.map(n => n.id), ['ed']);
});

test('à venir et en retard : tickets actifs seulement', () => {
  const w = collectWeek(FRIDAY, {
    activity: [], events: [], notes: [],
    tasks: [
      tk({ id: 'a', name: 'Due lundi', due_date: '2026-11-23', priority: 'P1' }),
      tk({ id: 'b', name: 'En retard', due_date: '2026-11-10' }),
      tk({ id: 'c', name: 'Fini', due_date: '2026-11-10', status: 'Terminé' }),
      tk({ id: 'd', name: 'Réserve', due_date: '2026-11-24', status: 'Backlog' }),
    ],
  });
  assert.deepEqual(w.dueNext.map(t => t.id), ['a']);
  assert.deepEqual(w.overdue.map(t => t.id), ['b']);
});

test('mail : objet chiffré, sections, liens vers les notes, HTML échappé', () => {
  const w = collectWeek(FRIDAY, {
    activity: [act({ entity_id: 'x', label: '<script>alert(1)</script>', to_status: 'Terminé' })],
    tasks: [], events: [ev({ id: 'a', date: '2026-11-17' })], notes: [note({ id: 'n9', name: 'CR' })],
  });
  const m = buildWeekly(FRIDAY, w, [], 'https://cockpit.example');
  assert.equal(m.subject, '🗓️ Ta semaine : 1 ticket terminé, 1 réunion, 1 note');
  assert.match(m.text, /du 16 novembre au 20 novembre/);
  assert.match(m.text, /TERMINÉ\n- <script>/, 'texte brut : tel quel');
  assert.match(m.html, /&lt;script&gt;/);
  assert.doesNotMatch(m.html, /<script>/);
  assert.match(m.html, /https:\/\/cockpit\.example#\/notes\/n9/);
  assert.match(m.text, /LA SEMAINE PROCHAINE\n- Aucune réunion prévue/);
});

test('semaine calme : mail quand même, avec la semaine suivante', () => {
  const m = buildWeekly(FRIDAY, collectWeek(FRIDAY, { activity: [], tasks: [], events: [ev({ date: '2026-11-25', name: 'Comité' })], notes: [] }), []);
  assert.equal(m.subject, '🗓️ Ta semaine : semaine calme, voici la suivante');
  assert.match(m.text, /mer\. 25 nov\. 10h · Comité/);
});
