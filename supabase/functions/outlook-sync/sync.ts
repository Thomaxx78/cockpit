// Import de l'agenda Outlook (flux ICS publié) dans le calendrier du Cockpit.
// Logique pure : la bibliothèque ical.js est injectée (npm:ical.js côté Deno, node_modules en test).

// deno-lint-ignore no-explicit-any
type ICALModule = any;

export type Occurrence = { key: string; date: string; name: string; start_time: string | null; end_time: string | null };
export type ExistingEvent = { id: string; date: string; name: string; kind: string; start_time: string | null; end_time: string | null };
export type OutlookRow = { id: string; date: string; name: string; kind: 'Outlook'; start_time: string | null; end_time: string | null };

export const OUTLOOK_PREFIX = 'ol-';

/** Date et heure locales à Paris d'un instant. */
function paris(d: Date) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Paris', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(d).map(x => [x.type, x.value]));
  return { date: `${p.year}-${p.month}-${p.day}`, time: `${p.hour}:${p.minute}` };
}

const addDays = (d: string, n: number) => { const x = new Date(d + 'T12:00:00Z'); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };

/** Hachage stable et court (FNV-1a 2×32 bits) pour des identifiants d'événements déterministes. */
export function stableId(key: string) {
  let a = 0x811c9dc5, b = 0x01000193 ^ key.length;
  for (let i = 0; i < key.length; i++) {
    const c = key.charCodeAt(i);
    a = Math.imul(a ^ c, 0x01000193) >>> 0;
    b = Math.imul(b ^ c, 0x5bd1e995) >>> 0;
  }
  return OUTLOOK_PREFIX + a.toString(16).padStart(8, '0') + b.toString(16).padStart(8, '0');
}

/**
 * Déplie le flux ICS en occurrences datées (heure de Paris) entre `from` et `to` (AAAA-MM-JJ, inclus).
 * Gère les récurrences (RRULE/EXDATE), les exceptions (RECURRENCE-ID), les fuseaux Windows (VTIMEZONE)
 * et ignore les événements annulés.
 */
export function parseOutlook(ICAL: ICALModule, ics: string, from: string, to: string): Occurrence[] {
  const cal = new ICAL.Component(ICAL.parse(ics));
  for (const tz of cal.getAllSubcomponents('vtimezone')) ICAL.TimezoneService.register(tz);

  const vevents = cal.getAllSubcomponents('vevent');
  const masters = vevents.filter((v: ICALModule) => !v.hasProperty('recurrence-id'));
  const exceptions = vevents.filter((v: ICALModule) => v.hasProperty('recurrence-id'));
  const masterUids = new Set(masters.map((v: ICALModule) => v.getFirstPropertyValue('uid')));

  const out: Occurrence[] = [];
  const cancelled = (v: ICALModule) => String(v.getFirstPropertyValue('status') ?? '').toUpperCase() === 'CANCELLED';

  const push = (key: string, item: ICALModule, start: ICALModule, end: ICALModule) => {
    if (cancelled(item.component)) return;
    const name = String(item.summary || 'Occupé').trim().slice(0, 160);
    if (start.isDate) {
      // Journée(s) entière(s) : une entrée par jour (14 jours maximum).
      const first = start.toString().slice(0, 10);
      const last = end ? addDays(end.toString().slice(0, 10), -1) : first;
      for (let d = first, i = 0; d <= last && i < 14; d = addDays(d, 1), i++) {
        if (d >= from && d <= to) out.push({ key: `${key}|${d}`, date: d, name, start_time: null, end_time: null });
      }
      return;
    }
    const s = paris(start.toJSDate());
    const e = end ? paris(end.toJSDate()) : null;
    if (s.date < from || s.date > to) return;
    out.push({ key, date: s.date, name, start_time: s.time, end_time: e && e.date === s.date && e.time > s.time ? e.time : null });
  };

  const windowEnd = ICAL.Time.fromDateString(addDays(to, 1));
  for (const v of masters) {
    const ev = new ICAL.Event(v);
    for (const ex of exceptions) if (ex.getFirstPropertyValue('uid') === ev.uid) ev.relateException(ex);
    if (!ev.isRecurring()) { push(ev.uid, ev, ev.startDate, ev.endDate); continue; }
    const it = ev.iterator();
    for (let next = it.next(), n = 0; next && n < 2000; next = it.next(), n++) {
      if (next.compare(windowEnd) > 0) break;
      const det = ev.getOccurrenceDetails(next);
      push(`${ev.uid}|${next.toString()}`, det.item, det.startDate, det.endDate);
    }
  }
  // Exceptions dont la série n'est pas publiée : traitées comme des événements simples.
  for (const v of exceptions) {
    if (masterUids.has(v.getFirstPropertyValue('uid'))) continue;
    const ev = new ICAL.Event(v);
    push(`${ev.uid}|${v.getFirstPropertyValue('recurrence-id')?.toString()}`, ev, ev.startDate, ev.endDate);
  }
  return out;
}

const norm = (s: string) => s.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

/**
 * Compare les occurrences Outlook aux événements existants.
 * - Un événement saisi dans le Cockpit au même jour et à la même heure est conservé (pas de doublon).
 * - Seules les lignes nouvelles ou modifiées sont écrites ; le sujet choisi dans le Cockpit n'est jamais écrasé.
 * - Les événements Outlook disparus du flux (annulés, déplacés) sont supprimés, dans la fenêtre seulement.
 */
export function planSync(occs: Occurrence[], existing: ExistingEvent[], from: string) {
  const manual = existing.filter(e => !e.id.startsWith(OUTLOOK_PREFIX));
  const isDuplicate = (o: Occurrence) => manual.some(m =>
    m.date === o.date && (o.start_time
      ? m.start_time?.slice(0, 5) === o.start_time
      : !m.start_time && norm(m.name) === norm(o.name)));

  const byId = new Map(existing.map(e => [e.id, e]));
  const wanted = new Map<string, OutlookRow>();
  let duplicates = 0;
  for (const o of occs) {
    if (isDuplicate(o)) { duplicates++; continue; }
    const id = stableId(o.key);
    wanted.set(id, { id, date: o.date, name: o.name, kind: 'Outlook', start_time: o.start_time, end_time: o.end_time });
  }

  const upserts = [...wanted.values()].filter(r => {
    const e = byId.get(r.id);
    return !e || e.date !== r.date || e.name !== r.name || (e.start_time?.slice(0, 5) ?? null) !== r.start_time || (e.end_time?.slice(0, 5) ?? null) !== r.end_time;
  });
  const deletes = existing.filter(e => e.id.startsWith(OUTLOOK_PREFIX) && e.date >= from && !wanted.has(e.id)).map(e => e.id);
  return { upserts, deletes, duplicates, total: wanted.size };
}
