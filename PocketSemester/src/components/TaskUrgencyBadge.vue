<script setup>
defineProps({
  urgency: { type: Object, default: null },
})
</script>

<template>
  <span
    v-if="urgency"
    class="task-urgency-badge"
    :class="`task-urgency-badge--${urgency.level}`"
  >{{ urgency.label }}</span>
</template>

<style scoped>
.task-urgency-badge.task-urgency-badge {
  display: inline-flex;
  align-items: center;
  width: fit-content;
  max-width: 100%;
  padding: 3px 8px;
  border-radius: 999px;
  background: var(--urgency-background);
  color: var(--urgency-color);
  font-size: 0.69rem;
  font-weight: 650;
  line-height: 1.45;
  text-decoration: none;
}

.task-urgency-badge--urgent,
.task-urgency-badge--overdue {
  --urgency-background: #fce9ee;
  --urgency-color: #9b3141;
}

.task-urgency-badge--soon {
  --urgency-background: #fff0d9;
  --urgency-color: #85500d;
}

.task-urgency-badge--week {
  --urgency-background: var(--brand-soft, #f0ecf8);
  --urgency-color: var(--brand, #6250a5);
}

.task-urgency-badge--active {
  --urgency-background: #e4f3eb;
  --urgency-color: #286347;
}
</style>
