// Modèle de données et validation côté serveur.
// Miroir de src/lib/types.ts (le code de l'Edge Function ne peut pas importer src/).

export const TASK_STATUSES = ['À faire', 'En cours', 'En attente', 'Terminé'];
export const SUBJECT_STATUSES = ['À cadrer', 'À faire', 'En cours', 'En attente', 'Terminé'];
export const PRIORITIES = ['P1', 'P2', 'P3'];
export const PALETTE = ['#8b5cf6', '#2563eb', '#0d9488', '#ea580c', '#db2777', '#64748b', '#0891b2', '#65a30d', '#a16207', '#dc2626', '#4f46e5', '#059669'];

export type Task = {
  id: string; name: string; subject_id: string | null; status: string; priority: string;
  owner: string; due_date: string | null; position: number;
};
export type Subject = {
  id: string; name: string; category: string; status: string; summary: string; confirmed: string;
  hypothesis: string; questions: string; people: string; next_step: string; due_date: string | null;
  origin: string; color: string; notes: string; position: number;
};
export type CalEvent = {
  id: string; date: string; name: string; subject_id: string | null; kind: string;
  start_time: string | null; end_time: string | null;
};
export type Table = 'tasks' | 'subjects' | 'events';
export type AnyRow = Task | Subject | CalEvent;

/** Erreur de validation : renvoyée au modèle pour qu'il corrige ou pose une question. */
export class ValidationError extends Error {}

const fail = (msg: string): never => { throw new ValidationError(msg); };

export function str(v: unknown, field: string, max: number, opts: { required?: boolean } = {}): string | undefined {
  if (v === undefined || v === null) return opts.required ? fail(`« ${field} » est obligatoire`) : undefined;
  if (typeof v !== 'string') return fail(`« ${field} » doit être un texte`);
  const s = v.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').trim();
  if (opts.required && !s) return fail(`« ${field} » ne peut pas être vide`);
  if (s.length > max) return fail(`« ${field} » dépasse ${max} caractères`);
  return s;
}

export function oneOf(v: unknown, field: string, allowed: string[]): string | undefined {
  if (v === undefined || v === null) return undefined;
  if (typeof v !== 'string' || !allowed.includes(v)) return fail(`« ${field} » doit valoir : ${allowed.join(', ')}`);
  return v;
}

export function id(v: unknown, field: string): string {
  if (typeof v !== 'string' || !/^[\w-]{1,64}$/.test(v)) return fail(`« ${field} » : identifiant invalide`);
  return v;
}

/** Date AAAA-MM-JJ réelle. `null` = effacer, `undefined` = ne pas toucher. */
export function date(v: unknown, field: string): string | null | undefined {
  if (v === undefined) return undefined;
  if (v === null || v === '') return null;
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return fail(`« ${field} » doit être au format AAAA-MM-JJ`);
  const d = new Date(v + 'T12:00:00Z');
  if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== v) return fail(`« ${field} » : date inexistante (${v})`);
  const y = d.getUTCFullYear();
  if (y < 2020 || y > 2100) return fail(`« ${field} » : année hors limites`);
  return v;
}

export function time(v: unknown, field: string): string | null | undefined {
  if (v === undefined) return undefined;
  if (v === null || v === '') return null;
  if (typeof v !== 'string' || !/^([01]\d|2[0-3]):[0-5]\d$/.test(v)) return fail(`« ${field} » doit être au format HH:MM`);
  return v;
}

export function color(v: unknown): string | undefined {
  if (v === undefined || v === null) return undefined;
  if (typeof v !== 'string' || !/^#[0-9a-fA-F]{6}$/.test(v)) return fail('« color » doit être une couleur #RRGGBB');
  return v.toLowerCase();
}

export const fmtDate = (d: string | null) =>
  d ? new Date(d + 'T12:00:00Z').toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' }) : 'sans date';
