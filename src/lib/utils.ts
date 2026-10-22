import { useEffect, useState } from 'react';

export const iso = (d: Date) =>
  [d.getFullYear(), String(d.getMonth() + 1).padStart(2, '0'), String(d.getDate()).padStart(2, '0')].join('-');

export const todayIso = () => iso(new Date());

const parse = (d: string) => new Date(d + 'T12:00:00');

export const fmtDate = (d: string | null | undefined, empty = 'Sans date') =>
  d ? parse(d).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' }) : empty;

export const fmtShort = (d: string) => parse(d).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' });

export const dayMonth = (d: string) => ({
  day: d.slice(8),
  month: parse(d).toLocaleDateString('fr-FR', { month: 'short' }).replace('.', '').toUpperCase(),
  weekday: parse(d).toLocaleDateString('fr-FR', { weekday: 'short' }),
});

/** Nombre de jours entre aujourd'hui et la date (négatif = passé). */
export const daysFrom = (d: string) => Math.round((parse(d).getTime() - parse(todayIso()).getTime()) / 86400000);

export const relative = (d: string) => {
  const n = daysFrom(d);
  if (n === 0) return "Aujourd'hui";
  if (n === 1) return 'Demain';
  if (n === -1) return 'Hier';
  if (n < 0) return `Il y a ${-n} j`;
  if (n < 7) return `Dans ${n} j`;
  if (n < 30) return `Dans ${Math.round(n / 7)} sem.`;
  return `Dans ${Math.round(n / 30)} mois`;
};

export const statusClass = (s: string) =>
  ({ 'En cours': 'ongoing', 'À faire': 'todo', 'En attente': 'waiting', 'Terminé': 'done', 'À cadrer': 'scope' } as Record<string, string>)[s] ?? 'neutral';

export function download(blob: Blob, name: string) {
  const u = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = u;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(u), 1000);
}

/** Routage par hash : #/, #/sujets, #/sujets/moon, #/kanban, #/calendrier, #/actions */
export function useRoute() {
  const get = () => {
    const [path, qs] = decodeURIComponent(location.hash.replace(/^#\/?/, '')).split('?');
    return { parts: path.split('/'), query: new URLSearchParams(qs ?? '') };
  };
  const [route, setRoute] = useState(get);
  useEffect(() => {
    const on = () => { setRoute(get()); window.scrollTo({ top: 0 }); };
    addEventListener('hashchange', on);
    return () => removeEventListener('hashchange', on);
  }, []);
  return route;
}

export const go = (path: string) => { location.hash = '/' + path; };

/** "09:30" → "9h30", "15:00" → "15h" */
export const fmtTime = (t: string) => t.replace(/^0(?=\d)/, '').replace(/:00$/, 'h').replace(':', 'h');
export const timeRange = (start?: string | null, end?: string | null) =>
  start ? (end ? `${fmtTime(start)}–${fmtTime(end)}` : fmtTime(start)) : '';
