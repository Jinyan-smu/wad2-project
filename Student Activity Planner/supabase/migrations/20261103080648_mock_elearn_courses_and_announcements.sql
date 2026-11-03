-- Per-user eLearn mock catalog, course membership, and announcements.
create table if not exists planner_private.course_enrollments (
  user_id uuid not null references planner_private.app_users(id) on delete cascade,
  course_id text not null references planner_private.reference_courses(course_id) on delete cascade,
  enrolled_at timestamptz not null default now(),
  primary key (user_id, course_id)
);

create index if not exists course_enrollments_course_idx
  on planner_private.course_enrollments (course_id, user_id);

create table if not exists planner_private.reference_announcements (
  announcement_id text primary key,
  course_id text not null references planner_private.reference_courses(course_id) on delete cascade,
  sort_order integer not null,
  title text not null,
  body text not null,
  posted_at timestamptz not null,
  source jsonb not null default '{}'::jsonb
);

create index if not exists reference_announcements_course_date_idx
  on planner_private.reference_announcements (course_id, posted_at desc);

revoke all on all tables in schema planner_private from public, anon, authenticated;
revoke all on all sequences in schema planner_private from public, anon, authenticated;
