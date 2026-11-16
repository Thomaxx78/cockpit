// Import de l'agenda Outlook (flux ICS publié) dans le calendrier du Cockpit.
// Logique pure : la bibliothèque ical.js est injectée (npm:ical.js côté Deno, node_modules en test).

// deno-lint-ignore no-explicit-any
type ICALModule = any;

export type Occurrence = { key: string; date: string; name: string; start_time: string | null; end_time: string | null; description: string };
export type ExistingEvent = { id: string; date: string; name: string; kind: string; start_time: string | null; end_time: string | null; description?: string | null; subject_id?: string | null };
export type OutlookRow = { id: string; date: string; name: string; kind: 'Outlook'; start_time: string | null; end_time: string | null; description?: string; subject_id?: string };
export type SubjectRef = { id: string; name: string; category?: string | null; status?: string | null };

export const OUTLOOK_PREFIX = 'ol-';

/** Date et heure locales à Paris d'un instant. */
function paris(d: Date) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Paris', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(d).map(x => [x.type, x.value]));
  return { date: `${p.year}-${p.month}-${p.day}`, time: `${p.hour}:${p.minute}` };
}

const addDays = (d: string, n: number) => { const x = new Date(d + 'T12:00:00Z'); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };

export const MAX_DESCRIPTION = 4000;

/**
 * Description lisible d'une réunion Outlook :
 * - le long bloc d'invitation Teams (après la ligne de soulignés) est réduit à son lien de connexion ;
 * - espaces et lignes vides superflus retirés, longueur bornée.
 */
export function cleanDescription(raw: unknown) {
  let text = String(raw ?? '').replace(/\r\n?/g, '\n').replace(/ /g, ' ');
  const sep = text.search(/^_{10,}\s*$/m);
  if (sep >= 0) {
    const block = text.slice(sep);
    if (/teams/i.test(block)) {
      const link = block.match(/https:\/\/teams\.microsoft\.com\/(?:l\/meetup-join|meet)\/[^\s<>"]+/)?.[0];
      text = text.slice(0, sep).trimEnd() + (link ? `\n\nRéunion Teams : ${link}` : '');
    }
  }
  text = text.split('\n').map(l => l.trimEnd()).join('\n').replace(/\n{3,}/g, '\n\n').trim();
  return text.length > MAX_DESCRIPTION ? text.slice(0, MAX_DESCRIPTION - 1).trimEnd() + '…' : text;
}

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
    const description = cleanDescription(item.description);
    if (start.isDate) {
      // Journée(s) entière(s) : une entrée par jour (14 jours maximum).
      const first = start.toString().slice(0, 10);
      const last = end ? addDays(end.toString().slice(0, 10), -1) : first;
      for (let d = first, i = 0; d <= last && i < 14; d = addDays(d, 1), i++) {
        if (d >= from && d <= to) out.push({ key: `${key}|${d}`, date: d, name, start_time: null, end_time: null, description });
      }
      return;
    }
    const s = paris(start.toJSDate());
    const e = end ? paris(end.toJSDate()) : null;
    if (s.date < from || s.date > to) return;
    out.push({ key, date: s.date, name, start_time: s.time, end_time: e && e.date === s.date && e.time > s.time ? e.time : null, description });
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

/** Mots trop courants pour identifier un sujet à eux seuls (forme normalisée : minuscules, sans accents). */
const STOP_WORDS = new Set(`
  avec pour dans sans sous chez vers entre depuis apres avant pendant contre selon comme plus moins tres tout tous toute toutes
  cette leur leurs notre votre elle elles nous vous sont etre avoir fait faire autre autres
  analyse analyses suivi point points projet projets client clients reunion reunions rendez sujet sujets dossier dossiers
  equipe equipes atelier ateliers comite revue bilan synthese etude etudes mise place cadrage lancement kick weekly daily hebdo
  mensuel mensuelle annuel annuelle semaine mois jour jours echange echanges appel call meeting visio teams zoom
  avancement planning budget strategie strategique vision note notes compte rendu ordre presentation demo
  agent agents data donnees room outil outils plan plans offre offres test tests nouveau nouvelle nouveaux general generale
  interne externe gestion travail groupe service services support process processus document documents contrat contrats
  formation formations prise contact relance relances question questions action actions recherche
  with from into about review sync update weekly
`.trim().split(/\s+/));

/** Mots-clés significatifs d'un nom de sujet : la partie avant « — » / « - », puis ses mots distinctifs (≥ 4 lettres). */
export function subjectKeywords(name: string) {
  const keys = new Set<string>();
  const head = name.split(/\s+[—–-]\s+/)[0];
  if (head !== name) { const h = norm(head); if (h.length >= 3 && !STOP_WORDS.has(h)) keys.add(h); }
  for (const w of norm(name).split(' ')) if (w.length >= 4 && !/^\d+$/.test(w) && !STOP_WORDS.has(w)) keys.add(w);
  return [...keys];
}

/**
 * Sujet auquel rattacher une réunion, d'après ses mots-clés trouvés dans le titre (prioritaire) puis la description.
 * Score : mot-clé de plusieurs mots (ex. « moon by dfm ») = 2, mot seul = 1.
 * Retourne l'id seulement si un sujet est seul en tête (égalité → aucun) ; sujets « Terminé » ignorés.
 */
export function matchSubject(name: string, description: string | null | undefined, subjects: SubjectRef[]): string | null {
  const candidates = subjects.filter(s => s.status !== 'Terminé').map(s => ({ id: s.id, keys: subjectKeywords(s.name) }));
  for (const text of [name, description ?? '']) {
    const hay = ` ${norm(text)} `;
    if (!hay.trim()) continue;
    let best = 0, ids: string[] = [];
    for (const c of candidates) {
      const score = c.keys.reduce((n, k) => n + (hay.includes(` ${k} `) ? (k.includes(' ') ? 2 : 1) : 0), 0);
      if (score > best) { best = score; ids = [c.id]; } else if (score > 0 && score === best) ids.push(c.id);
    }
    if (best > 0) return ids.length === 1 ? ids[0] : null; // ambigu : on ne devine pas
  }
  return null;
}

/**
 * Compare les occurrences Outlook aux événements existants.
 * - Un événement saisi dans le Cockpit au même jour et à la même heure est conservé (pas de doublon).
 * - Seules les lignes nouvelles ou modifiées sont écrites.
 * - Rattachement automatique à un sujet (`subjects`) des réunions nouvelles ou encore sans sujet ; un sujet déjà
 *   présent en base (choix manuel) n'est jamais envoyé, donc jamais écrasé (upsert : colonnes absentes conservées).
 * - Les événements Outlook disparus du flux (annulés, déplacés) sont supprimés, dans la fenêtre seulement.
 */
export function planSync(occs: Occurrence[], existing: ExistingEvent[], from: string, { withDescription = true, subjects = [] as SubjectRef[] } = {}) {
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
    const row: OutlookRow = { id, date: o.date, name: o.name, kind: 'Outlook', start_time: o.start_time, end_time: o.end_time };
    // Sans la colonne « description » (migration non exécutée), on n'envoie pas le champ.
    if (withDescription) row.description = o.description;
    // Sujet proposé seulement si la réunion n'en a pas encore en base.
    if (subjects.length && !byId.get(id)?.subject_id) {
      const sid = matchSubject(o.name, o.description, subjects);
      if (sid) row.subject_id = sid;
    }
    wanted.set(id, row);
  }

  const upserts = [...wanted.values()].filter(r => {
    const e = byId.get(r.id);
    return !e || e.date !== r.date || e.name !== r.name || (e.start_time?.slice(0, 5) ?? null) !== r.start_time || (e.end_time?.slice(0, 5) ?? null) !== r.end_time ||
      (withDescription && (e.description ?? '') !== r.description) || (r.subject_id !== undefined && !e.subject_id);
  });
  const deletes = existing.filter(e => e.id.startsWith(OUTLOOK_PREFIX) && e.date >= from && !wanted.has(e.id)).map(e => e.id);
  const linked = upserts.filter(r => r.subject_id !== undefined).length;
  return { upserts, deletes, duplicates, linked, total: wanted.size };
}
