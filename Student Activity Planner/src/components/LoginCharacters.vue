<script setup>
import { computed } from 'vue'

const props = defineProps({
  mood: { type: String, default: 'idle' },
  gaze: { type: Object, default: () => ({ x: 0, y: 0 }) },
  animate: { type: Boolean, default: true },
})

const characters = ['coral', 'mint', 'blue', 'purple']
const sceneStyle = computed(() => {
  const clamp = (value) => Math.max(-1, Math.min(1, Number(value) || 0))
  const x = clamp(props.gaze.x)
  const y = clamp(props.gaze.y)
  return {
    '--look-x': `${x * 5}px`,
    '--look-y': `${y * 4}px`,
    '--lean': `${x * 3}deg`,
  }
})
</script>

<template>
  <div
    class="login-characters"
    :data-mood="mood"
    :data-animate="animate"
    :style="sceneStyle"
    aria-hidden="true"
  >
    <span class="character-spark character-spark--left">✧</span>
    <span class="character-spark character-spark--right">✦</span>
    <div v-for="character in characters" :key="character" class="pal" :class="`pal--${character}`">
      <div class="pal-body">
        <div class="pal-face">
          <div class="pal-eyes">
            <span class="pal-eye"><span class="pal-pupil"></span></span>
            <span v-if="character !== 'purple'" class="pal-eye"
              ><span class="pal-pupil"></span
            ></span>
          </div>
          <span class="pal-mouth"></span>
          <span v-if="character === 'mint'" class="pal-cheek pal-cheek--left"></span>
          <span v-if="character === 'mint'" class="pal-cheek pal-cheek--right"></span>
        </div>
      </div>
      <span class="pal-leg"></span><span class="pal-leg pal-leg--right"></span>
    </div>
  </div>
</template>

<style scoped>
.login-characters {
  --face-ink: #302542;
  --eye-white: #fffdfb;
  --look-x: 0px;
  --look-y: 0px;
  --lean: 0deg;
  position: absolute;
  z-index: 1;
  top: -136px;
  left: 50%;
  width: 340px;
  max-width: calc(100% - 26px);
  height: 240px;
  transform: translateX(-50%);
  pointer-events: none;
}
.pal {
  position: absolute;
  transform: rotate(var(--lean));
  transform-origin: 50% 100%;
  transition: transform 0.48s cubic-bezier(0.18, 0.8, 0.2, 1);
}
.pal-body {
  position: relative;
  width: 100%;
  height: 100%;
  border-radius: inherit;
  background: var(--pal-color);
}
.pal--coral {
  --pal-color: #ef8e9e;
  --blink-delay: 0s;
  z-index: 3;
  top: 18px;
  left: 0;
  width: 32%;
  height: 67px;
  border-radius: 35px;
}
.pal--mint {
  --pal-color: #86c4b3;
  --blink-delay: 1.2s;
  z-index: 4;
  top: 39px;
  left: 27%;
  width: 29%;
  height: 125px;
  border-radius: 32px 32px 25px 25px;
}
.pal--blue {
  --pal-color: #82afe4;
  --blink-delay: 2.4s;
  z-index: 5;
  top: 65px;
  left: 49%;
  width: 25%;
  height: 100px;
  border-radius: 48px 48px 25px 25px;
}
.pal--purple {
  --pal-color: #a18ada;
  --blink-delay: 3.6s;
  z-index: 2;
  top: 0;
  left: 66%;
  width: 32%;
  height: 225px;
  border-radius: 59px 59px 18px 18px;
}
.pal--mint .pal-body::before,
.pal--mint .pal-body::after {
  position: absolute;
  top: 18px;
  width: 24px;
  height: 25px;
  border-radius: 50%;
  background: var(--pal-color);
  content: '';
  box-shadow:
    0 24px 0 var(--pal-color),
    0 48px 0 var(--pal-color);
}
.pal--mint .pal-body::before {
  left: -7px;
}
.pal--mint .pal-body::after {
  right: -7px;
}
.pal-face {
  position: absolute;
  z-index: 1;
  top: 21px;
  left: 50%;
  width: 90%;
  transform: translateX(-50%);
}
.pal--coral .pal-face {
  top: -10px;
}
.pal--blue .pal-face {
  top: 16px;
}
.pal--purple .pal-face {
  top: 39px;
}
.pal-eyes {
  display: flex;
  justify-content: center;
  gap: 6px;
}
.pal-eye {
  position: relative;
  display: grid;
  place-items: center;
  width: 24px;
  height: 27px;
  overflow: hidden;
  border-radius: 50%;
  background: var(--eye-white);
  transition:
    transform 0.22s,
    background-color 0.22s;
}
.pal-eye::after {
  position: absolute;
  inset: -1px;
  border-radius: inherit;
  background: var(--pal-color);
  content: '';
  transform: scaleY(0);
}
.login-characters[data-mood='idle'] .pal-eye::after {
  animation: pal-blink 7s var(--blink-delay) ease-in-out infinite;
}
.pal-pupil {
  width: 11px;
  height: 13px;
  border-radius: 50%;
  background: var(--face-ink);
  transform: translate(var(--look-x), var(--look-y));
  transition: transform 0.16s ease-out;
}
.pal--purple .pal-eye {
  width: 44px;
  height: 48px;
}
.pal--purple .pal-pupil {
  width: 21px;
  height: 24px;
}
.pal-mouth {
  position: absolute;
  top: 36px;
  left: 50%;
  width: 16px;
  height: 10px;
  border-radius: 3px 3px 12px 12px;
  background: var(--face-ink);
  transform: translateX(-50%);
  transition:
    width 0.22s,
    height 0.22s,
    border-radius 0.22s,
    transform 0.22s;
}
.pal--purple .pal-mouth {
  top: 61px;
  width: 20px;
  height: 12px;
}
.pal--coral .pal-mouth {
  top: 35px;
  width: 78%;
  height: 25px;
  border: 3px solid var(--pal-color);
  border-radius: 14px;
  background: repeating-linear-gradient(90deg, var(--eye-white) 0 17px, var(--pal-color) 17px 19px);
}
.pal-cheek {
  position: absolute;
  top: 33px;
  width: 10px;
  height: 6px;
  border-radius: 50%;
  background: #ef8e9e;
  opacity: 0.65;
}
.pal-cheek--left {
  left: 2%;
}
.pal-cheek--right {
  right: 2%;
}
.pal-leg {
  position: absolute;
  z-index: -1;
  top: calc(100% - 4px);
  left: 27%;
  width: 11px;
  height: 28px;
  border-radius: 0 0 8px 8px;
  background: var(--pal-color);
}
.pal-leg--right {
  left: 62%;
}
.pal--coral .pal-leg {
  height: 112px;
  transform: rotate(-14deg);
  transform-origin: top;
}
.pal--coral .pal-leg--right {
  transform: rotate(-23deg);
}
.character-spark {
  position: absolute;
  color: #a18ada;
  line-height: 1;
  transition:
    transform 0.4s,
    opacity 0.4s;
}
.character-spark--left {
  top: 2px;
  left: -11px;
  font-size: 18px;
  opacity: 0.55;
}
.character-spark--right {
  top: -13px;
  right: 3px;
  font-size: 24px;
  opacity: 0.8;
}
.login-characters[data-mood='email'] .pal {
  transform: translateY(-7px) rotate(3deg);
}
.login-characters[data-mood='email'] .pal--blue {
  transform: translateY(-11px) rotate(-5deg);
}
.login-characters[data-mood='private'] .pal {
  transform: translateY(158px);
}
.login-characters[data-mood='private'] .pal-eye {
  background: var(--face-ink);
  transform: scaleY(0.1);
}
.login-characters[data-mood='private'] .pal-pupil {
  opacity: 0;
}
.login-characters[data-mood='private'] .character-spark {
  opacity: 0;
  transform: translateY(18px) scale(0.6);
}
.login-characters[data-mood='peek'] .pal {
  transform: translateY(42px) rotate(-7deg);
}
.login-characters[data-mood='peek'] .pal-pupil {
  transform: translate(-5px, -2px);
}
.login-characters[data-mood='peek'] .pal-eye {
  transform: scaleY(0.75);
}
.login-characters[data-mood='peek'] .pal-mouth {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  border: 0;
  background: var(--face-ink);
}
.login-characters:is([data-mood='excited'], [data-mood='loading']) .pal {
  transform: translateY(-9px) rotate(-4deg);
}
.login-characters:is([data-mood='excited'], [data-mood='loading']) .pal--purple {
  transform: translateY(-5px) rotate(4deg);
}
.login-characters:is([data-mood='excited'], [data-mood='loading']) .pal-mouth {
  height: 15px;
}
.login-characters[data-mood='error'] .pal {
  transform: translateY(5px) rotate(-4deg);
}
.login-characters[data-mood='error'] .pal-mouth {
  width: 13px;
  height: 8px;
  border: 0;
  background: var(--face-ink);
  transform: translateX(-50%) rotate(180deg);
}
.login-characters[data-mood='success'] .pal {
  animation: pal-celebrate 0.55s ease-in-out 2;
}
.login-characters[data-mood='success'] .pal:nth-of-type(odd) {
  animation-delay: 0.1s;
}
.login-characters[data-mood='success'] .pal-eye {
  background: var(--face-ink);
  transform: scaleY(0.14);
}
.login-characters[data-mood='success'] .pal-mouth {
  height: 18px;
}
.login-characters[data-mood='success'] .character-spark {
  transform: scale(1.4) rotate(20deg);
  opacity: 1;
}
@keyframes pal-blink {
  0%,
  94%,
  100% {
    transform: scaleY(0);
  }
  96%,
  98% {
    transform: scaleY(1);
  }
}
@keyframes pal-celebrate {
  0%,
  100% {
    transform: translateY(0) rotate(-3deg);
  }
  50% {
    transform: translateY(-17px) rotate(4deg);
  }
}
@media (max-width: 380px) {
  .pal-eye {
    width: 21px;
    height: 25px;
  }
  .pal-eyes {
    gap: 4px;
  }
  .pal--purple .pal-eye {
    width: 39px;
    height: 43px;
  }
  .pal--purple .pal-mouth {
    top: 56px;
  }
}
.login-characters[data-animate='false'] *,
.login-characters[data-animate='false'] *::before,
.login-characters[data-animate='false'] *::after {
  animation: none !important;
  transition: none !important;
}
.login-characters[data-animate='false'] .pal-pupil {
  transform: none;
}
</style>
