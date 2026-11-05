# eLearn reference data

The course, assignment, and quiz fixtures were imported into the Supabase `planner_private.reference_courses`, `planner_private.reference_assignments`, and `planner_private.reference_quizzes` tables. Their source JSON files were removed after the import was verified.

The data is a partial reference fixture, not a live eLearn API response or a complete export. Records marked `IsMock: true` are invented examples, not information observed in eLearn. The app reads this reference data from Supabase through its Express backend.

## Four-user mock eLearn

The `PocketSemester/supabase/migrations` folder adds private course-enrollment and announcement tables. Run the migrations, then run `pnpm seed:mock-elearn` from `server/` to create/update the four demo logins, 12 sample courses, 36 assignments, 24 quizzes, and 36 announcements. Each learner is enrolled in three separate courses; the planner API returns only that learner's courses and course content. Passwords are stored as bcrypt hashes. All course titles, assessment details, dates, and announcements are fictional practice data, not eLearn exports.
