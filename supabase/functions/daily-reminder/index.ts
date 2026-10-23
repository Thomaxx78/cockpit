// Edge Function « daily-reminder » : mail de rappel à 9h (Paris) les jours où une réunion
// ou une échéance est prévue.
//
// Appelée par pg_cron (voir supabase/cron-reminder.sql) à 7h et 8h UTC : seule l'exécution
// qui tombe à 9h heure de Paris envoie (heure d'été comme d'hiver), une seule fois par jour
// grâce à la table reminder_log.
//
// Sécurité : pas de JWT utilisateur (appel planifié) → en-tête x-cron-secret obligatoire.
// La clé service_role reste côté serveur (fournie par Supabase), jamais exposée au navigateur.
//
// Secrets : CRON_SECRET, RESEND_API_KEY, REMINDER_TO ; optionnels : REMINDER_FROM, APP_URL.

import { createClient } from 'npm:@supabase/supabase-js@2.118.0';
import { buildEmail, parisNow, selectForDay, type ReminderEvent, type ReminderSubject, type ReminderTask } from './reminder.ts';

const env = (k: string) => Deno.env.get(k) || undefined;
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

/** Comparaison en temps constant (évite de deviner le secret caractère par caractère). */
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
  const force = body.force === true;      // envoi manuel (test) : ignore l'heure et le dédoublonnage
  const dryRun = body.dry_run === true;   // calcule le mail sans l'envoyer
  const now = parisNow(new Date());
  const day = typeof body.day === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(body.day) ? body.day : now.date;

  if (!force && !dryRun && now.hour !== 9) return json(200, { sent: false, reason: `il est ${now.hour}h à Paris`, day });

  const apiKey = env('RESEND_API_KEY');
  const to = env('REMINDER_TO');
  if (!dryRun && (!apiKey || !to)) return json(503, { error: 'RESEND_API_KEY ou REMINDER_TO manquant' });

  const sb = createClient(env('SUPABASE_URL')!, env('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });
  const [ev, tk, sj] = await Promise.all([
    sb.from('events').select('id,date,name,kind,start_time,end_time,subject_id').eq('date', day),
    sb.from('tasks').select('id,name,status,priority,owner,due_date,subject_id').eq('due_date', day),
    sb.from('subjects').select('id,name,color'),
  ]);
  const err = ev.error || tk.error || sj.error;
  if (err) return json(500, { error: 'lecture impossible', detail: err.message });

  const sel = selectForDay(day, ev.data as ReminderEvent[], tk.data as ReminderTask[]);
  if (!sel) return json(200, { sent: false, reason: 'rien de prévu', day });
  const mail = buildEmail(day, sel, sj.data as ReminderSubject[], env('APP_URL'));
  if (dryRun) return json(200, { dry_run: true, day, subject: mail.subject, events: sel.events.length, tasks: sel.tasks.length, text: mail.text });

  // Une seule fois par jour : la clé primaire (day) bloque un second envoi.
  if (!force) {
    const { error } = await sb.from('reminder_log').insert({ day });
    if (error?.code === '23505') return json(200, { sent: false, reason: 'déjà envoyé aujourd’hui', day });
    if (error) return json(500, { error: 'journal indisponible', detail: error.message });
  }

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: env('REMINDER_FROM') ?? 'Cockpit <onboarding@resend.dev>', to: [to], subject: mail.subject, html: mail.html, text: mail.text }),
  });
  if (!res.ok) {
    if (!force) await sb.from('reminder_log').delete().eq('day', day); // on pourra réessayer
    return json(502, { error: 'envoi refusé par Resend', detail: (await res.text()).slice(0, 500) });
  }
  if (!force) await sb.from('reminder_log').update({ detail: { subject: mail.subject, events: sel.events.length, tasks: sel.tasks.length } }).eq('day', day);
  return json(200, { sent: true, day, subject: mail.subject });
});
