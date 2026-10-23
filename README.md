# cockpit

Cockpit IA Sapaudia : pilotage des sujets, actions, kanban et calendrier, avec synchronisation Supabase.

Stack : Vite, React, TypeScript, Supabase (base de données, authentification, temps réel) et dnd-kit (glisser-déposer).

## Démarrage

```bash
npm install
cp .env.example .env   # renseigner VITE_SUPABASE_URL et VITE_SUPABASE_ANON_KEY
npm run dev
```

Sans `.env`, l'application fonctionne en **mode local**. Les données restent alors dans le navigateur.

## Mise en place Supabase (une seule fois)

1. **SQL Editor** : exécuter `supabase/schema.sql` (tables, sécurité RLS, temps réel).
2. **SQL Editor** : exécuter `supabase/seed.sql`. Il contient toutes les données de la réunion du 21/10/2026 : 9 sujets, 12 actions et 8 événements. Le script est idempotent et n'écrase rien.
3. **Authentication → Users → Add user → Create new user** : email = la valeur de `VITE_AUTH_EMAIL`, mot de passe = ton code à 6 chiffres. Cocher « Auto Confirm User ».
4. **Authentication → Sign In / Providers** : désactiver « Allow new users to sign up », pour que personne d'autre ne puisse créer de compte.

### Sécurité du code PIN

- Le code n'est **jamais** dans le code source ni dans le `.env`. Tout ce qui commence par `VITE_` est visible dans le navigateur. Le code est le mot de passe du compte Supabase, stocké haché côté serveur.
- La vérification se fait chez Supabase, qui limite le nombre de tentatives par adresse IP (**Authentication → Rate Limits**).
- Seuls les utilisateurs connectés peuvent lire ou écrire les données (RLS).
- Pour changer le code : **Authentication → Users → ⋯ → Reset password**, ou modifier le mot de passe de l'utilisateur.

## Reprendre les données de l'ancien cockpit HTML

Si des modifications ont été faites dans l'ancien `cockpit_ia_sapaudia_couleurs.html` (statuts, notes, nouvelles actions), procéder ainsi :

1. Ouvrir l'ancien fichier, puis cliquer sur **↓ Export JSON**.
2. Dans le nouveau cockpit, cliquer sur le bouton **Importer** (flèche vers le haut) et choisir le fichier.

L'import fusionne les données : il met à jour les éléments existants et ajoute les nouveaux, sans jamais rien supprimer.

## Raccourcis

- `Ctrl K` : recherche globale (sujets, actions, pages)
- `N` / `E` / `S` : nouvelle action / nouvel événement / nouveau sujet
- `Échap` : fermer une fenêtre

## Assistant IA

Le bouton ✦ en bas à droite ouvre un assistant qui agit sur les données en langage naturel : créer, modifier, déplacer ou rechercher des actions, des sujets et des événements. Il utilise Groq (offre gratuite) au travers de la Edge Function `supabase/functions/ai-chat`.

### Fonctionnement et sécurité

- Le navigateur appelle la fonction avec le jeton de session. La fonction vérifie l'utilisateur, puis `public.is_owner()`. Toutes les lectures et écritures passent par ce jeton : la RLS s'applique et aucune clé `service_role` n'est utilisée.
- Le modèle ne fait que **proposer** des appels d'outils (`list_tasks`, `create_task`, `update_task`, `move_task`, `bulk_update_tasks`, `reorder_tasks_by_priority`, `delete_task`, `list_subjects`, `create_subject`, `update_subject`, `list_events`, `create_event`, `update_event`, `delete_event`). Le serveur valide chaque paramètre (identifiants existants, statuts, priorités, dates, heures).
- Une modification simple est exécutée directement. Les **suppressions et opérations groupées** produisent une proposition enregistrée dans `ai_proposals` : elle est liée à l'utilisateur, expire au bout de 10 minutes, ne s'exécute qu'une seule fois et ses données sont revérifiées au moment de l'exécution. Le navigateur n'envoie que son identifiant.
- Les messages de réussite sont rédigés par le serveur à partir du résultat réel en base, pas par le modèle.
- Les quotas sont maîtrisés :
  - limite par utilisateur dans `ai_requests` (8 messages par minute et 200 par jour par défaut) ;
  - 4 appels au modèle au maximum par message ;
  - historique limité aux 8 derniers messages ;
  - résultats d'outils tronqués à 25 éléments ;
  - `max_completion_tokens` plafonné ;
  - erreurs 429 et délais dépassés gérés.

### Mise en place

```bash
# 1. SQL Editor : relancer supabase/schema.sql (crée ai_proposals et ai_requests)
# 2. Clé Groq gratuite : https://console.groq.com/keys
npx supabase login
npx supabase secrets set GROQ_API_KEY=gsk_xxx --project-ref <ref-du-projet>
# 3. Déploiement de la fonction
npx supabase functions deploy ai-chat --project-ref <ref-du-projet>
```

`<ref-du-projet>` est le sous-domaine de `VITE_SUPABASE_URL`, c'est-à-dire la partie avant `.supabase.co`. Les réglages optionnels (modèle, fournisseur, limites) sont listés dans `.env.example`.

### Tests

```bash
npm run test:ai   # 17 scénarios : création, statut, Kanban, recherche, ambiguïté, confirmation, injection, quota…
```

## Rappel quotidien par mail

Les jours où une réunion (hors cours) ou une échéance d'action est prévue, un mail récapitulatif est envoyé à **9h, heure de Paris**. Les jours sans rien de prévu, aucun mail n'est envoyé.

- Edge Function `supabase/functions/daily-reminder`, envoi via [Resend](https://resend.com).
- Déclenchement par `pg_cron` à 7h et 8h UTC (voir `supabase/cron-reminder.sql`). Seule l'exécution qui tombe à 9h à Paris envoie le mail, en heure d'été comme en heure d'hiver, une seule fois par jour (table `reminder_log`).
- Secrets Supabase : `CRON_SECRET`, `RESEND_API_KEY`, `REMINDER_TO`, `APP_URL` (optionnel), `REMINDER_FROM` (optionnel, par défaut `onboarding@resend.dev`).
- Pour mettre en pause : `select cron.unschedule('cockpit-reminder-7utc'); select cron.unschedule('cockpit-reminder-8utc');`
