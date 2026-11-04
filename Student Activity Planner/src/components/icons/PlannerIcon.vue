<script setup>
import { computed } from 'vue'

const props = defineProps({ name: { type: String, required: true } })
const controls = {
  arrow: 'M5 12h14 M12 5l7 7-7 7',
  left: 'M15 18l-6-6 6-6',
  right: 'M9 18l6-6-6-6',
  plus: 'M12 5v14 M5 12h14',
  menu: 'M4 6h16 M4 12h16 M4 18h16',
}
const isControl = computed(() => Boolean(controls[props.name]))
</script>

<template>
  <svg
    class="planner-icon"
    :class="{ 'planner-icon--illustrated': !isControl }"
    :width="isControl ? 20 : 24"
    :height="isControl ? 20 : 24"
    :viewBox="isControl ? '0 0 24 24' : '0 0 32 32'"
    fill="none"
    aria-hidden="true"
    focusable="false"
  >
    <!-- Directional controls stay simple so their actions remain easy to recognize. -->
    <path
      v-if="isControl"
      :d="controls[name]"
      stroke="currentColor"
      stroke-width="2.3"
      stroke-linecap="round"
      stroke-linejoin="round"
    />

    <g v-else-if="name === 'grid'">
      <rect x="3" y="5" width="11" height="11" rx="3" fill="#e8962b" />
      <rect x="3" y="3" width="11" height="11" rx="3" fill="#ffcc6b" />
      <path d="M6 6h4" stroke="#fff3cd" stroke-width="2" stroke-linecap="round" />
      <rect x="18" y="5" width="11" height="11" rx="3" fill="#de568e" />
      <rect x="18" y="3" width="11" height="11" rx="3" fill="#ff94be" />
      <rect x="3" y="20" width="11" height="11" rx="3" fill="#239f9d" />
      <rect x="3" y="18" width="11" height="11" rx="3" fill="#62d3c3" />
      <rect x="18" y="20" width="11" height="11" rx="3" fill="#6451c8" />
      <rect x="18" y="18" width="11" height="11" rx="3" fill="#ad9aff" />
      <path d="M21 21h4" stroke="#e6deff" stroke-width="2" stroke-linecap="round" />
    </g>

    <g v-else-if="name === 'book'">
      <path d="M2 8c5-3 9-3 14 0 5-3 9-3 14 0v21c-5-3-9-3-14 0-5-3-9-3-14 0z" fill="#3264bf" />
      <path d="M4 5c4-2 8-2 12 1v20c-4-3-8-3-12-1z" fill="#f3f6ff" />
      <path d="M16 6c4-3 8-3 12-1v20c-4-2-8-2-12 1z" fill="#d8e8ff" />
      <path d="M16 7v19" stroke="#8bb3ee" stroke-width="1.5" />
      <path
        d="M7 10h5 M7 14h5 M7 18h3 M20 11h4 M20 15h4"
        stroke="#9cb6df"
        stroke-width="1.5"
        stroke-linecap="round"
      />
      <path d="M21 3h4v10l-2-2-2 2z" fill="#ff8e92" />
    </g>

    <g v-else-if="name === 'check'">
      <rect x="5" y="4" width="22" height="27" rx="4" fill="#3561b8" />
      <rect x="4" y="3" width="22" height="26" rx="4" fill="#83b3ff" />
      <rect x="7" y="6" width="16" height="20" rx="2" fill="#fff" />
      <rect x="10" y="1" width="10" height="6" rx="2" fill="#b4a0f6" />
      <path
        d="M10 13l2 2 4-4"
        stroke="#32ae86"
        stroke-width="2.2"
        stroke-linecap="round"
        stroke-linejoin="round"
      />
      <path d="M10 20h6 M10 23h4" stroke="#c7d4ec" stroke-width="1.5" stroke-linecap="round" />
      <path d="M19 21l7-10 4 3-7 10-5 3z" fill="#ffb958" />
      <path d="M26 11l1-1a2 2 0 0 1 3 2v2z" fill="#ff8399" />
      <path d="M19 22l-1 5 5-3z" fill="#f6dcac" />
      <path d="M18 27l1-3 1 2z" fill="#655d82" />
    </g>

    <g v-else-if="name === 'pin'">
      <path d="M2 14l8-3 11 3 9-3v17l-9 3-11-3-8 3z" fill="#60bea2" />
      <path d="M2 13l8-3 11 3 9-3v16l-9 3-11-3-8 3z" fill="#a7e5bc" />
      <path d="M10 10v16 M21 13v16" stroke="#63bdad" stroke-width="1.4" />
      <path d="M4 23l7-5 9 5 6-4" stroke="#fff2bb" stroke-width="3" stroke-linejoin="round" />
      <path d="M25 9c0 6-8 13-8 13S9 15 9 9a8 8 0 1 1 16 0" fill="#ef6c8b" />
      <circle cx="17" cy="9" r="3.3" fill="#fff2f3" />
      <path d="M12 7a5 5 0 0 1 4-3" stroke="#ffb8c8" stroke-width="1.6" stroke-linecap="round" />
    </g>

    <g v-else-if="name === 'users'">
      <path d="M1 25a7 7 0 0 1 14 0v3H1z" fill="#5cc6c3" />
      <circle cx="8" cy="13" r="5" fill="#f4c79e" />
      <path d="M3 13c-1-8 11-8 10 0l-3-3-3 2z" fill="#614f61" />
      <path d="M18 25a7 7 0 0 1 14 0v3H18z" fill="#8a9ef2" />
      <circle cx="25" cy="13" r="5" fill="#b98263" />
      <path d="M20 12c-1-7 11-7 10 1l-3-3-3 2z" fill="#453b59" />
      <path d="M7 28a9 9 0 0 1 18 0v3H7z" fill="#e778a7" />
      <path d="M13 23l3 3 3-3" fill="#ffdfc2" />
      <circle cx="16" cy="17" r="6" fill="#ffdfc2" />
      <path d="M10 16c-1-9 13-9 12 1l-4-4-3 2z" fill="#775546" />
      <path d="M14 18h.1 M18 18h.1" stroke="#775546" stroke-width="1.7" stroke-linecap="round" />
      <path d="M15 21h2" stroke="#d99d89" stroke-width="1.2" stroke-linecap="round" />
    </g>

    <g v-else-if="name === 'cloud'">
      <path
        d="M11 2v2 M2 11h2 M4 4l2 2 M18 4l-2 2"
        stroke="#ffd16e"
        stroke-width="2"
        stroke-linecap="round"
      />
      <circle cx="11" cy="11" r="7" fill="#ffb947" />
      <circle cx="10" cy="10" r="4" fill="#ffdb78" />
      <path d="M9 25a6 6 0 0 1-1-12 8 8 0 0 1 15-1 6 6 0 1 1 2 13z" fill="#97c9f1" />
      <path d="M9 22a5 5 0 0 1-1-10 8 8 0 0 1 15-1 5.5 5.5 0 1 1 2 11z" fill="#f1f8ff" />
      <path
        d="M11 26l-1 3 M18 26l-1 3 M25 26l-1 3"
        stroke="#64bff1"
        stroke-width="2.2"
        stroke-linecap="round"
      />
    </g>

    <g v-else-if="name === 'clock'">
      <circle cx="16" cy="17" r="14" fill="#eaa23e" />
      <circle cx="16" cy="15" r="14" fill="#ffd071" />
      <circle cx="16" cy="15" r="10" fill="#fffaf0" />
      <path
        d="M16 6v2 M25 15h-2 M16 24v-2 M7 15h2"
        stroke="#e8c38b"
        stroke-width="1.5"
        stroke-linecap="round"
      />
      <path
        d="M16 10v6l4 2"
        stroke="#68548f"
        stroke-width="2.3"
        stroke-linecap="round"
        stroke-linejoin="round"
      />
      <circle cx="16" cy="16" r="1.8" fill="#ef7c87" />
      <path d="M7 6a12 12 0 0 1 7-3" stroke="#ffe9b2" stroke-width="1.8" stroke-linecap="round" />
    </g>

    <g v-else-if="name === 'bell'">
      <circle cx="16" cy="27" r="4" fill="#f29445" />
      <path d="M5 24c0-3 3-3 3-10a8 8 0 0 1 16 0c0 7 3 7 3 10z" fill="#ffcd64" />
      <path d="M20 8c3 2 4 4 4 8 0 5 3 5 3 8h-6c-3-7 2-10-1-16" fill="#f9ad48" />
      <path d="M5 24h22" stroke="#e99a36" stroke-width="3" stroke-linecap="round" />
      <path d="M11 13c0-3 2-5 4-5" stroke="#fff0bf" stroke-width="2" stroke-linecap="round" />
      <path d="M16 3v2" stroke="#f3bb57" stroke-width="3" stroke-linecap="round" />
      <circle cx="25" cy="6" r="5" fill="#f4769b" stroke="#fff" stroke-width="1.5" />
    </g>

    <g v-else-if="name === 'sparkles'">
      <path d="M14 5l4 9 9 4-9 4-4 9-4-9-9-4 9-4z" fill="#edaa42" />
      <path d="M14 2l4 9 9 4-9 4-4 9-4-9-9-4 9-4z" fill="#ffd16e" />
      <path d="M14 7l2 6 5 2-7 2z" fill="#fff0b7" />
      <path d="M26 1l1.5 4.5L32 7l-4.5 1.5L26 13l-1.5-4.5L20 7l4.5-1.5z" fill="#f08eb3" />
      <circle cx="5" cy="27" r="2.5" fill="#91b6f6" />
    </g>

    <g v-else-if="name === 'alert'">
      <path d="M13 5a3.5 3.5 0 0 1 6 0l12 21a3 3 0 0 1-3 4H4a3 3 0 0 1-3-4z" fill="#e7a03e" />
      <path d="M13 3a3.5 3.5 0 0 1 6 0l12 21a3 3 0 0 1-3 4H4a3 3 0 0 1-3-4z" fill="#ffd477" />
      <path d="M16 10v8" stroke="#8b5f4c" stroke-width="3" stroke-linecap="round" />
      <circle cx="16" cy="23" r="1.7" fill="#8b5f4c" />
      <path d="M6 23l5-9" stroke="#ffeab9" stroke-width="2" stroke-linecap="round" />
    </g>

    <g v-else>
      <rect x="3" y="5" width="26" height="26" rx="5" fill="#5c67ca" />
      <rect x="3" y="4" width="26" height="25" rx="5" fill="#eef2ff" />
      <path d="M3 9a5 5 0 0 1 5-5h16a5 5 0 0 1 5 5v4H3z" fill="#9f8be9" />
      <path d="M10 2v5 M22 2v5" stroke="#6655ab" stroke-width="3" stroke-linecap="round" />
      <rect x="8" y="17" width="4" height="3" rx="1" fill="#8dace8" />
      <rect x="15" y="17" width="4" height="3" rx="1" fill="#8dace8" />
      <rect x="22" y="17" width="3" height="3" rx="1" fill="#ef95b4" />
      <rect x="8" y="23" width="4" height="3" rx="1" fill="#8dace8" />
      <rect x="15" y="23" width="4" height="3" rx="1" fill="#8dace8" />
    </g>
  </svg>
</template>

<style scoped>
.planner-icon {
  flex-shrink: 0;
  vertical-align: middle;
}
.planner-icon--illustrated {
  filter: drop-shadow(0 1px 1px rgb(37 26 79 / 12%));
}
</style>
