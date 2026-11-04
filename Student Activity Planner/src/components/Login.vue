<script setup>
import PlannerIcon from './PlannerIcon.vue'
import LoginCharacters from './LoginCharacters.vue'
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue'
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
const showPassword = ref(false)
const focusedField = ref(null)
const buttonHovered = ref(false)
const buttonFocused = ref(false)
const outcome = ref('')
const pointerGaze = ref({ x: 0, y: 0 })
const systemReducedMotion = ref(false)
const motionOverride = ref(null)
const reducedMotion = computed(() => motionOverride.value ?? systemReducedMotion.value)
const MOTION_STORAGE_KEY = 'student-planner:login-reduced-motion'
const emailInput = ref(null)
const passwordInput = ref(null)
let motionPreference
let celebrationTimer
let finishCelebration
let disposed = false

// A visible password takes priority over every other playful reaction.
const characterMood = computed(() => {
  if (showPassword.value && (formPassword.value || focusedField.value === 'password')) return 'peek'
  if (loading.value) return outcome.value === 'success' ? 'success' : 'loading'
  if (focusedField.value === 'password') return 'private'
  if (outcome.value) return outcome.value
  if (focusedField.value === 'email') return 'email'
  if (buttonHovered.value || buttonFocused.value) return 'excited'
  return 'idle'
})

const gaze = computed(() => {
  if (reducedMotion.value) return { x: 0, y: 0 }
  if (characterMood.value === 'peek') return { x: -1, y: -0.4 }
  if (focusedField.value === 'email') {
    return { x: Math.min(0.85, formEmail.value.length / 24 - 0.65), y: 0.7 }
  }
  return pointerGaze.value
})

const characterCaption = computed(
  () =>
    ({
      idle: 'Your little welcome committee.',
      email: 'Oh hey, is that you?',
      private: 'No peeking. Promise.',
      peek: "We're looking the other way.",
      excited: 'Ready when you are!',
      loading: 'Making room for your next great day…',
      error: "Let's give those details another look.",
      success: "You're in good company.",
    })[characterMood.value],
)

function trackPointer(event) {
  if (reducedMotion.value || event.pointerType === 'touch') return
  const bounds = event.currentTarget.getBoundingClientRect()
  const clamp = (value) => Math.max(-1, Math.min(1, value))
  pointerGaze.value = {
    x: clamp((event.clientX - bounds.left - bounds.width / 2) / (bounds.width / 2)),
    y: clamp((event.clientY - bounds.top - bounds.height / 2) / (bounds.height / 2)),
  }
}

function clearFieldError(field) {
  if (field === 'email') emailError.value = ''
  else passwordError.value = ''
  serverError.value = ''
  outcome.value = ''
}

function togglePassword() {
  showPassword.value = !showPassword.value
  focusedField.value = 'password'
  passwordInput.value?.focus({ preventScroll: true })
}

function updateMotionPreference(event) {
  systemReducedMotion.value = event.matches
}

function toggleAnimations() {
  motionOverride.value = !reducedMotion.value
  pointerGaze.value = { x: 0, y: 0 }
  try {
    sessionStorage.setItem(MOTION_STORAGE_KEY, String(motionOverride.value))
  } catch {
    // The switch still works when browser storage is unavailable.
  }
}

onMounted(() => {
  try {
    const saved = sessionStorage.getItem(MOTION_STORAGE_KEY)
    if (saved === 'true' || saved === 'false') motionOverride.value = saved === 'true'
  } catch {
    // Fall back to the device preference.
  }
  motionPreference = window.matchMedia?.('(prefers-reduced-motion: reduce)')
  if (motionPreference) {
    systemReducedMotion.value = motionPreference.matches
    motionPreference.addEventListener('change', updateMotionPreference)
  }
})

onBeforeUnmount(() => {
  disposed = true
  window.clearTimeout(celebrationTimer)
  finishCelebration?.()
  motionPreference?.removeEventListener('change', updateMotionPreference)
})

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
  if (loading.value) return
  serverError.value = ''
  outcome.value = ''
  if (!validate()) {
    outcome.value = 'error'
    await nextTick()
    const invalidInput = emailError.value ? emailInput.value : passwordInput.value
    invalidInput?.focus({ preventScroll: true })
    return
  }

  loading.value = true
  focusedField.value = null

  try {
    await axios.post(
      'http://localhost:8000/api/login',
      {
        email: formEmail.value.trim(),
        password: formPassword.value,
      },
      {
        withCredentials: true,
      },
    )
    if (disposed) return
    outcome.value = 'success'
    await new Promise((resolve) => {
      finishCelebration = resolve
      celebrationTimer = window.setTimeout(resolve, reducedMotion.value ? 0 : 450)
    })
    finishCelebration = null
    if (!disposed) await router.push('/dashboard')
  } catch (err) {
    if (disposed) return
    const message = err.response?.data?.message
    serverError.value =
      typeof message === 'string' && message.trim()
        ? message
        : 'Could not log in. Check your details and try again.'
    outcome.value = 'error'
  } finally {
    if (!disposed) loading.value = false
  }
}
</script>

<template>
  <main
    class="peekaboo-login"
    @pointermove="trackPointer"
    @pointerleave="pointerGaze = { x: 0, y: 0 }"
  >
    <div class="login-backdrop" aria-hidden="true">
      <div class="backdrop-halo"></div>
      <div class="backdrop-orbit backdrop-orbit--one"></div>
      <div class="backdrop-orbit backdrop-orbit--two"></div>
      <span class="backdrop-spark backdrop-spark--one">✦</span>
      <span class="backdrop-spark backdrop-spark--two">✧</span>
      <span class="backdrop-spark backdrop-spark--three">✦</span>
      <span class="backdrop-spark backdrop-spark--four">✧</span>
      <div class="planner-note planner-note--checklist">
        <span class="note-tape"></span>
        <span class="note-eyebrow">A NOTE TO SELF</span>
        <span class="note-heading">One thing<br />at a time.</span>
        <span class="note-check"><PlannerIcon name="check" /> A little progress counts.</span>
      </div>
      <div class="planner-note planner-note--calendar">
        <span class="calendar-binding"></span>
        <PlannerIcon name="calendar" />
        <span class="note-eyebrow">ON THE AGENDA</span>
        <span class="note-heading">Make time<br />for you, too.</span>
        <span class="note-mini-line"></span>
      </div>
      <div class="backdrop-books"><span></span><span></span><span></span></div>
      <div class="backdrop-pencil"><span></span></div>
      <div class="backdrop-doodle">a little more<br /><span>living.</span></div>
    </div>

    <header class="login-header">
      <div class="login-brand">
        <span class="login-brand-mark"><PlannerIcon name="book" /></span>
        <span>Student Planner</span>
      </div>
      <span class="login-header-note">BIG PLANS. LITTLE STEPS.</span>
    </header>

    <div class="login-stage">
      <div class="peekaboo-group">
        <LoginCharacters :mood="characterMood" :gaze="gaze" :animate="!reducedMotion" />
        <section class="peekaboo-card" aria-labelledby="login-title">
          <p class="login-eyebrow">A LITTLE SPACE FOR YOUR BIG PLANS</p>
          <h1 id="login-title">Welcome back.</h1>
          <p class="login-intro">Good to see you again.<br />Let's make room for a great day.</p>

          <div v-if="route.query.required === 'true'" class="alert alert-warning" role="alert">
            Please log in to access this page.
          </div>
          <div v-if="route.query.registered === 'true'" class="alert alert-success" role="status">
            Registration successful! Please log in.
          </div>
          <div v-if="serverError" class="alert alert-danger" role="alert">{{ serverError }}</div>

          <form novalidate :aria-busy="loading" @submit.prevent="handleSubmit">
            <div class="login-field">
              <label for="email">Email</label>
              <input
                id="email"
                ref="emailInput"
                v-model="formEmail"
                name="email"
                type="email"
                class="login-input"
                autocomplete="email"
                placeholder="you@university.edu"
                :disabled="loading"
                :aria-invalid="!!emailError"
                aria-describedby="email-error"
                @focus="focusedField = 'email'"
                @blur="focusedField = null"
                @input="clearFieldError('email')"
              />
              <p v-if="emailError" id="email-error" class="login-field-error">{{ emailError }}</p>
            </div>
            <div class="login-field">
              <label for="password">Password</label>
              <div class="login-password-wrap">
                <input
                  id="password"
                  ref="passwordInput"
                  v-model="formPassword"
                  name="password"
                  :type="showPassword ? 'text' : 'password'"
                  class="login-input login-password"
                  autocomplete="current-password"
                  placeholder="Enter your password"
                  :disabled="loading"
                  :aria-invalid="!!passwordError"
                  aria-describedby="password-error"
                  @focus="focusedField = 'password'"
                  @blur="focusedField = null"
                  @input="clearFieldError('password')"
                />
                <button
                  type="button"
                  class="password-toggle"
                  :disabled="loading"
                  :aria-label="showPassword ? 'Hide password' : 'Show password'"
                  :aria-pressed="showPassword"
                  aria-controls="password"
                  @click="togglePassword"
                >
                  {{ showPassword ? 'Hide' : 'Show' }}
                </button>
              </div>
              <p v-if="passwordError" id="password-error" class="login-field-error">
                {{ passwordError }}
              </p>
            </div>
            <button
              type="submit"
              class="login-submit"
              :disabled="loading"
              @pointerenter="buttonHovered = true"
              @pointerleave="buttonHovered = false"
              @focus="buttonFocused = true"
              @blur="buttonFocused = false"
            >
              <span
                v-if="loading && outcome !== 'success'"
                class="login-spinner"
                aria-hidden="true"
              ></span>
              <span>{{
                outcome === 'success' ? "You're in!" : loading ? 'Logging in…' : 'Log in'
              }}</span>
              <PlannerIcon v-if="!loading" name="arrow" />
            </button>
            <span class="login-status" role="status" aria-live="polite">{{
              loading
                ? outcome === 'success'
                  ? 'Login successful. Opening your planner.'
                  : 'Logging in. Please wait.'
                : ''
            }}</span>
          </form>
          <p class="login-signup">
            New here? <RouterLink to="/register">Create an account</RouterLink>
          </p>
        </section>
        <p class="character-caption" aria-hidden="true">{{ characterCaption }}</p>
        <div class="character-motion-control">
          <button type="button" :aria-pressed="!reducedMotion" @click="toggleAnimations">
            {{ reducedMotion ? 'Turn on animations' : 'Pause animations' }}
          </button>
          <span v-if="systemReducedMotion && motionOverride === null"
            >Your device prefers less motion.</span
          >
        </div>
      </div>
    </div>
    <footer class="login-footer">
      <span></span>A little more organised. A little less overwhelmed.
    </footer>
  </main>
</template>

<style scoped>
.peekaboo-login {
  position: relative;
  isolation: isolate;
  display: grid;
  grid-template-rows: auto 1fr auto;
  min-height: 100vh;
  min-height: 100svh;
  overflow: clip;
  color: var(--ink);
  background: #f6f3fb;
}
.login-backdrop {
  position: absolute;
  inset: 0;
  z-index: -1;
  overflow: hidden;
  pointer-events: none;
  background:
    radial-gradient(ellipse at 7% 8%, #ebe7f7 0%, transparent 40%),
    radial-gradient(ellipse at 95% 95%, #f8e5e7 0%, transparent 38%);
}
.login-backdrop::before {
  position: absolute;
  inset: 0;
  content: '';
  background-image: radial-gradient(#a295bd40 0.8px, transparent 0.8px);
  background-size: 23px 23px;
  mask-image: linear-gradient(90deg, #0008, transparent 40%, transparent 60%, #0008);
}
.backdrop-halo {
  position: absolute;
  width: 680px;
  height: 680px;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  border-radius: 50%;
  background: #e9e2f4a6;
}
.backdrop-orbit {
  position: absolute;
  width: 1000px;
  height: 600px;
  top: 52%;
  left: 50%;
  transform: translate(-50%, -50%) rotate(-24deg);
  border: 1px solid #c9bcdf80;
  border-radius: 50%;
}
.backdrop-orbit--two {
  width: 1170px;
  height: 700px;
  transform: translate(-50%, -50%) rotate(24deg);
  border-style: dashed;
  border-color: #c9bcdf60;
}
.login-header {
  position: relative;
  z-index: 3;
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 20px;
  padding: 26px 42px 12px;
}
.login-brand {
  display: flex;
  align-items: center;
  gap: 10px;
  font-size: 1.04rem;
  font-weight: 700;
  letter-spacing: -0.55px;
}
.login-brand-mark {
  width: 40px;
  height: 40px;
  display: grid;
  place-items: center;
  background: #ffffffb3;
  border: 1px solid #e4dced;
  border-radius: 12px;
}
.login-brand-mark .planner-icon {
  width: 28px;
  height: 28px;
}
.login-header-note {
  color: #8a7b9e;
  font-size: 0.65rem;
  font-weight: 600;
  letter-spacing: 1.9px;
}
.login-stage {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  min-width: 0;
  place-items: center;
  padding: 156px 24px 28px;
}
.peekaboo-group {
  position: relative;
  width: 100%;
  max-width: 430px;
  min-width: 0;
}
.peekaboo-card {
  position: relative;
  z-index: 2;
  width: 100%;
  padding: 34px 36px 30px;
  border: 1px solid #e4dceb;
  border-radius: 22px;
  background: #fff;
  box-shadow:
    0 20px 65px #5942750f,
    0 3px 10px #59427505;
}
.login-eyebrow {
  margin: 0 0 19px;
  font-size: 0.58rem;
  font-weight: 650;
  line-height: 1.6;
  letter-spacing: 1.65px;
  color: #81758f;
}
.peekaboo-card h1 {
  margin: 0 0 9px;
  font-size: 2rem;
  font-weight: 650;
  line-height: 1.2;
  letter-spacing: -1.3px;
}
.login-intro {
  margin: 0 0 28px;
  color: var(--muted);
  font-size: 0.84rem;
  line-height: 1.75;
}
.login-field {
  margin-bottom: 20px;
}
.login-field label {
  display: block;
  margin-bottom: 8px;
  font-size: 0.78rem;
  font-weight: 600;
}
.login-input {
  display: block;
  width: 100%;
  min-height: 47px;
  padding: 11px 13px;
  border: 1px solid #ded8e8;
  border-radius: 9px;
  background: #fdfcfe;
  color: var(--ink);
  font: inherit;
  font-size: 0.9rem;
  transition:
    border-color 0.2s,
    box-shadow 0.2s;
}
.login-input::placeholder {
  color: #91889c;
}
.login-input:focus {
  outline: 0;
  border-color: #9c85c5;
  box-shadow: 0 0 0 3px #a58aca20;
}
.login-input:focus-visible {
  outline: 2px solid var(--brand);
  outline-offset: 3px;
}
.login-input[aria-invalid='true'] {
  border-color: var(--red);
}
.login-input:disabled {
  background: #f5f3f8;
  opacity: 0.8;
}
.login-password-wrap {
  position: relative;
}
.login-password {
  padding-right: 66px;
}
.password-toggle {
  position: absolute;
  top: 3px;
  right: 4px;
  min-width: 54px;
  height: 41px;
  padding: 0 8px;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: var(--brand);
  font-size: 0.72rem;
  font-weight: 650;
  cursor: pointer;
}
.password-toggle:hover:not(:disabled) {
  background: var(--brand-soft);
}
.password-toggle:focus-visible,
.login-submit:focus-visible,
.login-signup a:focus-visible {
  outline: 3px solid #aa91d1;
  outline-offset: 4px;
}
.login-field-error {
  color: var(--red);
  font-size: 0.76rem;
  margin: 7px 0 0;
  line-height: 1.5;
}
.login-submit {
  display: flex;
  justify-content: center;
  align-items: center;
  gap: 12px;
  width: 100%;
  min-height: 47px;
  margin-top: 27px;
  padding: 12px 18px;
  border: 0;
  border-radius: 9px;
  background: var(--brand);
  color: #fff;
  font: inherit;
  font-size: 0.85rem;
  font-weight: 600;
  cursor: pointer;
  transition:
    background 0.18s,
    transform 0.18s,
    box-shadow 0.18s;
}
.login-submit:hover:not(:disabled) {
  background: var(--brand-hover);
  transform: translateY(-2px);
  box-shadow: 0 6px 15px #6250a52b;
}
.login-submit:active:not(:disabled) {
  transform: translateY(0);
}
.login-submit:disabled,
.password-toggle:disabled {
  cursor: wait;
  opacity: 0.8;
}
.login-submit .planner-icon {
  width: 16px;
  height: 16px;
}
.login-spinner {
  width: 14px;
  height: 14px;
  border: 2px solid #ffffff55;
  border-top-color: #fff;
  border-radius: 50%;
  animation: login-spin 0.7s linear infinite;
}
.login-status {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip-path: inset(50%);
  white-space: nowrap;
}
.login-signup {
  margin: 25px 0 0;
  text-align: center;
  font-size: 0.77rem;
  color: var(--muted);
}
.login-signup a {
  margin-left: 3px;
  color: var(--brand);
  font-weight: 650;
  text-decoration: none;
}
.login-signup a:hover {
  text-decoration: underline;
  text-underline-offset: 3px;
}
.peekaboo-card .alert {
  font-size: 0.8rem;
  line-height: 1.6;
  padding: 12px 14px;
  border-radius: 9px;
}
.character-caption {
  position: relative;
  z-index: 2;
  min-height: 20px;
  margin: 17px 0 0;
  color: #81738f;
  text-align: center;
  font-size: 0.72rem;
}
.character-motion-control {
  position: relative;
  z-index: 2;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 5px;
  margin: 8px 0 0;
  color: var(--muted);
  font-size: 0.65rem;
}
.character-motion-control button {
  min-height: 32px;
  padding: 5px 10px;
  border: 1px solid #d9cfe7;
  border-radius: 20px;
  color: var(--brand);
  background: #ffffffb3;
  font: inherit;
  font-size: 0.72rem;
  cursor: pointer;
}
.character-motion-control button:focus-visible {
  outline: 2px solid var(--brand);
  outline-offset: 3px;
}
.login-footer {
  position: relative;
  z-index: 2;
  display: flex;
  justify-content: center;
  align-items: center;
  gap: 8px;
  margin: 0;
  padding: 0 20px 24px;
  color: #84768e;
  font-size: 0.7rem;
  text-align: center;
}
.login-footer > span {
  width: 5px;
  height: 5px;
  flex: 0 0 auto;
  border-radius: 50%;
  background: #a18ada;
}
.planner-note {
  position: absolute;
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  border: 1px solid #e1d9e8;
  border-radius: 12px;
  padding: 25px 22px 23px;
  box-shadow: 0 10px 25px #5b477408;
}
.planner-note--checklist {
  width: 210px;
  top: 25%;
  left: max(6%, calc(50% - 540px));
  background: #fffaf2;
  transform: rotate(-9deg);
}
.note-tape {
  position: absolute;
  left: 70px;
  top: -11px;
  width: 65px;
  height: 21px;
  background: #d6c9e891;
  transform: rotate(4deg);
}
.note-eyebrow {
  color: #9b8c95;
  font-size: 8px;
  font-weight: 600;
  letter-spacing: 1.4px;
}
.note-heading {
  margin-top: 13px;
  color: #7a657e;
  font-size: 22px;
  line-height: 1.28;
  letter-spacing: -0.8px;
  font-weight: 600;
}
.note-check {
  display: flex;
  align-items: center;
  gap: 5px;
  margin-top: 21px;
  font-size: 9px;
  color: #938495;
  white-space: nowrap;
}
.note-check .planner-icon {
  width: 17px;
  height: 17px;
}
.planner-note--calendar {
  width: 185px;
  top: 39%;
  right: max(5%, calc(50% - 530px));
  padding: 22px 23px;
  background: #f1f8f4;
  transform: rotate(8deg);
}
.planner-note--calendar > .planner-icon {
  width: 34px;
  height: 34px;
  margin-bottom: 14px;
  opacity: 0.85;
}
.planner-note--calendar .note-heading {
  margin-top: 10px;
  color: #6a8379;
  font-size: 20px;
}
.calendar-binding {
  position: absolute;
  top: -5px;
  left: 22px;
  width: 7px;
  height: 15px;
  border-radius: 4px;
  background: #b0c9bc;
  box-shadow: 126px 0 #b0c9bc;
}
.note-mini-line {
  width: 60px;
  height: 3px;
  margin-top: 19px;
  background: #c8dacf;
  border-radius: 3px;
}
.backdrop-spark {
  position: absolute;
  color: #ad97cc;
  font-size: 27px;
}
.backdrop-spark--one {
  top: 17%;
  right: 24%;
  transform: rotate(12deg);
}
.backdrop-spark--two {
  top: 62%;
  left: 24%;
  font-size: 37px;
  color: #b1c9be;
}
.backdrop-spark--three {
  bottom: 16%;
  right: 15%;
  font-size: 17px;
  color: #d8a6a9;
}
.backdrop-spark--four {
  top: 16%;
  left: 25%;
  font-size: 17px;
}
.backdrop-books {
  position: absolute;
  left: max(8%, calc(50% - 480px));
  bottom: 14%;
  width: 150px;
  height: 90px;
  transform: rotate(-8deg);
}
.backdrop-books span {
  position: absolute;
  bottom: 0;
  display: block;
  width: 135px;
  height: 27px;
  border: 5px solid #c4b2df;
  border-left-width: 13px;
  border-radius: 5px 8px 8px 5px;
  background: #fff9ee;
}
.backdrop-books span:nth-child(2) {
  bottom: 25px;
  left: 9px;
  width: 123px;
  border-color: #eac0b6;
}
.backdrop-books span:nth-child(3) {
  bottom: 50px;
  left: 2px;
  width: 130px;
  border-color: #b8c9df;
}
.backdrop-pencil {
  position: absolute;
  right: 15%;
  top: 18%;
  width: 13px;
  height: 111px;
  background: linear-gradient(90deg, #f0b89b 50%, #f8cdb4 50%);
  border-radius: 4px 4px 0 0;
  transform: rotate(32deg);
}
.backdrop-pencil::before {
  content: '';
  position: absolute;
  top: -14px;
  width: 13px;
  height: 18px;
  background: #dd9aa7;
  border-radius: 5px 5px 0 0;
  border-bottom: 5px solid #e1d6d2;
}
.backdrop-pencil::after {
  content: '';
  position: absolute;
  bottom: -20px;
  border-left: 6.5px solid transparent;
  border-right: 6.5px solid transparent;
  border-top: 20px solid #ddc6a2;
}
.backdrop-pencil span {
  position: absolute;
  bottom: -20px;
  left: 4px;
  z-index: 1;
  border-left: 2.5px solid transparent;
  border-right: 2.5px solid transparent;
  border-top: 7px solid #736773;
}
.backdrop-doodle {
  position: absolute;
  right: 9%;
  bottom: 12%;
  transform: rotate(-9deg);
  color: #b49ab7;
  font-family: Georgia, serif;
  font-size: 22px;
  font-style: italic;
  line-height: 1.3;
}
.backdrop-doodle span {
  display: inline-block;
  border-bottom: 2px solid #d6bdce;
  padding-bottom: 3px;
}
@keyframes login-spin {
  to {
    transform: rotate(360deg);
  }
}
@media (max-width: 1100px) {
  .planner-note--checklist {
    left: 3%;
    width: 170px;
    padding: 24px 17px 19px;
  }
  .planner-note--calendar {
    right: 3%;
    width: 155px;
    padding: 20px 17px;
  }
  .note-heading {
    font-size: 19px;
  }
  .note-check {
    font-size: 7.5px;
    gap: 3px;
  }
  .calendar-binding {
    box-shadow: 95px 0 #b0c9bc;
  }
  .backdrop-books {
    left: 5%;
    width: 125px;
    scale: 0.85;
  }
  .backdrop-pencil {
    right: 10%;
  }
  .backdrop-doodle {
    right: 5%;
    font-size: 19px;
  }
}
@media (max-width: 820px) {
  .planner-note--checklist {
    left: -70px;
    top: 23%;
    opacity: 0.55;
  }
  .planner-note--calendar {
    right: -74px;
    top: 51%;
    opacity: 0.55;
  }
  .backdrop-books {
    left: -30px;
    bottom: 12%;
    opacity: 0.65;
    scale: 0.7;
  }
  .backdrop-doodle {
    display: none;
  }
  .backdrop-pencil {
    right: 7%;
    top: 15%;
    height: 75px;
    opacity: 0.6;
  }
  .login-header {
    padding: 24px 26px 12px;
  }
  .login-header-note {
    display: none;
  }
}
@media (max-width: 480px) {
  .login-header {
    padding: 20px 22px 10px;
  }
  .login-brand {
    font-size: 0.96rem;
  }
  .login-brand-mark {
    width: 35px;
    height: 35px;
  }
  .login-stage {
    padding: 150px 20px 23px;
  }
  .peekaboo-card {
    padding: 29px 25px 27px;
    border-radius: 19px;
  }
  .peekaboo-card h1 {
    font-size: 1.82rem;
  }
  .login-eyebrow {
    font-size: 0.5rem;
    letter-spacing: 1.15px;
  }
  .login-input {
    font-size: 1rem;
  }
  .login-intro {
    font-size: 0.81rem;
  }
  .login-footer {
    font-size: 0.61rem;
    padding-bottom: 20px;
    gap: 6px;
  }
  .backdrop-halo {
    width: 470px;
    height: 650px;
  }
  .planner-note--checklist {
    top: 19%;
    left: -113px;
    opacity: 0.35;
  }
  .planner-note--calendar {
    right: -120px;
    opacity: 0.4;
  }
  .backdrop-books,
  .backdrop-pencil {
    display: none;
  }
  .backdrop-spark--one {
    right: 9%;
    top: 19%;
    font-size: 18px;
  }
  .backdrop-spark--two {
    left: 4%;
    top: 53%;
    font-size: 20px;
  }
  .backdrop-spark--four {
    left: 11%;
    top: 13%;
  }
}
@media (prefers-reduced-motion: reduce) {
  .login-input,
  .login-submit {
    transition: none;
  }
  .login-submit:hover:not(:disabled) {
    transform: none;
  }
  .login-spinner {
    animation: none;
  }
}
</style>
