# eLearn reference data

The course, assignment, and quiz fixtures were imported into the Supabase `planner_private.reference_courses`, `planner_private.reference_assignments`, and `planner_private.reference_quizzes` tables. Their source JSON files were removed after the import was verified.

The data is a partial reference fixture, not a live eLearn API response or a complete export. Records marked `IsMock: true` are invented examples, not information observed in eLearn. The app reads this reference data from Supabase through its Express backend.
