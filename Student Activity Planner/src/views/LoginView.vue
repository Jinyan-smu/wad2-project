<script setup>
import { reactive, ref } from 'vue'
import { useRouter, useRoute, RouterLink } from 'vue-router'
import { useAuthStore } from '@/stores/auth'
 
const auth = useAuthStore()
const router = useRouter()
const route = useRoute()
 
const form = reactive({ email: '', password: '' })
const errors = reactive({ email: '', password: '' })
const serverError = ref('')
const loading = ref(false)
 
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
 
function validate() {
  errors.email = ''
  errors.password = ''
 
  if (!form.email.trim()) errors.email = 'Enter your email address.'
  else if (!EMAIL_PATTERN.test(form.email.trim())) errors.email = 'Enter a valid email address.'
 
  if (!form.password) errors.password = 'Enter your password.'
 
  return !errors.email && !errors.password
}
 
async function handleSubmit() {
  serverError.value = ''
  if (!validate()) return
 
  loading.value = true
  try {
    await auth.login({ email: form.email.trim(), password: form.password })
    // Go back to the page the user tried to open, otherwise the dashboard
    router.push(route.query.redirect || '/dashboard')
  } catch (err) {
    serverError.value =
      err.response?.data?.message || 'Could not log in. Check your details and try again.'
  } finally {
    loading.value = false
  }
}
</script>
 
<template>
  <main class="auth-page">
    <div class="auth-card">
      <h1 class="h3 mb-1">Log in</h1>
      <p class="text-muted mb-4">Access your assignments and activities.</p>
 
      <div v-if="serverError" class="alert alert-danger" role="alert">
        {{ serverError }}
      </div>
 
      <form novalidate @submit.prevent="handleSubmit">
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
 
        <div class="mb-4">
          <label for="password" class="form-label">Password</label>
          <input
            id="password"
            v-model="form.password"
            type="password"
            class="form-control"
            :class="{ 'is-invalid': errors.password }"
            autocomplete="current-password"
            :aria-invalid="!!errors.password"
            aria-describedby="password-error"
          />
          <div id="password-error" class="invalid-feedback">{{ errors.password }}</div>
        </div>
 
        <button type="submit" class="btn btn-primary w-100" :disabled="loading">
          <span
            v-if="loading"
            class="spinner-border spinner-border-sm me-2"
            aria-hidden="true"
          ></span>
          {{ loading ? 'Logging in…' : 'Log in' }}
        </button>
      </form>
 
      <p class="text-center text-muted mt-4 mb-0">
        New here?
        <RouterLink to="/register">Create an account</RouterLink>
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
