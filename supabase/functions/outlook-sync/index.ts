// Edge Function « outlook-sync » : importe l'agenda Outlook publié (ICS) dans le calendrier du Cockpit.
//
// Appelée chaque heure par pg_cron (voir supabase/cron-outlook.sql), protégée par l'en-tête
// x-cron-secret (même secret que le rappel quotidien). Synchronisation à sens unique :
// Outlook → Cockpit, sur une fenêtre de 30 jours passés à 180 jours à venir.
//
// Secrets : CRON_SECRET, OUTLOOK_ICS_URL (lien privé : ne jamais le committer).

import ICAL from 'npm:ical.js@2.2.1';
import { createClient } from 'npm:@supabase/supabase-js@2.118.0';
import { OUTLOOK_PREFIX, parseOutlook, planSync, type ExistingEvent } from './sync.ts';

const env = (k: string) => Deno.env.get(k) || undefined;
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

function safeEqual(a: string, b: string) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

const parisToday = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Paris', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
const addDays = (d: string, n: number) => { const x = new Date(d + 'T12:00:00Z'); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };

Deno.serve(async req => {
  if (req.method !== 'POST') return json(405, { error: 'POST uniquement' });
  const secret = env('CRON_SECRET');
  if (!secret || !safeEqual(req.headers.get('x-cron-secret') ?? '', secret)) return json(401, { error: 'non autorisé' });
  const icsUrl = env('OUTLOOK_ICS_URL');
  if (!icsUrl) return json(503, { error: 'OUTLOOK_ICS_URL manquant' });
  const body = await req.json().catch(() => ({})) as { dry_run?: boolean };

  // 1. Lecture du flux Outlook
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 20_000);
  let ics: string;
  try {
    const res = await fetch(icsUrl, { signal: ctrl.signal, headers: { Accept: 'text/calendar' } });
    if (!res.ok) return json(502, { error: `flux Outlook indisponible (HTTP ${res.status})` });
    ics = await res.text();
  } catch {
    return json(504, { error: 'flux Outlook injoignable' });
  } finally {
    clearTimeout(timer);
  }
  if (!ics.includes('BEGIN:VCALENDAR')) return json(502, { error: 'réponse Outlook inattendue' });

  // 2. Dépliage des occurrences et comparaison avec le calendrier du Cockpit
  const from = addDays(parisToday(), -30);
  const to = addDays(parisToday(), 180);
  let occurrences;
  try {
    occurrences = parseOutlook(ICAL, ics, from, to);
  } catch (e) {
    return json(422, { error: 'flux Outlook illisible', detail: String(e).slice(0, 300) });
  }

  const sb = createClient(env('SUPABASE_URL')!, env('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });
  const { data: existing, error } = await sb.from('events').select('id,date,name,kind,start_time,end_time').gte('date', from);
  if (error) return json(500, { error: 'lecture du calendrier impossible', detail: error.message });

  const plan = planSync(occurrences, existing as ExistingEvent[], from);
  if (body.dry_run) return json(200, { dry_run: true, from, to, ...plan });

  // 3. Écritures minimales (le sujet éventuellement choisi dans le Cockpit n'est pas dans la charge utile)
  if (plan.upserts.length) {
    const { error: e1 } = await sb.from('events').upsert(plan.upserts);
    if (e1) return json(500, { error: 'écriture impossible', detail: e1.message });
  }
  if (plan.deletes.length) {
    const { error: e2 } = await sb.from('events').delete().in('id', plan.deletes).like('id', `${OUTLOOK_PREFIX}%`);
    if (e2) return json(500, { error: 'suppression impossible', detail: e2.message });
  }
  return json(200, { ok: true, from, to, created_or_updated: plan.upserts.length, deleted: plan.deletes.length, duplicates_skipped: plan.duplicates, total: plan.total });
});
