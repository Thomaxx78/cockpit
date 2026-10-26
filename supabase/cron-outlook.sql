-- Synchronisation horaire de l'agenda Outlook (après le déploiement de outlook-sync).
-- Réutilise les secrets Vault créés par cron-reminder.sql (URL du projet + secret d'appel).

create extension if not exists pg_cron;
create extension if not exists pg_net;

select cron.unschedule(jobname) from cron.job where jobname = 'cockpit-outlook-sync';

select cron.schedule('cockpit-outlook-sync', '5 * * * *', $job$
  select net.http_post(
    url     := (select decrypted_secret from vault.decrypted_secrets where name = 'cockpit_project_url') || '/functions/v1/outlook-sync',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'cockpit_reminder_secret')
    ),
    body    := '{}'::jsonb,
    timeout_milliseconds := 30000
  );
$job$);
