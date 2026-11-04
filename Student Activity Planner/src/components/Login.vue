<script setup>
import PlannerIcon from './PlannerIcon.vue'
import { ref } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import axios from 'axios'

const router = useRouter()
const route = useRoute()

const formEmail = ref('')
const formPassword = ref('')
const emailError = ref('')
const passwordError = ref('')
const serverError = ref('')
const loading = ref(false)

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

function validate() {
  emailError.value = ''
  passwordError.value = ''
  let isValid = true

  if (!formEmail.value.trim()) {
    emailError.value = 'Enter your email address.'
    isValid = false
  } else if (!EMAIL_PATTERN.test(formEmail.value.trim())) {
    emailError.value = 'Enter a valid email address.'
    isValid = false
  }

  if (!formPassword.value) {
    passwordError.value = 'Enter your password.'
    isValid = false
  }

  return isValid
}

async function handleSubmit() {
  serverError.value = ''
  if (!validate()) return

  loading.value = true

  try {
    await axios.post(
      'http://localhost:8000/api/login',
      {
        email: formEmail.value.trim(),
        password: formPassword.value
      },
      {
        withCredentials: true
      }
    )
    await router.push('/dashboard')
  } catch (err) {
    serverError.value =
      err ||
      'Could not log in. Check your details and try again.'
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

      <h1 class="auth-title">Log in</h1>
      <p class="auth-subtitle">Access your assignments and activities.</p>

      <div v-if="route.query.required === 'true'" class="alert alert-warning" role="alert">
        Please log in to access this page.
      </div>

      <div v-if="route.query.registered === 'true'" class="alert alert-success" role="status">
        Registration successful! Please log in.
      </div>

      <div v-if="serverError" class="alert alert-danger" role="alert">
        {{ serverError }}
      </div>

      <form novalidate @submit.prevent="handleSubmit">
        <div class="auth-field">
          <label for="email" class="form-label auth-label">Email: </label>
          <input id="email" v-model="formEmail" type="email" class="form-control" :class="{ 'is-invalid': emailError }"
            autocomplete="email" :aria-invalid="!!emailError" aria-describedby="email-error" />
          <div id="email-error" class="invalid-feedback">{{ emailError }}</div>
        </div>

        <div class="auth-field">
          <label for="password" class="form-label auth-label">Password: </label>
          <input id="password" v-model="formPassword" type="password" class="form-control"
            :class="{ 'is-invalid': passwordError }" autocomplete="current-password" :aria-invalid="!!passwordError"
            aria-describedby="password-error" />
          <div id="password-error" class="invalid-feedback">{{ passwordError }}</div>
        </div>

        <button type="submit" class="btn btn-lg auth-btn" :disabled="loading">
          <span v-if="loading" class="spinner-border spinner-border-sm me-2" aria-hidden="true"></span>
          {{ loading ? 'Logging in…' : 'Log in' }}
        </button>
      </form>

      <p class="auth-footer">
        New here?
        <RouterLink to="/register" class="auth-link">Create an account</RouterLink>
      </p>
    </div>
  </main>
</template>
