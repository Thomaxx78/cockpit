import { newId, useStore } from './store';
import { go } from './utils';
import type { CalEvent, Note, Subject } from './types';

export const UNTITLED = 'Sans titre';
export const MEETINGS_FOLDER = 'Réunions';

/** Nouvelle note (ou dossier) avec toutes les valeurs par défaut. */
export function newNote(notes: Note[], p: Partial<Note> = {}): Note {
  return {
    id: newId('n'), parent_id: null, kind: 'file', name: UNTITLED, content: '', task_id: null, event_id: null, pinned: false,
    position: Math.max(0, ...notes.map(n => n.position)) + 1, updated_at: null, ...p,
  };
}

const hm = (t: string) => t.slice(0, 5).replace(/^0/, '').replace(':00', 'h').replace(':', 'h');

/** Compte rendu de réunion pré-rempli (date, horaire, sujet, plan type). */
export function meetingNoteContent(e: CalEvent, subject?: Subject) {
  const day = new Date(e.date + 'T12:00:00').toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  const when = e.start_time ? `${day}, ${hm(e.start_time)}${e.end_time ? '–' + hm(e.end_time) : ''}` : day;
  return [
    `**Date :** ${when}`,
    ...(subject ? [`**Sujet :** ${subject.name}`] : []),
    '**Participants :** ',
    '',
    '## Ordre du jour',
    '',
    '- ',
    '',
    '## Notes',
    '',
    '- ',
    '',
    '## Décisions',
    '',
    '- ',
    '',
    '## Actions',
    '',
    '- [ ] ',
    '',
  ].join('\n');
}

export const meetingNoteName = (e: CalEvent) =>
  `${e.name} – ${new Date(e.date + 'T12:00:00').toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' })}`;

/* ---------- Cases à cocher → tickets ----------
   Une case transformée en ticket garde un lien `[ticket](#ticket-<id>)` à la fin de sa ligne :
   le rendu l'affiche comme une pastille avec le statut du ticket, à jour en direct. */

export const TICKET_LINK = /\s*\[[^\]]*\]\(#ticket-([\w-]+)\)/;

export type Checkbox = { line: number; checked: boolean; text: string; ticket: string | null };

/** Cases à cocher du Markdown, dans l'ordre du rendu (les blocs de code sont ignorés). */
export function checkboxes(md: string): Checkbox[] {
  const out: Checkbox[] = [];
  let fence = false;
  md.split('\n').forEach((l, i) => {
    if (/^\s*(```|~~~)/.test(l)) { fence = !fence; return; }
    if (fence) return;
    const m = l.match(/^\s*(?:>\s*)*(?:[-*+]|\d+[.)])\s+\[( |x|X)\]\s?(.*)$/);
    if (!m) return;
    const ticket = m[2].match(TICKET_LINK)?.[1] ?? null;
    out.push({ line: i, checked: m[1] !== ' ', text: m[2].replace(TICKET_LINK, '').trim(), ticket });
  });
  return out;
}

/** Texte d'une case → nom de ticket lisible (sans mise en forme Markdown). */
export const plainText = (s: string) => s
  .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
  .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
  .replace(/[*_~`]/g, '')
  .replace(/\s+/g, ' ')
  .trim();

/** Ajoute le lien vers le ticket à la fin des lignes données. */
export function linkTickets(md: string, links: { line: number; ticket: string }[]) {
  const lines = md.split('\n');
  for (const { line, ticket } of links) lines[line] = lines[line].replace(/\s+$/, '') + ` [ticket](#ticket-${ticket})`;
  return lines.join('\n');
}

/** Notes à ouvrir directement en écriture (compte rendu tout juste créé). */
export const openInEdit = new Set<string>();

/** Notes de réunion : ouvre le compte rendu de la réunion, ou le crée dans le dossier « Réunions ». */
export function useMeetingNotes() {
  const { db, saveNotes, subject } = useStore();
  const notesOf = (eventId: string) => db.notes.filter(n => n.kind === 'file' && n.event_id === eventId);
  const open = (e: CalEvent) => {
    const existing = notesOf(e.id)[0];
    if (existing) return go('notes/' + existing.id);
    let folder = db.notes.find(n => n.kind === 'folder' && !n.parent_id && n.name === MEETINGS_FOLDER);
    const rows: Note[] = [];
    if (!folder) rows.push(folder = newNote(db.notes, { kind: 'folder', name: MEETINGS_FOLDER }));
    const note = newNote([...db.notes, ...rows], {
      parent_id: folder.id, name: meetingNoteName(e), content: meetingNoteContent(e, subject(e.subject_id)), event_id: e.id,
    });
    rows.push(note);
    saveNotes(rows); // une seule écriture : le dossier existe avant la note (clé étrangère)
    openInEdit.add(note.id);
    go('notes/' + note.id);
  };
  return { notesOf, open };
}
