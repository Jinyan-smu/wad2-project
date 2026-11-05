<script setup>
import logo from '@/assets/pocketsemester-logo.png'

defineProps({
  compact: { type: Boolean, default: false },
  tagline: { type: Boolean, default: false },
})

const icon = `${import.meta.env.BASE_URL}pocketsemester-icon.png`
</script>

<template>
  <span class="pocketsemester-brand" :class="{ 'is-compact': compact }">
    <template v-if="compact">
      <img class="pocketsemester-mark" :src="icon" alt="" width="40" height="44" />
      <span class="pocketsemester-copy">
        <span class="pocketsemester-name">PocketSemester</span>
        <small v-if="tagline">A LITTLE SPACE FOR EVERYTHING</small>
      </span>
    </template>
    <img
      v-else
      class="pocketsemester-wordmark"
      :src="logo"
      alt="PocketSemester"
      width="270"
      height="56"
    />
  </span>
</template>

<style scoped>
.pocketsemester-brand {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
  max-width: 100%;
  vertical-align: middle;
}

.pocketsemester-wordmark {
  display: block;
  width: 270px;
  max-width: 100%;
  height: auto;
  aspect-ratio: 270 / 56;
  object-fit: cover;
}

.pocketsemester-mark {
  display: block;
  width: 40px;
  height: 44px;
  flex: 0 0 auto;
  object-fit: contain;
}

.pocketsemester-copy {
  min-width: 0;
}

.pocketsemester-name {
  display: block;
  font-weight: 750;
  letter-spacing: -0.045em;
  white-space: nowrap;
}

.pocketsemester-copy small {
  display: block;
  margin-top: 5px;
  font-size: 0.49rem;
  font-weight: 600;
  letter-spacing: 0.1em;
  line-height: 1.5;
  opacity: 0.85;
}

@media (max-width: 480px) {
  .is-compact {
    gap: 6px;
  }

  .pocketsemester-mark {
    width: 32px;
    height: 36px;
  }
}
</style>
