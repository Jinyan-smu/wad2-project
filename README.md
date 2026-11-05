# PocketSemester

PocketSemester helps students keep track of assignments, activities, and group meetings in one place. It also includes a calendar, activity maps, and weather updates for outdoor plans.

- **GitHub:** [Jinyan-smu/wad2-project](https://github.com/Jinyan-smu/wad2-project)
- **Open the app:** [http://localhost:5173/] after following the steps below.
- The app runs locally and is not hosted online.

## Setting up

You will need Node.js 24.12 or later, pnpm, and an internet connection.

Unzip the project and keep the `server` and `Student Activity Planner` folders together.

The `.env` files and database certificate are already in place. The server connects to our existing Supabase database, which has the demo accounts and sample coursework ready to use.

## Running the app

Open two terminals in the main project folder, where you can see both application folders.

**In the first terminal, start the server:**

```sh
cd server
pnpm install
pnpm start
```

You should see `Server running at http://localhost:8000/`.

**In the second terminal, start the website:**

```sh
cd "PocketSemester"
pnpm install
pnpm dev --port 5173 --strictPort
```

Keep both terminals running and open [http://localhost:5173/]. This opens the login page. The website starts from its `index.html` file.

You only need to run `pnpm install` the first time, or when the project's packages change.

## Demo accounts

Use the email address to log in. These are the accounts created by the demo setup:

| Name | Email | Password |
| --- | --- | --- |
| Rithik Panneer | rithik.p.2025@computing.smu.edu.sg | `12345678` |
| Huang Chujun | cj.huang.2025@computing.smu.edu.sg | `23456781` |
| Yang Qizuo | qizuo.yang.2025@computing.smu.edu.sg | `34567812` |
| Zhang Jinyan | jy.zhang.2025@computing.smu.edu.sg | `456781234` |

Use Rithik's account for the main demo. For group features, open another account in a private window or a separate browser. New accounts created through registration will not automatically have courses assigned to them.

3 of the accounts are in a group together in the group meetings tab. You can test the interactions between accounts to observe the functionality of the group meetings feature by using different accounts.

## Testing the app

### Things to try

Start both servers and use the demo accounts above. Give any new test items names you can easily find later.

#### Login

- Submit the empty form. The page should ask for your email and password.
- Click
- Log in with a demo account. You should land on the Dashboard. Log out and try opening `/calendar` directly. The app should take you back to Login.

#### Registration

- Click **Create an account** from the login page. Fill in the form with two different passwords and check that it asks you to make them match.

#### Dashboard

- Pick another day in the week view to see its schedule. Use **Today** to return to today's plans.
- Open **Details** under **Weather & your plans** to see the forecast and any warnings about outdoor plans.

#### Calendar

- Select an assignment or activity on the calendar. Check that it appears on the right date and that its details match the item you selected.

#### Assignments

- Add an assignment to one of your courses. Mark it complete, then refresh the page to check that the assignment and its completed status were saved.

#### Activities

- Add an activity with a location, edit its time, then delete it. Check that it appears on the map and list, shows the updated time, and disappears after you delete it.
- Click a pin on the map to see the activity's details.
- Switch between **Today**, **This week**, and **All upcoming**. The map and list should show activities for the selected period. The week runs from Monday to Sunday.
- If a weather alert appears, hide its details and open them again. Alerts depend on the live forecast and the activity date.

If the map takes a while to load, try opening another page from the navigation menu, then return to Activities.

#### Group Meetings

- Open the existing demo group from two accounts in separate browser sessions to see how the group looks to each member.
- Create a group in one account and join it from another using the group code. Both accounts should see the group.
- Pick a time when everyone is free and add the meeting to their calendars. Check that it appears in both schedules.
- Click **Book a meeting room**. The SMU room booking site should open in a new tab.

### Test scripts

From the `Student Activity Planner` folder, run:

```sh
pnpm test:unit --run
pnpm test:integration
```

These check the website's functions and screens without needing a running server.

From the `server` folder, run:

```sh
pnpm test
```

These check the group meeting logic and server routes without changing the saved database records.

To run the browser tests, go to `Student Activity Planner` and run:

```sh
pnpm exec playwright install chromium
pnpm test:e2e tests/auth.spec.js --project=chromium
```

This checks the login and registration pages. To also test signing in and opening the calendar, keep the server running and use these commands in PowerShell:

```powershell
$env:PLANNER_TEST_EMAIL = 'rithik.p.2025@computing.smu.edu.sg'
$env:PLANNER_TEST_PASSWORD = '12345678'
pnpm test:e2e --project=chromium
```

The browser tests start the website automatically if it is not already running. The sign-in test is skipped if the two account settings above are missing.

## If something does not work

- **The server will not start:** check the database settings in `server/.env` and that the certificate file is present.
- **Login is not working:** check that both terminals are still running and use the demo login details above.
- **The map is blank:** check the Google Maps key and that Maps JavaScript API is enabled for it.
- **Today has no activities:** try All upcoming, or add an activity for today.
