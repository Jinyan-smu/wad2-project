-- Application-owned tables live outside Supabase's exposed public schema.
-- The Express server connects with a server-only PostgreSQL connection string.
create schema if not exists planner_private;

revoke all on schema planner_private from public, anon, authenticated;
grant usage on schema planner_private to postgres;

alter default privileges for role postgres in schema planner_private
  revoke all on tables from public, anon, authenticated;
alter default privileges for role postgres in schema planner_private
  revoke all on sequences from public, anon, authenticated;

create table if not exists planner_private.app_users (
  id uuid primary key,
  username text not null unique,
  email text not null unique,
  password_hash text not null,
  created_at timestamptz not null default now()
);

create table if not exists planner_private.activities (
  id text primary key,
  owner_id uuid references planner_private.app_users(id) on delete cascade,
  title text not null,
  place text not null default '',
  outdoor boolean not null default false,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  done boolean not null default false,
  notes text not null default '',
  latitude double precision,
  longitude double precision,
  created_at timestamptz not null default now(),
  constraint activities_valid_window check (ends_at > starts_at),
  constraint activities_valid_coordinates check (
    (latitude is null or latitude between -90 and 90) and
    (longitude is null or longitude between -180 and 180)
  )
);

create index if not exists activities_owner_start_idx
  on planner_private.activities (owner_id, starts_at);

create table if not exists planner_private.custom_assignments (
  id text primary key,
  owner_id uuid not null references planner_private.app_users(id) on delete cascade,
  course_id text not null,
  name text not null,
  due_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists custom_assignments_owner_course_idx
  on planner_private.custom_assignments (owner_id, course_id);

create table if not exists planner_private.coursework_progress (
  user_id uuid not null references planner_private.app_users(id) on delete cascade,
  kind text not null check (kind in ('assignment', 'quiz')),
  course_id text not null,
  item_id text not null,
  done boolean not null,
  updated_at timestamptz not null default now(),
  primary key (user_id, kind, course_id, item_id)
);

create table if not exists planner_private.group_meeting_state (
  singleton boolean primary key default true check (singleton),
  state jsonb not null,
  updated_at timestamptz not null default now()
);

create table if not exists planner_private.legacy_imports (
  source_key text primary key,
  imported_at timestamptz not null default now(),
  row_counts jsonb not null
);

revoke all on all tables in schema planner_private from public, anon, authenticated;
revoke all on all sequences in schema planner_private from public, anon, authenticated;
