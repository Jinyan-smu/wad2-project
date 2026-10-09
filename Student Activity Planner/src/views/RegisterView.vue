<script setup>
import { reactive, ref } from 'vue'
import { useRouter, RouterLink } from 'vue-router'
import { useAuthStore } from '@/stores/auth'
 
const auth = useAuthStore()
const router = useRouter()
 
const form = reactive({ name: '', email: '', password: '', confirmPassword: '' })
const errors = reactive({ name: '', email: '', password: '', confirmPassword: '' })
const serverError = ref('')
const loading = ref(false)
 
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const MIN_PASSWORD_LENGTH = 8
 
function validate() {
  Object.keys(errors).forEach((key) => (errors[key] = ''))
 
  if (!form.name.trim()) errors.name = 'Enter your name.'
 
  if (!form.email.trim()) errors.email = 'Enter your email address.'
  else if (!EMAIL_PATTERN.test(form.email.trim())) errors.email = 'Enter a valid email address.'
 
  if (!form.password) errors.password = 'Create a password.'
  else if (form.password.length < MIN_PASSWORD_LENGTH)
    errors.password = `Use at least ${MIN_PASSWORD_LENGTH} characters.`
 
  if (!form.confirmPassword) errors.confirmPassword = 'Re-enter your password.'
  else if (form.confirmPassword !== form.password)
    errors.confirmPassword = 'Passwords do not match.'
 
  return Object.values(errors).every((message) => !message)
}
 
async function handleSubmit() {
  serverError.value = ''
  if (!validate()) return
 
  loading.value = true
  try {
    await auth.register({
      name: form.name.trim(),
      email: form.email.trim(),
      password: form.password,
    })
    router.push('/dashboard')
  } catch (err) {
    serverError.value =
      err.response?.data?.message || 'Could not create your account. Please try again.'
  } finally {
    loading.value = false
  }
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
            v-model="form.name"
            type="text"
            class="form-control"
            :class="{ 'is-invalid': errors.name }"
            autocomplete="name"
            :aria-invalid="!!errors.name"
            aria-describedby="name-error"
          />
          <div id="name-error" class="invalid-feedback">{{ errors.name }}</div>
        </div>
 
        <div class="mb-3">
          <label for="email" class="form-label">Email</label>
          <input
            id="email"
            v-model="form.email"
            type="email"
            class="form-control"
            :class="{ 'is-invalid': errors.email }"
            autocomplete="email"
            :aria-invalid="!!errors.email"
            aria-describedby="email-error"
          />
          <div id="email-error" class="invalid-feedback">{{ errors.email }}</div>
        </div>
 
        <div class="mb-3">
          <label for="password" class="form-label">Password</label>
          <input
            id="password"
            v-model="form.password"
            type="password"
            class="form-control"
            :class="{ 'is-invalid': errors.password }"
            autocomplete="new-password"
            :aria-invalid="!!errors.password"
            aria-describedby="password-help password-error"
          />
          <div id="password-help" class="form-text">At least 8 characters.</div>
          <div id="password-error" class="invalid-feedback">{{ errors.password }}</div>
        </div>
 
        <div class="mb-4">
          <label for="confirmPassword" class="form-label">Confirm password</label>
          <input
            id="confirmPassword"
            v-model="form.confirmPassword"
            type="password"
            class="form-control"
            :class="{ 'is-invalid': errors.confirmPassword }"
            autocomplete="new-password"
            :aria-invalid="!!errors.confirmPassword"
            aria-describedby="confirm-error"
          />
          <div id="confirm-error" class="invalid-feedback">{{ errors.confirmPassword }}</div>
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
</style>
