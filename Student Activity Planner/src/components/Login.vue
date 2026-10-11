<script setup>
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
        <svg width="34" height="34" viewBox="0 0 34 34" aria-hidden="true">
          <rect x="9" y="9" width="22" height="22" rx="5" fill="#8f94d1" />
          <rect x="2" y="2" width="22" height="22" rx="5" fill="#2f3468" />
        </svg>
        <span class="auth-brand-name">Planner</span>
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

<style scoped>
.auth-page {
  min-height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 1.5rem;
  background-color: #8fd0f5;
  background-image:
    url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 200 80'%3E%3Cg fill='%23ffffff' fill-opacity='.8'%3E%3Ccircle cx='55' cy='50' r='24'/%3E%3Ccircle cx='90' cy='38' r='30'/%3E%3Ccircle cx='128' cy='46' r='25'/%3E%3Ccircle cx='158' cy='54' r='18'/%3E%3Crect x='32' y='52' width='142' height='24' rx='12'/%3E%3C/g%3E%3C/svg%3E"),
    url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 200 80'%3E%3Cg fill='%23ffffff' fill-opacity='.8'%3E%3Ccircle cx='55' cy='50' r='24'/%3E%3Ccircle cx='90' cy='38' r='30'/%3E%3Ccircle cx='128' cy='46' r='25'/%3E%3Ccircle cx='158' cy='54' r='18'/%3E%3Crect x='32' y='52' width='142' height='24' rx='12'/%3E%3C/g%3E%3C/svg%3E"),
    url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 200 80'%3E%3Cg fill='%23ffffff' fill-opacity='.8'%3E%3Ccircle cx='55' cy='50' r='24'/%3E%3Ccircle cx='90' cy='38' r='30'/%3E%3Ccircle cx='128' cy='46' r='25'/%3E%3Ccircle cx='158' cy='54' r='18'/%3E%3Crect x='32' y='52' width='142' height='24' rx='12'/%3E%3C/g%3E%3C/svg%3E"),
    url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 200 80'%3E%3Cg fill='%23ffffff' fill-opacity='.8'%3E%3Ccircle cx='55' cy='50' r='24'/%3E%3Ccircle cx='90' cy='38' r='30'/%3E%3Ccircle cx='128' cy='46' r='25'/%3E%3Ccircle cx='158' cy='54' r='18'/%3E%3Crect x='32' y='52' width='142' height='24' rx='12'/%3E%3C/g%3E%3C/svg%3E"),
    linear-gradient(180deg, #d2e6f1 0%, #cee3ef 55%, #bde2f7 100%);
  background-repeat: no-repeat;
  background-position: 6% 12%, 88% 22%, 78% 92%, 10% 86%, 0 0;
  background-size: 260px auto, 190px auto, 340px auto, 210px auto, 100% 100%;
  font-family: system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
}

.auth-card {
  width: 100%;
  max-width: 580px;
  padding: 3rem 3.5rem;
  background: #fbfcfe;
  border-radius: 1.25rem;
  box-shadow: 0 24px 60px rgba(34, 36, 80, 0.25);
}

@media (max-width: 480px) {
  .auth-card {
    padding: 1.75rem 1.5rem;
  }
}

.auth-brand {
  display: flex;
  align-items: center;
  gap: 0.6rem;
  margin-bottom: 2rem;
}

.auth-brand-name {
  font-weight: 700;
  font-size: 1.05rem;
  color: #2f3468;
}

.auth-title {
  font-size: 2rem;
  font-weight: 600;
  color: #1f2150;
  margin: 0 0 0.4rem;
}

.auth-subtitle {
  color: #6b7090;
  margin: 0 0 2.25rem;
}

.auth-field {
  margin-bottom: 1.75rem;
}

.auth-label {
  display: block;
  font-size: 0.85rem;
  color: #8a8fa8;
  margin-bottom: 0.15rem;
}

.auth-card .form-control {
  display: block;
  width: 100%;
  border: 0;
  border-bottom: 2px solid #cfe3e3;
  border-radius: 0;
  background-color: transparent;
  padding: 0.4rem 0 0.55rem;
  font-family: inherit;
  font-size: 1rem;
  color: #1f2150;
  box-shadow: none;
  outline: none;
  transition: border-color 0.2s ease;
}

.auth-card .form-control::placeholder {
  color: #aab0c4;
}

.auth-card .form-control:focus {
  border-bottom-color: #4b4f8f;
  box-shadow: none;
}

.auth-card .form-control.is-invalid {
  border-bottom-color: #dc3545;
  background-image: none;
  padding-right: 0;
}

.invalid-feedback {
  font-size: 0.85rem;
}

.auth-card .auth-btn {
  display: block;
  margin: 2.25rem auto 0;
  padding: 0.8rem 3.5rem;
  border: 0;
  border-radius: 50rem;
  font-family: inherit;
  font-size: 1.1rem;
  font-weight: 600;
  color: #fff;
  background: linear-gradient(135deg, #5a5fa8, #2f3468);
  box-shadow: 0 12px 24px rgba(47, 52, 104, 0.35);
  cursor: pointer;
  transition: transform 0.15s ease, box-shadow 0.15s ease;
}

.auth-card .auth-btn:hover:not(:disabled) {
  color: #fff;
  transform: translateY(-2px);
  box-shadow: 0 16px 28px rgba(47, 52, 104, 0.4);
}

.auth-card .auth-btn:disabled {
  color: #fff;
  opacity: 0.7;
}

.auth-footer {
  margin: 1.75rem 0 0;
  text-align: center;
  color: #6b7090;
}

.auth-link {
  color: #2f3468;
  font-weight: 600;
  text-decoration: none;
}

.auth-link:hover {
  text-decoration: underline;
}
</style>
