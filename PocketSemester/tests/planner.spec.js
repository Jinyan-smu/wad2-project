import process from 'node:process'
import { test, expect } from '@playwright/test'

test('logs in, opens the calendar, and logs out using the real backend', async ({ page }) => {
  test.skip(
    !process.env.PLANNER_TEST_EMAIL || !process.env.PLANNER_TEST_PASSWORD,
    'Start the backend and set PLANNER_TEST_EMAIL and PLANNER_TEST_PASSWORD for a test account.',
  )

  // Setup: use an existing test account. No API responses are mocked.
  await page.goto('/login')
  await page.getByLabel('Email', { exact: true }).fill(process.env.PLANNER_TEST_EMAIL)
  await page.getByLabel('Password', { exact: true }).fill(process.env.PLANNER_TEST_PASSWORD)

  // Actions and assertions follow the user journey.
  await page.getByRole('button', { name: 'Log in', exact: true }).click()
  await expect(page).toHaveURL(/\/dashboard$/)
  await expect(page.getByRole('heading', { name: 'Your week, a little clearer.' })).toBeVisible()

  const navigation = page.getByRole('navigation', { name: 'Main navigation', exact: true })
  await navigation.getByRole('link', { name: 'Calendar', exact: true }).click()
  await expect(page).toHaveURL(/\/calendar$/)
  await expect(page.getByRole('heading', { name: 'Your calendar', exact: true })).toBeVisible()

  page.once('dialog', (dialog) => dialog.accept())
  await page.getByRole('button', { name: /Log out/ }).click()
  await expect(page).toHaveURL(/\/login$/)
  await expect(page.getByRole('heading', { name: 'Welcome back.' })).toBeVisible()

  await page.goto('/calendar')
  await expect(page).toHaveURL(/\/login\?/)
  await expect(page.getByRole('alert')).toHaveText('Please log in to access this page.')
})
