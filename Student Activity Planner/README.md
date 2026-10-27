# Student Activity Planner

This template should help get you started developing with Vue 3 in Vite.

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

Start the API in `../server` (`npm start`) and the client here (`pnpm dev`). The
client calls `http://localhost:8000/api`; set `VITE_API_URL` to point somewhere else.

### Group Meetings

`src/components/GroupWork.vue` is a thin client. The rules live on the server:

- `server/group-meetings.js` holds the availability matching, the booking rules
  and the invitation state machine, with no Express or file I/O, so it is unit
  tested directly.
- `server/group-meetings.test.js` covers all three (`npm test` inside `server/`).
- `server/group-meetings.json` is the live store. It is created on first request
  from `src/data/group-meetings.mock.json`, which documents the data shape.

Endpoints (all require a session cookie):

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/api/group-meetings` | Groups, members, invitations, meetings for the signed-in user |
| POST | `/api/group-meetings/common-time` | Common free slots, or the blockers that stop the calculation |
| POST | `/api/group-meetings/meetings/preview` | Dry run: who is busy at that time, so the form can ask before booking |
| POST | `/api/group-meetings/meetings` | Book a slot: validates it, refuses clashes, blocks it for later searches |
| DELETE | `/api/group-meetings/meetings/:id` | Cancel a meeting (booker or group owner); frees the slot again |
| POST | `/api/group-meetings/groups` | Create a group (creator becomes owner and member) |
| PATCH | `/api/group-meetings/shares` | Turn your own availability sharing on or off |
| POST | `/api/group-meetings/invitations` | Invite a registered account by email |
| POST | `/api/group-meetings/invitations/:id/accept` | Invitee joins the group |
| POST | `/api/group-meetings/invitations/:id/decline` | Invitee refuses |
| POST | `/api/group-meetings/invitations/:id/cancel` | Sender withdraws a pending invitation |
| POST | `/api/group-meetings/demo-group/join` | Join the seeded demo group |

Busy intervals are never sent to the browser; teammates only receive the
resulting free slots.

A booked meeting is also an activity. `/api/planner-data` derives it from the
meeting for every participant, so the Dashboard timeline shows it without a
second copy existing anywhere.

Booking a time that is not shared-free is possible, but never silent: the form
calls the preview endpoint first and asks for confirmation, listing the members
who are busy. A confirmed overlap is stored with `forced: true` and shown as an
`overlap` badge in the meeting list.

### Compile and Hot-Reload for Development

```sh
pnpm dev
```

### Compile and Minify for Production

```sh
pnpm build
```

### Run Unit Tests with [Vitest](https://vitest.dev/)

```sh
pnpm test:unit
```

### Run End-to-End Tests with [Playwright](https://playwright.dev)

```sh
# Install browsers for the first run
npx playwright install

# When testing on CI, must build the project first
pnpm build

# Runs the end-to-end tests
pnpm test:e2e
# Runs the tests only on Chromium
pnpm test:e2e --project=chromium
# Runs the tests of a specific file
pnpm test:e2e tests/example.spec.ts
# Runs the tests in debug mode
pnpm test:e2e --debug
```

### Lint with [ESLint](https://eslint.org/)

```sh
pnpm lint
```
