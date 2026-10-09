<script setup>
import {ref } from 'vue'
// import { useRouter, RouterLink } from 'vue-router'
// import { useAuthStore } from '@/stores/auth'
 
// const auth = useAuthStore()
// const router = useRouter()
 
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
  if (!newName.value.trim()) nameError.value = 'Enter your name.'
 
  if (!newEmail.value.trim()) emailError.value = 'Enter your email address.'
  else if (!EMAIL_PATTERN.test(newEmail.value.trim())) emailError.value = 'Enter a valid email address.'
 
  if (newPassword.value == '') passwordError.value = 'Create a password.'
  else if (newPassword.value.length < MIN_PASSWORD_LENGTH)
    passwordError.value = `Use at least ${MIN_PASSWORD_LENGTH} characters.`
 
  if (confirmPassword.value == '') confirmError.value = 'Re-enter your password.'
  else if (confirmPassword.value !== newPassword.value)
    confirmError.value = 'Passwords do not match.'

}
 
async function handleSubmit() {
  serverError.value = ''
  if (!validate()) return
 
  // loading.value = true
  // try {
  //   await auth.register({
  //     name: newName.trim(),
  //     email: newEmail.trim(),
  //     password: newPassword,
  //   })
  //   router.push('/dashboard')
  // } catch (err) {
  //   serverError.value =
  //     err.response?.data?.message || 'Could not create your account. Please try again.'
  // } finally {
  //   loading.value = false
  // }
  return
}
</script>
 
<template>
  <main class="auth-page">
    <div class="auth-card">
      <h1 class="h3 mb-1">Create your account</h1>
      <p class="text-muted mb-4">Plan assignments and activities in one place.</p>
 
      <div v-if="serverError" class="alert alert-danger" role="alert">
        {{ serverError }}
      </div>
 
      <form novalidate @submit.prevent="handleSubmit">
        <div class="mb-3">
          <label for="name" class="form-label">Name</label>
          <input
            id="name"
            v-model="newName"
            type="text"
            class="form-control"
            :class="{ 'is-invalid': nameError }"
            autocomplete="name"
            :aria-invalid="!!nameError"
            aria-describedby="name-error"
          />
          <div id="name-error" class="invalid-feedback">{{ nameError }}</div>
        </div>
 
        <div class="mb-3">
          <label for="email" class="form-label">Email</label>
          <input
            id="email"
            v-model="newEmail"
            type="email"
            class="form-control"
            :class="{ 'is-invalid': emailError }"
            autocomplete="email"
            :aria-invalid="!!emailError"
            aria-describedby="email-error"
          />
          <div id="email-error" class="invalid-feedback">{{ emailError }}</div>
        </div>
 
        <div class="mb-3">
          <label for="password" class="form-label">Password (At least 8 characters)</label>
          <input
            id="password"
            v-model="newPassword"
            type="password"
            class="form-control"
            :class="{ 'is-invalid': passwordError }"
            autocomplete="new-password"
            :aria-invalid="!!passwordError"
            aria-describedby="password-help password-error"
          />
          <div id="password-error" class="invalid-feedback">{{ passwordError }}</div>
        </div>
 
        <div class="mb-4">
          <label for="confirmPassword" class="form-label">Confirm password</label>
          <input
            id="confirmPassword"
            v-model="confirmPassword"
            type="password"
            class="form-control"
            :class="{ 'is-invalid': confirmError }"
            autocomplete="new-password"
            :aria-invalid="!!confirmError"
            aria-describedby="confirm-error"
          />
          <div id="confirm-error" class="invalid-feedback">{{ confirmError }}</div>
        </div>
 
        <button type="submit" class="btn btn-primary w-100" :disabled="loading">
          <span
            v-if="loading"
            class="spinner-border spinner-border-sm me-2"
            aria-hidden="true"
          ></span>
          {{ loading ? 'Creating account…' : 'Create account' }}
        </button>
      </form>
 
      <p class="text-center text-muted mt-4 mb-0">
        Already have an account?
        <RouterLink to="/login">Log in</RouterLink>
      </p>
    </div>
  </main>
</template>
 
<style scoped>
.auth-page {
  min-height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 1.5rem;
  background-color: var(--bs-light, #f8f9fa);
}
 
.auth-card {
  width: 100%;
  max-width: 420px;
  padding: 2rem;
  background: #fff;
  border: 1px solid var(--bs-border-color, #dee2e6);
  border-radius: 0.75rem;
}
 
@media (max-width: 480px) {
  .auth-card {
    padding: 1.5rem;
  }
}

.invalid-feedback {
  color: red;
}
</style>
