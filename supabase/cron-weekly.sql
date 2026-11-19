-- Planification du résumé hebdomadaire (à exécuter une fois, après le déploiement de weekly-summary).
-- Réutilise les secrets Vault créés par cron-reminder.sql (cockpit_project_url, cockpit_reminder_secret) :
-- exécute d'abord cron-reminder.sql si ce n'est pas déjà fait.
-- Vendredi 17h et 18h UTC = 19h à Paris en heure d'été / d'hiver ; la fonction n'envoie qu'à 19h, une fois par semaine.

create extension if not exists pg_cron;
create extension if not exists pg_net;

select cron.unschedule(jobname) from cron.job where jobname in ('cockpit-weekly-17utc', 'cockpit-weekly-18utc');

select cron.schedule(name, sched, $job$
  select net.http_post(
    url     := (select decrypted_secret from vault.decrypted_secrets where name = 'cockpit_project_url') || '/functions/v1/weekly-summary',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'cockpit_reminder_secret')
    ),
    body    := '{}'::jsonb
  );
$job$)
from (values ('cockpit-weekly-17utc', '0 17 * * 5'), ('cockpit-weekly-18utc', '0 18 * * 5')) as j(name, sched);
