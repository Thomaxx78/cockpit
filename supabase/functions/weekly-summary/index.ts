// Edge Function « weekly-summary » : mail récapitulatif chaque vendredi à 19h (Paris).
//
// Appelée par pg_cron (voir supabase/cron-weekly.sql) le vendredi à 17h et 18h UTC : seule l'exécution
// qui tombe à 19h heure de Paris envoie (heure d'été comme d'hiver), une seule fois par semaine
// grâce à la table weekly_log.
//
// Sécurité : pas de JWT utilisateur (appel planifié) → en-tête x-cron-secret obligatoire.
// Secrets (les mêmes que daily-reminder) : CRON_SECRET, RESEND_API_KEY, REMINDER_TO ; optionnels : REMINDER_FROM, APP_URL.

import { createClient } from 'npm:@supabase/supabase-js@2.118.0';
import {
  addDays, buildWeekly, collectWeek, parisNow, weekRange,
  type WActivity, type WEvent, type WNote, type WSubject, type WTask,
} from './summary.ts';

const env = (k: string) => Deno.env.get(k) || undefined;
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

function safeEqual(a: string, b: string) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

Deno.serve(async req => {
  if (req.method !== 'POST') return json(405, { error: 'POST uniquement' });
  const secret = env('CRON_SECRET');
  if (!secret || !safeEqual(req.headers.get('x-cron-secret') ?? '', secret)) return json(401, { error: 'non autorisé' });

  const body = await req.json().catch(() => ({})) as { force?: boolean; dry_run?: boolean; day?: string };
  const force = body.force === true;     // envoi manuel (test) : ignore le jour, l'heure et le dédoublonnage
  const dryRun = body.dry_run === true;  // calcule le mail sans l'envoyer
  const now = parisNow(new Date());
  const day = typeof body.day === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(body.day) ? body.day : now.date;

  if (!force && !dryRun && (now.weekday !== 5 || now.hour !== 19)) {
    return json(200, { sent: false, reason: `pas vendredi 19h à Paris (jour ${now.weekday}, ${now.hour}h)`, day });
  }

  const apiKey = env('RESEND_API_KEY');
  const to = env('REMINDER_TO');
  if (!dryRun && (!apiKey || !to)) return json(503, { error: 'RESEND_API_KEY ou REMINDER_TO manquant' });

  const sb = createClient(env('SUPABASE_URL')!, env('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });
  const { from, nextTo } = weekRange(day);
  const sinceIso = new Date(addDays(from, -1) + 'T00:00:00Z').toISOString(); // marge fuseau ; filtré ensuite par date
  const [ac, tk, sj, ev, nt] = await Promise.all([
    sb.from('activity').select('at,entity,entity_id,subject_id,kind,label,from_status,to_status').gte('at', sinceIso).order('at').limit(2000),
    sb.from('tasks').select('id,name,status,priority,owner,due_date,subject_id'),
    sb.from('subjects').select('id,name,color'),
    sb.from('events').select('id,date,name,kind,start_time,end_time,subject_id').gte('date', from).lte('date', nextTo),
    sb.from('notes').select('id,name,kind,created_at,updated_at').gte('updated_at', sinceIso),
  ]);
  const err = tk.error || sj.error || ev.error;
  if (err) return json(500, { error: 'lecture impossible', detail: err.message });

  const data = collectWeek(day, {
    activity: (ac.error ? [] : ac.data) as WActivity[],   // historique absent : le résumé reste utile
    tasks: tk.data as WTask[],
    events: ev.data as WEvent[],
    notes: (nt.error ? [] : nt.data) as WNote[],          // table des notes absente : idem
  });
  const mail = buildWeekly(day, data, sj.data as WSubject[], env('APP_URL'));
  if (dryRun) return json(200, { dry_run: true, day, subject: mail.subject, text: mail.text });

  // Une seule fois par semaine : la clé primaire (week) bloque un second envoi.
  if (!force) {
    const { error } = await sb.from('weekly_log').insert({ week: from });
    if (error?.code === '23505') return json(200, { sent: false, reason: 'déjà envoyé cette semaine', day });
    if (error) return json(500, { error: 'journal indisponible', detail: error.message });
  }

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: env('REMINDER_FROM') ?? 'Cockpit <onboarding@resend.dev>', to: [to], subject: mail.subject, html: mail.html, text: mail.text }),
  });
  if (!res.ok) {
    if (!force) await sb.from('weekly_log').delete().eq('week', from); // on pourra réessayer
    return json(502, { error: 'envoi refusé par Resend', detail: (await res.text()).slice(0, 500) });
  }
  if (!force) await sb.from('weekly_log').update({ detail: { subject: mail.subject, done: data.done.length, meetings: data.meetings.length } }).eq('week', from);
  return json(200, { sent: true, day, subject: mail.subject });
});
