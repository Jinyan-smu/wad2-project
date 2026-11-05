-- Course and coursework fixtures now live in the same private database schema
-- as the user's editable planner data. These tables are not exposed through
-- the Supabase Data API; the Express backend reads them over PostgreSQL.
create table if not exists planner_private.reference_courses (
  course_id text primary key,
  sort_order integer not null,
  name text not null,
  code text,
  source jsonb not null
);

create table if not exists planner_private.reference_assignments (
  course_id text not null references planner_private.reference_courses(course_id) on delete cascade,
  item_id text not null,
  sort_order integer not null,
  name text not null,
  due_at timestamptz,
  is_mock boolean not null default false,
  done boolean not null default false,
  source jsonb not null,
  primary key (course_id, item_id)
);

create index if not exists reference_assignments_course_order_idx
  on planner_private.reference_assignments (course_id, sort_order);

create table if not exists planner_private.reference_quizzes (
  course_id text not null references planner_private.reference_courses(course_id) on delete cascade,
  item_id text not null,
  sort_order integer not null,
  name text not null,
  start_at timestamptz,
  due_at timestamptz,
  is_mock boolean not null default false,
  source jsonb not null,
  primary key (course_id, item_id)
);

create index if not exists reference_quizzes_course_order_idx
  on planner_private.reference_quizzes (course_id, sort_order);

revoke all on all tables in schema planner_private from public, anon, authenticated;
