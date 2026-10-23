-- Cockpit — schéma Supabase
-- À exécuter une seule fois dans Supabase > SQL Editor, puis exécuter seed.sql.

create table if not exists public.subjects (
  id          text primary key,
  name        text not null,
  category    text not null default '',
  status      text not null default 'À cadrer',
  summary     text not null default '',
  confirmed   text not null default '',
  hypothesis  text not null default '',
  questions   text not null default '',
  people      text not null default '',
  next_step   text not null default '',
  due_date    date,
  origin      text not null default '',
  color       text not null default '#8b94a7',
  notes       text not null default '',
  position    double precision not null default 0,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create table if not exists public.tasks (
  id          text primary key,
  name        text not null,
  subject_id  text references public.subjects(id) on delete set null,
  status      text not null default 'À faire',
  priority    text not null default 'P2',
  owner       text not null default '',
  due_date    date,
  position    double precision not null default 0,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create table if not exists public.events (
  id          text primary key,
  date        date not null,
  name        text not null,
  subject_id  text references public.subjects(id) on delete set null,
  kind        text not null default 'Événement',
  start_time  time,
  end_time    time,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- Migration : heures des événements (pour les bases créées avant leur ajout)
alter table public.events add column if not exists start_time time;
alter table public.events add column if not exists end_time   time;

create index if not exists tasks_subject_idx  on public.tasks(subject_id);
create index if not exists events_subject_idx on public.events(subject_id);
create index if not exists events_date_idx    on public.events(date);

-- updated_at automatique
create or replace function public.touch_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

drop trigger if exists subjects_touch on public.subjects;
create trigger subjects_touch before update on public.subjects
  for each row execute function public.touch_updated_at();
drop trigger if exists tasks_touch on public.tasks;
create trigger tasks_touch before update on public.tasks
  for each row execute function public.touch_updated_at();
drop trigger if exists events_touch on public.events;
create trigger events_touch before update on public.events
  for each row execute function public.touch_updated_at();

-- Sécurité : seul le compte du cockpit (VITE_AUTH_EMAIL) lit / écrit.
-- Même si quelqu'un créait un autre compte, il ne verrait rien.
-- ⚠️ Si tu changes VITE_AUTH_EMAIL, change aussi l'email ci-dessous.
create or replace function public.is_owner() returns boolean
language sql stable as $$
  select coalesce(auth.jwt() ->> 'email', '') = 'cockpit@example.com'
$$;

alter table public.subjects enable row level security;
alter table public.tasks    enable row level security;
alter table public.events   enable row level security;

drop policy if exists "auth full access" on public.subjects;
drop policy if exists "owner only" on public.subjects;
create policy "owner only" on public.subjects
  for all to authenticated using (public.is_owner()) with check (public.is_owner());
drop policy if exists "auth full access" on public.tasks;
drop policy if exists "owner only" on public.tasks;
create policy "owner only" on public.tasks
  for all to authenticated using (public.is_owner()) with check (public.is_owner());
drop policy if exists "auth full access" on public.events;
drop policy if exists "owner only" on public.events;
create policy "owner only" on public.events
  for all to authenticated using (public.is_owner()) with check (public.is_owner());

-- Temps réel (synchronisation entre onglets / appareils)
do $$
begin
  begin alter publication supabase_realtime add table public.subjects; exception when others then null; end;
  begin alter publication supabase_realtime add table public.tasks;    exception when others then null; end;
  begin alter publication supabase_realtime add table public.events;   exception when others then null; end;
end $$;

-- ============================================================
-- Assistant IA (Edge Function ai-chat)
-- ============================================================

-- Propositions en attente de confirmation (opérations groupées, suppressions).
-- Le navigateur n'envoie que l'id : les opérations restent côté serveur.
create table if not exists public.ai_proposals (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid(),
  ops         jsonb not null,
  preview     jsonb not null,
  status      text not null default 'pending',  -- pending | executing | done | cancelled
  result      jsonb,
  created_at  timestamptz not null default now(),
  expires_at  timestamptz not null default now() + interval '10 minutes'
);

-- Journal des requêtes envoyées au modèle (limitation de débit par utilisateur).
create table if not exists public.ai_requests (
  id          bigint generated always as identity primary key,
  user_id     uuid not null default auth.uid(),
  created_at  timestamptz not null default now()
);
create index if not exists ai_requests_user_time_idx on public.ai_requests(user_id, created_at);

alter table public.ai_proposals enable row level security;
alter table public.ai_requests  enable row level security;

drop policy if exists "owner own rows" on public.ai_proposals;
create policy "owner own rows" on public.ai_proposals
  for all to authenticated
  using (public.is_owner() and user_id = auth.uid())
  with check (public.is_owner() and user_id = auth.uid());
drop policy if exists "owner own rows" on public.ai_requests;
create policy "owner own rows" on public.ai_requests
  for all to authenticated
  using (public.is_owner() and user_id = auth.uid())
  with check (public.is_owner() and user_id = auth.uid());

-- ============================================================
-- Rappel quotidien par mail (Edge Function daily-reminder)
-- ============================================================
-- Un envoi par jour au maximum. Aucune politique RLS : seule la fonction (service_role) y accède.
create table if not exists public.reminder_log (
  day      date primary key,
  sent_at  timestamptz not null default now(),
  detail   jsonb
);
alter table public.reminder_log enable row level security;
