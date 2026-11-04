import { test, expect } from '@playwright/test'

test('shows required-field errors when login is submitted empty', async ({ page }) => {
  // Setup
  await page.goto('/')

  // Action
  await page.getByRole('button', { name: 'Log in', exact: true }).click()

  // Assert
  await expect(page.getByText('Enter your email address.', { exact: true })).toBeVisible()
  await expect(page.getByText('Enter your password.', { exact: true })).toBeVisible()
  await expect(page.getByLabel('Email', { exact: true })).toBeFocused()
})

test('lets a user show and hide their password', async ({ page }) => {
  await page.goto('/login')
  await page.getByLabel('Password', { exact: true }).fill('example-password')

  await page.getByRole('button', { name: 'Show password', exact: true }).click()
  await expect(page.getByLabel('Password', { exact: true })).toHaveAttribute('type', 'text')

  await page.getByRole('button', { name: 'Hide password', exact: true }).click()
  await expect(page.getByLabel('Password', { exact: true })).toHaveAttribute('type', 'password')
})

test('lets a user open registration, check a password mismatch, and return to login', async ({ page }) => {
  await page.goto('/login')
  await page.getByRole('link', { name: 'Create an account', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Create your account' })).toBeVisible()

  await page.getByLabel('Name:', { exact: true }).fill('Test Student')
  await page.getByLabel('Email:', { exact: true }).fill('student@example.com')
  await page.getByLabel('Password:', { exact: true }).fill('example-password')
  await page.getByLabel('Confirm password:', { exact: true }).fill('different-password')
  await page.getByRole('button', { name: 'Create account', exact: true }).click()
  await expect(page.getByText('Passwords do not match.', { exact: true })).toBeVisible()

  await page.getByRole('link', { name: 'Log in', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Welcome back.' })).toBeVisible()
  await expect(page).toHaveURL(/\/login$/)
})
