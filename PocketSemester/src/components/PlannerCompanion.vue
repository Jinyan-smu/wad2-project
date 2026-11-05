<script setup>
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import LoginCharacters from './LoginCharacters.vue'

const props = defineProps({
  character: {
    type: String,
    default: 'purple',
    validator: (value) => ['purple', 'coral', 'blue', 'mint'].includes(value),
  },
  message: { type: String, required: true },
  mood: {
    type: String,
    default: 'idle',
    validator: (value) => ['idle', 'excited', 'success', 'error'].includes(value),
  },
})

const palettes = {
  purple: { paper: '#f0eafa', accent: '#8b70bb', label: 'YOUR PLANNING PAL' },
  coral: { paper: '#fcf0f2', accent: '#cb7b8d', label: 'YOUR STUDY SIDEKICK' },
  blue: { paper: '#eaf2fb', accent: '#719cc6', label: 'YOUR ADVENTURE BUDDY' },
  mint: { paper: '#eaf4ef', accent: '#6d9e8d', label: 'YOUR TEAM SPIRIT' },
}
const palette = computed(() => palettes[props.character])
const art = ref(null)
const animate = ref(false)
const hovered = ref(false)
const characterMood = computed(() =>
  props.mood !== 'idle' ? props.mood : hovered.value ? 'excited' : 'idle',
)
const gaze = ref({ x: 0, y: 0 })
let motionPreference
let frame = null

function syncMotion() {
  let reduced = motionPreference?.matches ?? false
  try {
    const saved = sessionStorage.getItem('student-planner:login-reduced-motion')
    reduced ||= saved === 'true'
  } catch {
    // Follow the device preference when browser storage is unavailable.
  }
  animate.value = !reduced
  if (!animate.value) gaze.value = { x: 0, y: 0 }
}

function trackPointer(event) {
  if (!animate.value || event.pointerType === 'touch' || !art.value) return
  if (frame !== null) window.cancelAnimationFrame(frame)
  const { clientX, clientY } = event
  frame = window.requestAnimationFrame(() => {
    frame = null
    if (!animate.value || !art.value) return
    const bounds = art.value.getBoundingClientRect()
    const clamp = (value) => Math.max(-1, Math.min(1, value))
    gaze.value = {
      x: clamp((clientX - bounds.left - bounds.width / 2) / 220),
      y: clamp((clientY - bounds.top - bounds.height / 2) / 220),
    }
  })
}

onMounted(() => {
  motionPreference = window.matchMedia?.('(prefers-reduced-motion: reduce)')
  syncMotion()
  motionPreference?.addEventListener('change', syncMotion)
  window.addEventListener('pointermove', trackPointer, { passive: true })
})

onBeforeUnmount(() => {
  motionPreference?.removeEventListener('change', syncMotion)
  window.removeEventListener('pointermove', trackPointer)
  if (frame !== null) window.cancelAnimationFrame(frame)
})
</script>

<template>
  <div
    class="planner-companion"
    :data-animate="animate"
    :style="{ '--companion-paper': palette.paper, '--companion-accent': palette.accent }"
    @pointerenter="hovered = true"
    @pointerleave="hovered = false"
  >
    <div class="companion-copy">
      <span class="companion-eyebrow">{{ palette.label }}</span>
      <div class="companion-message">
        <Transition name="companion-message" :css="animate">
          <p :key="message">{{ message }}</p>
        </Transition>
      </div>
    </div>
    <div ref="art" class="companion-art" aria-hidden="true">
      <span class="companion-spark companion-spark--one">✧</span>
      <LoginCharacters
        :character="character"
        :mood="characterMood"
        :gaze="gaze"
        :animate="animate"
      />
      <span class="companion-spark companion-spark--two">✦</span>
    </div>
  </div>
</template>

<style scoped>
.planner-companion {
  position: relative;
  isolation: isolate;
  min-width: 0;
  min-height: 98px;
  margin: -4px 0 24px;
  padding: 20px 160px 20px 24px;
  overflow: hidden;
  border: 1px solid color-mix(in srgb, var(--companion-accent) 16%, transparent);
  border-radius: 16px;
  background: var(--companion-paper);
}
.planner-companion::before {
  content: '';
  position: absolute;
  z-index: -1;
  right: -14px;
  bottom: -110px;
  width: 230px;
  height: 230px;
  border-radius: 50%;
  background: color-mix(in srgb, var(--companion-accent) 10%, transparent);
}
.planner-companion::after {
  content: '';
  position: absolute;
  z-index: -1;
  right: 12px;
  bottom: -78px;
  width: 200px;
  height: 200px;
  border: 1px solid color-mix(in srgb, var(--companion-accent) 18%, transparent);
  border-radius: 50%;
}
.companion-eyebrow {
  display: block;
  margin-bottom: 7px;
  color: var(--muted);
  font-size: 0.58rem;
  font-weight: 650;
  letter-spacing: 0.12em;
  line-height: 1.5;
}
.companion-copy p {
  grid-area: 1 / 1;
  margin: 0;
  color: var(--ink);
  font-size: 0.96rem;
  font-weight: 550;
  line-height: 1.5;
  letter-spacing: -0.02em;
}
.companion-message {
  display: grid;
  align-items: center;
  min-height: 3em;
}
.companion-message-enter-active,
.companion-message-leave-active {
  transition:
    opacity 180ms ease,
    transform 180ms ease;
}
.companion-message-enter-from {
  opacity: 0;
  transform: translateY(4px);
}
.companion-message-leave-to {
  opacity: 0;
  transform: translateY(-4px);
}
.planner-companion[data-animate='false'] .companion-message > p {
  transition: none;
  transform: none;
}
@media (prefers-reduced-motion: reduce) {
  .companion-message > p {
    transition: none;
    transform: none;
  }
}
.companion-art {
  position: absolute;
  right: 33px;
  bottom: -9px;
  width: 90px;
  height: 106px;
}
.companion-spark {
  position: absolute;
  color: var(--companion-accent);
  font-size: 17px;
  opacity: 0.65;
}
.companion-spark--one {
  top: 12px;
  left: -18px;
}
.companion-spark--two {
  top: 42px;
  right: -17px;
  font-size: 12px;
}
@media (max-width: 575px) {
  .planner-companion {
    min-height: 106px;
    padding: 17px 112px 17px 17px;
  }
  .companion-copy p {
    font-size: 0.85rem;
  }
  .companion-eyebrow {
    font-size: 0.52rem;
    letter-spacing: 0.08em;
  }
  .companion-art {
    right: 12px;
  }
  .companion-spark--two {
    display: none;
  }
}
</style>
