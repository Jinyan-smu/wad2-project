<script setup>
import PlannerIcon from '@/components/icons/PlannerIcon.vue'
import { ref } from 'vue'
import { useRouter } from 'vue-router'
import axios from 'axios'


const router = useRouter()

const newName = ref('')
const newEmail = ref('')
const newPassword = ref('')
const confirmPassword = ref('')
const nameError = ref('')
const emailError = ref('')
const passwordError = ref('')
const confirmError = ref('')
const serverError = ref('')
const loading = ref(false)

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const MIN_PASSWORD_LENGTH = 8

function validate() {
  let isValid = true
  if (!newName.value.trim()) {
    nameError.value = 'Enter your name.'
    isValid = false
  }

  if (!newEmail.value.trim()) {
    emailError.value = 'Enter your email address.'
    isValid = false
  }
  else if (!EMAIL_PATTERN.test(newEmail.value.trim())) {
    emailError.value = 'Enter a valid email address.'
    isValid = false
  }

  if (newPassword.value == '') {
    passwordError.value = 'Create a password.'
    isValid = false
  }
  else if (newPassword.value.length < MIN_PASSWORD_LENGTH) {
    passwordError.value = `Use at least ${MIN_PASSWORD_LENGTH} characters.`
    isValid = false
  }

  if (confirmPassword.value == '') {
    confirmError.value = 'Re-enter your password.'
    isValid = false
  }
  else if (confirmPassword.value !== newPassword.value) {
    confirmError.value = 'Passwords do not match.'
    isValid = false
  }


  return isValid
}

async function handleSubmit() {
  serverError.value = ''

  if (!validate()) return

  loading.value = true

  try {
    await axios.post('http://localhost:8000/api/register', {
      name: newName.value.trim(),
      email: newEmail.value.trim(),
      password: newPassword.value
    })

    await router.push({
      name: 'Login',
      query: { registered: 'true' }
    })
  } catch (err) {
    serverError.value =
      err.response?.data?.message ||
      'Could not create your account. Please try again.'
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <main class="auth-page">
    <div class="auth-card">

      <div class="auth-brand">
        <span class="auth-brand-mark"><PlannerIcon name="book" /></span>
        <span class="auth-brand-name">Student Planner</span>
      </div>

      <h1 class="auth-title">Create your account</h1>
      <p class="auth-subtitle">Plan assignments and activities in one place.</p>

      <div v-if="serverError" class="alert alert-danger" role="alert">
        {{ serverError }}
      </div>

      <form novalidate @submit.prevent="handleSubmit">
        <div class="auth-field">
          <label for="name" class="form-label auth-label">Name: </label>
          <input id="name" v-model="newName" type="text" class="form-control" :class="{ 'is-invalid': nameError }"
            autocomplete="name" :aria-invalid="!!nameError" aria-describedby="name-error" />
          <div id="name-error" class="invalid-feedback">{{ nameError }}</div>
        </div>

        <div class="auth-field">
          <label for="email" class="form-label auth-label">Email: </label>
          <input id="email" v-model="newEmail" type="email" class="form-control" :class="{ 'is-invalid': emailError }"
            autocomplete="email" :aria-invalid="!!emailError" aria-describedby="email-error" />
          <div id="email-error" class="invalid-feedback">{{ emailError }}</div>
        </div>

        <div class="auth-pair">
          <div class="auth-field">
            <label for="password" class="form-label auth-label">Password: </label>
            <input id="password" v-model="newPassword" type="password" class="form-control"
              :class="{ 'is-invalid': passwordError }" autocomplete="new-password" :aria-invalid="!!passwordError"
              aria-describedby="password-help password-error" placeholder="At least 8 characters." />
            <div id="password-error" class="invalid-feedback">{{ passwordError }}</div>
          </div>

          <div class="auth-field">
            <label for="confirmPassword" class="form-label auth-label">Confirm password: </label>
            <input id="confirmPassword" v-model="confirmPassword" type="password" class="form-control"
              :class="{ 'is-invalid': confirmError }" autocomplete="new-password" :aria-invalid="!!confirmError"
              aria-describedby="confirm-error" />
            <div id="confirm-error" class="invalid-feedback">{{ confirmError }}</div>
          </div>
        </div>

        <button type="submit" class="btn btn-lg auth-btn" :disabled="loading">
          <span v-if="loading" class="spinner-border spinner-border-sm me-2" aria-hidden="true"></span>
          {{ loading ? 'Creating account…' : 'Create account' }}
        </button>
      </form>

      <p class="auth-footer">
        Already have an account?
        <RouterLink to="/login" class="auth-link">Log in</RouterLink>
      </p>
    </div>
  </main>
</template>
