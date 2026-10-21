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
3. **Authentication → Users → Add user** : créer ton compte (email + mot de passe).
4. **Authentication → Sign In / Providers** : désactiver « Allow new users to sign up », pour que personne d'autre ne puisse créer de compte.

Seuls les utilisateurs connectés peuvent lire ou écrire les données (RLS).

## Reprendre les données de l'ancien cockpit HTML

Si des modifications ont été faites dans l'ancien `cockpit_ia_sapaudia_couleurs.html` (statuts, notes, nouvelles actions), procéder ainsi :

1. Ouvrir l'ancien fichier, puis cliquer sur **↓ Export JSON**.
2. Dans le nouveau cockpit, cliquer sur le bouton **Importer** (flèche vers le haut) et choisir le fichier.

L'import fusionne les données : il met à jour les éléments existants et ajoute les nouveaux, sans jamais rien supprimer.

## Raccourcis

- `Ctrl K` : recherche globale (sujets, actions, pages)
- `N` : nouvelle action
- `Échap` : fermer une fenêtre
