-- Cockpit IA Sapaudia — schéma Supabase
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
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

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

-- Sécurité : seuls les utilisateurs connectés lisent / écrivent.
alter table public.subjects enable row level security;
alter table public.tasks    enable row level security;
alter table public.events   enable row level security;

drop policy if exists "auth full access" on public.subjects;
create policy "auth full access" on public.subjects
  for all to authenticated using (true) with check (true);
drop policy if exists "auth full access" on public.tasks;
create policy "auth full access" on public.tasks
  for all to authenticated using (true) with check (true);
drop policy if exists "auth full access" on public.events;
create policy "auth full access" on public.events
  for all to authenticated using (true) with check (true);

-- Temps réel (synchronisation entre onglets / appareils)
do $$
begin
  begin alter publication supabase_realtime add table public.subjects; exception when others then null; end;
  begin alter publication supabase_realtime add table public.tasks;    exception when others then null; end;
  begin alter publication supabase_realtime add table public.events;   exception when others then null; end;
end $$;
