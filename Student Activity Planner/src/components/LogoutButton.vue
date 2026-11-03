<script setup>
import { ref } from 'vue'
import { useRouter } from 'vue-router'
import axios from 'axios'

const router = useRouter()
const loading = ref(false)
const error = ref('')

async function logout() {
  if (!window.confirm('Are you sure you want to log out?')) return

  loading.value = true
  error.value = ''

  try {
    await axios.post('http://localhost:8000/api/logout', {}, { withCredentials: true })
    await router.push('/login')
  } catch {
    error.value = 'Could not log out. Please try again.'
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <nav class="logout-nav" aria-label="Account navigation">
    <p v-if="error" class="logout-error" role="alert">{{ error }}</p>
    <button type="button" class="logout-button" :disabled="loading" @click="logout">
      {{ loading ? 'Logging out…' : '↪ Log out' }}
    </button>
  </nav>
</template>

<style scoped>
.logout-nav {
  display: flex;
  flex-direction: column;
  align-items: stretch;
  gap: .5rem;
  width: 100%;
  margin-top: auto;
  padding-top: 1rem;
}

.logout-button {
  border: 0;
  border-radius: 12px;
  padding: .75rem .875rem;
  color: #fff;
  background: rgb(255 255 255 / 14%);
  font: inherit;
  font-weight: 650;
  cursor: pointer;
  text-align: left;
}

.logout-button:hover:not(:disabled) { background: rgb(255 255 255 / 25%); }
.logout-button:disabled { opacity: .7; cursor: wait; }
.logout-button:focus-visible { outline: 3px solid #a5b4fc; outline-offset: 3px; }
.logout-error { margin: 0; padding: .5rem .75rem; border-radius: .5rem; color: #842029; background: #f8d7da; }

</style>
