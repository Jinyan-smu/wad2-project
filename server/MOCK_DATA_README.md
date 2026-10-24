# eLearn reference data

These files were prepared by reading the signed-in eLearn pages opened for this project. They are local reference fixtures, not a live API response or a complete export. Only values visible in the UI (or IDs present in visible eLearn links) are included; some API fields are omitted.

- `courses.json` contains the course names and IDs visible in the All Courses list.
- `assignments.json` contains visible assignment folder names and IDs for IS210 and the visible empty IS115 assignment list. Unobserved API properties are omitted or left null.
- `quizzes.json` contains visible quiz titles, IDs where exposed by eLearn links, and displayed due/availability dates for IS210 and IS115. Attempt counts and evaluation results are intentionally excluded.
- `announcements.json` contains IS210 announcement IDs, titles, posting times, and short summaries. Full announcement copy, author details, and course staff contact information are not included.
- `activities.json` contains the Dashboard's sample activities in its original field format, with fixed ISO 8601 UTC start and end timestamps for this temporary fixture.

Course IDs key the per-course data in the other files. Assignments and quizzes are not associated with module data. Date strings use ISO 8601 UTC timestamps converted from the Singapore times shown in eLearn. The object structures are intended as convenient fixtures inspired by Brightspace response shapes; they are not guaranteed API-complete responses.

For development, additional illustrative records have been added to `assignments.json`, `quizzes.json`, and `announcements.json` so the interface has more content to display. Records marked `IsMock: true` are invented examples, not information observed in eLearn. Keep them separate from any future live API import.
