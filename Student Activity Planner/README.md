# PocketSemester

A student planner for coursework, activities, and group meetings, built with Vue 3 and Vite.

## Front-end structure

```text
src/
  views/                         # Routed pages, named <Page>View.vue
    __tests__/                   # Page tests and *.integration.spec.js
  components/                    # Reusable UI and sections used by views
    icons/                       # Icon components
    __tests__/                   # Individual component tests
  composables/
    useDashboardPersonalization.js       # Reusable reactive state and methods
    useDashboardPersonalization.spec.js
  utils/                         # Stateless functions and their tests together
    calendarEvents.js
    calendarEvents.spec.js
    taskUrgency.js
    taskUrgency.spec.js
  router/                        # Routes and authentication guard
  assets/                        # Styles and static assets
  data/                          # Local fixtures
  __tests__/
    App.integration.spec.js      # App with real login and registration views
  App.vue
  main.js
tests/                           # Browser workflows run by Playwright
  auth.spec.js
  planner.spec.js
```

Routes import pages from `views/`; pages import reusable UI from `components/`.
Use the `@/` alias for imports across these folders. Week 11 distinguishes
reusable reactive logic (`composables/`) from stateless calculations (`utils/`).
If app-wide Pinia stores are introduced, place them in `src/stores/` and use
state, getters, and actions. Keep data used only by one view in that view.

## Testing approach from Weeks 10 and 11

| Type | Pattern from the slides | Project example |
| --- | --- | --- |
| Function unit test | Week 10a, slides 8–18: call a function, then use `describe`, `it`, `expect`, and matchers. Keep the test beside its function. | `src/utils/taskUrgency.spec.js` checks overdue dates, calendar boundaries, and invalid inputs. |
| Component test | Week 10b, slides 5–10 and 26–27: mount one component, pass props, interact, and check text or emitted events. Stub children when testing the parent alone. | `DashboardWeekSelector.spec.js` checks selection events and displayed workload. `PlannerCompanion.spec.js` stubs its character child. |
| Integration test | Week 10b, slides 15–17 and 28–29: mount real components together and check the result of user interactions. | `DashboardView.integration.spec.js` checks the real week selector updating the agenda and coursework completion updating progress. `App.integration.spec.js` checks links between real public views. |
| Browser workflow | Week 10c, slides 5 and 13–17: use Playwright to visit a page, perform actions, and check the result. | `tests/auth.spec.js` checks form validation and public navigation. `tests/planner.spec.js` checks login, calendar navigation, logout, and the protected-route redirect against the real backend. |

Follow Week 10b's rule: test behavior rather than internal implementation.
Check important text, links, selected states, and emitted events. Avoid asserting
exact markup, decorative CSS classes, or layout measurements. Use explicit dates
for date-dependent function tests so their expected results remain stable.

Existing page tests retain their API/browser mocks and fixed clocks so the
regression suite runs without a backend or external weather service. These are
front-end tests, not proof that the real backend or database works. The real
backend browser workflow does not mock API responses.

## Recommended IDE Setup

[VS Code](https://code.visualstudio.com/) + [Vue (Official)](https://marketplace.visualstudio.com/items?itemName=Vue.volar) (and disable Vetur).

## Recommended Browser Setup

- Chromium-based browsers (Chrome, Edge, Brave, etc.):
  - [Vue.js devtools](https://chromewebstore.google.com/detail/vuejs-devtools/nhdogjmejiglipccpnnnanhbledajbpd)
  - [Turn on Custom Object Formatter in Chrome DevTools](http://bit.ly/object-formatters)
- Firefox:
  - [Vue.js devtools](https://addons.mozilla.org/en-US/firefox/addon/vue-js-devtools/)
  - [Turn on Custom Object Formatter in Firefox DevTools](https://fxdx.dev/firefox-devtools-custom-object-formatters/)

## Customize configuration

See [Vite Configuration Reference](https://vite.dev/config/).

## Project Setup

```sh
pnpm install
```

### Compile and Hot-Reload for Development

```sh
pnpm dev
```

### Compile and Minify for Production

```sh
pnpm build
```

### Run function, component, and integration tests with Vitest

```sh
# Run the complete Vitest suite once
pnpm test:unit --run

# Watch for changes and rerun tests
pnpm test:unit

# Run one function or component test, as in the Week 10 examples
pnpm exec vitest run src/utils/taskUrgency.spec.js
pnpm exec vitest run src/components/__tests__/DashboardWeekSelector.spec.js

# Run the explicitly named integration suites
pnpm test:integration
```

### Run browser tests with Playwright

```sh
# Install browsers for the first run
pnpm exec playwright install

# When testing on CI, must build the project first
pnpm build

# Runs the end-to-end tests
pnpm test:e2e
# Runs the tests only on Chromium
pnpm test:e2e --project=chromium
# Runs the tests of a specific file
pnpm test:e2e tests/auth.spec.js --project=chromium
# Runs the tests in debug mode
pnpm test:e2e --debug

# Open the report, as in Week 10c
pnpm exec playwright show-report
```

Playwright starts the front end automatically and runs browsers without opening
windows. Add `--headed` to watch a test. Vitest only collects tests inside `src/`,
so Playwright tests in `tests/` run separately.

The three public authentication workflows need only the front end. To run the
complete authenticated workflow, start the normal backend on port 8000 and set
`PLANNER_TEST_EMAIL` and `PLANNER_TEST_PASSWORD` in your terminal to an existing
test account's credentials. The authenticated test skips with an explanation
when those values are absent. Keep credentials out of test files and Git. The
workflow uses the account to read the dashboard/calendar and log out; it does
not create, edit, or delete planner records.

### Lint with [ESLint](https://eslint.org/)

```sh
pnpm lint
```
