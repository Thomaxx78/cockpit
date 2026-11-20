import type { Subject } from './types';
import { iso } from './utils';

/* ---------- Saisie rapide ----------
   Une phrase libre devient une action : « Relancer Paul vendredi P1 #achats @Marie ».
   - date : aujourd'hui, demain, après-demain, lundi…dimanche, dans 3 jours / 2 semaines / 1 mois,
     semaine prochaine, fin du mois, 12/11, 12/11/2027, le 12, 12 décembre ;
   - priorité : P1, P2, P3 (ou « urgent » = P1) ;
   - sujet : #mot (début ou morceau du nom, sans tenir compte des accents) ;
   - responsable : @nom.
   Les morceaux reconnus sont retirés du titre. */

export type QuickTask = {
  name: string;
  due_date: string | null;
  priority: string | null;
  subject_id: string | null;
  owner: string | null;
  /** Vrai si au moins un élément a été reconnu (date, priorité, sujet, responsable). */
  smart: boolean;
};

const fold = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const key = (s: string) => fold(s).replace(/[^a-z0-9]/g, '');

const DAYS = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'];
const MONTHS = ['janvier', 'fevrier', 'mars', 'avril', 'mai', 'juin', 'juillet', 'aout', 'septembre', 'octobre', 'novembre', 'decembre'];
/** Mois écrit en entier ou abrégé (« déc », « sept. »). */
const monthOf = (w: string) => {
  const f = fold(w).replace(/\.$/, '');
  return f.length >= 3 ? MONTHS.findIndex(m => m.startsWith(f)) : -1;
};

const addDays = (d: Date, n: number) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };

// Début et fin de « mot » : on ne coupe pas un mot en deux (lettres accentuées comprises).
const B = String.raw`(?<![\p{L}\p{N}])`;
const E = String.raw`(?![\p{L}\p{N}])`;
const PRE = String.raw`(?:(?:pour|d'ici|avant|le|au plus tard)\s+)?`;

type Rule = [RegExp, (m: RegExpMatchArray, today: Date) => Date | null];
const r = (src: string) => new RegExp(B + PRE + src + E, 'iu');

const DATE_RULES: Rule[] = [
  [r(String.raw`(?:aujourd'hui|auj|ce soir|ce midi)`), (_, t) => t],
  [r(String.raw`apr[eè]s[- ]demain`), (_, t) => addDays(t, 2)],
  [r(String.raw`demain`), (_, t) => addDays(t, 1)],
  [r(String.raw`dans\s+(\d{1,3})\s*(jours?|j|semaines?|sem|mois)`), (m, t) => {
    const n = Number(m[1]);
    if (/^m/i.test(m[2])) { const x = new Date(t); x.setMonth(x.getMonth() + n); return x; }
    return addDays(t, /^s/i.test(m[2]) ? n * 7 : n);
  }],
  [r(String.raw`(?:la\s+)?semaine\s+prochaine`), (_, t) => addDays(t, ((8 - t.getDay()) % 7) || 7)],
  [r(String.raw`fin\s+(?:du|de)\s+mois`), (_, t) => new Date(t.getFullYear(), t.getMonth() + 1, 0)],
  [r(String.raw`fin\s+de\s+(?:la\s+)?semaine`), (_, t) => addDays(t, ((5 - t.getDay()) + 7) % 7)],
  // Jour de la semaine : la prochaine occurrence (aujourd'hui exclu).
  [r(String.raw`(dimanche|lundi|mardi|mercredi|jeudi|vendredi|samedi)(?:\s+prochain)?`), (m, t) => {
    const d = DAYS.indexOf(fold(m[1]));
    return addDays(t, ((d - t.getDay() + 7) % 7) || 7);
  }],
  // 12/11, 12-11-2027, 12.11.27 : la date passée bascule sur l'année suivante.
  [r(String.raw`(\d{1,2})[/.-](\d{1,2})(?:[/.-](\d{2,4}))?`), (m, t) => {
    const y = m[3] ? (m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3])) : t.getFullYear();
    const x = valid(y, Number(m[2]) - 1, Number(m[1]));
    if (x && !m[3] && x < t) x.setFullYear(y + 1);
    return x;
  }],
  // 12 décembre, le 3 janv.
  [r(String.raw`(\d{1,2})(?:er)?\s+(\p{L}{3,9}\.?)(?:\s+(\d{4}))?`), (m, t) => {
    const mo = monthOf(m[2]);
    if (mo < 0) return null;
    const y = m[3] ? Number(m[3]) : t.getFullYear();
    const x = valid(y, mo, Number(m[1]));
    if (x && !m[3] && x < t) x.setFullYear(y + 1);
    return x;
  }],
  // « le 12 » : ce mois-ci, ou le mois suivant si le jour est passé.
  [new RegExp(B + String.raw`(?:pour\s+|d'ici\s+|avant\s+)?le\s+(\d{1,2})(?:er)?` + E, 'iu'), (m, t) => {
    const d = Number(m[1]);
    let x = valid(t.getFullYear(), t.getMonth(), d);
    if (x && x < t) x = valid(t.getFullYear(), t.getMonth() + 1, d);
    return x;
  }],
];

function valid(y: number, m: number, d: number) {
  const x = new Date(y, m, d);
  return x.getDate() === d ? x : null; // 31/02 → refusé
}

/** Sujet désigné par « #mot » : nom qui commence par le mot, sinon qui le contient. */
function findSubject(word: string, subjects: Subject[]) {
  const k = key(word);
  if (!k) return undefined;
  const named = subjects.map(s => ({ s, n: key(s.name) }));
  return named.find(x => x.n === k)?.s
    ?? named.filter(x => x.n.startsWith(k)).sort((a, b) => a.n.length - b.n.length)[0]?.s
    ?? named.filter(x => x.n.includes(k) || key(x.s.category) === k).sort((a, b) => a.n.length - b.n.length)[0]?.s;
}

export function parseQuickTask(input: string, subjects: Subject[], now = new Date()): QuickTask {
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  let text = ` ${input.replace(/^\s*\+\s*/, '')} `;
  const take = (re: RegExp) => {
    const m = text.match(re);
    if (m) text = text.slice(0, m.index) + ' ' + text.slice(m.index! + m[0].length);
    return m;
  };

  const prio = take(new RegExp(B + String.raw`(p[123]|urgent)` + E, 'iu'));
  const priority = prio ? (/^u/i.test(prio[1]) ? 'P1' : prio[1].toUpperCase()) : null;

  let subject_id: string | null = null;
  const tag = text.match(/(?:^|\s)#([^\s#@]+)/u);
  if (tag) {
    const s = findSubject(tag[1], subjects);
    if (s) { subject_id = s.id; take(/(?:^|\s)#[^\s#@]+/u); }
  }

  const who = take(/(?:^|\s)@([^\s#@]+)/u);
  const owner = who ? who[1].charAt(0).toUpperCase() + who[1].slice(1) : null;

  let due_date: string | null = null;
  for (const [re, at] of DATE_RULES) {
    const m = text.match(re);
    const d = m && at(m, today);
    if (d) { due_date = iso(d); take(re); break; }
  }

  const name = text.replace(/\s+/g, ' ').trim().replace(/^[-–:,]\s*/, '');
  return {
    name: name.charAt(0).toUpperCase() + name.slice(1),
    due_date, priority, subject_id, owner,
    smart: !!(due_date || priority || subject_id || owner),
  };
}
