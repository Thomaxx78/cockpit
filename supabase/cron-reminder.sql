-- Planification du rappel quotidien (à exécuter une fois, après le déploiement de daily-reminder).
-- Remplace <CRON_SECRET> par la même valeur que le secret CRON_SECRET de la fonction.
-- 7h et 8h UTC = 9h à Paris en heure d'été / d'hiver ; la fonction n'envoie qu'à 9h, une fois par jour.

create extension if not exists pg_cron;
create extension if not exists pg_net;

-- Secrets stockés chiffrés dans Vault (pas en clair dans la définition des tâches)
select vault.create_secret('https://plrtqsxhdhreyqsrnsxc.supabase.co', 'cockpit_project_url')
where not exists (select 1 from vault.secrets where name = 'cockpit_project_url');
select vault.create_secret('<CRON_SECRET>', 'cockpit_reminder_secret')
where not exists (select 1 from vault.secrets where name = 'cockpit_reminder_secret');

select cron.unschedule(jobname) from cron.job where jobname in ('cockpit-reminder-7utc', 'cockpit-reminder-8utc');

select cron.schedule(name, sched, $job$
  select net.http_post(
    url     := (select decrypted_secret from vault.decrypted_secrets where name = 'cockpit_project_url') || '/functions/v1/daily-reminder',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'cockpit_reminder_secret')
    ),
    body    := '{}'::jsonb
  );
$job$)
from (values ('cockpit-reminder-7utc', '0 7 * * *'), ('cockpit-reminder-8utc', '0 8 * * *')) as j(name, sched);
