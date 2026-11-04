<script setup>
import { computed, ref, watch } from 'vue'
import { RouterLink } from 'vue-router'
import PlannerIcon from './PlannerIcon.vue'
import TaskUrgencyBadge from './TaskUrgencyBadge.vue'
import { getTaskUrgency } from '../utils/taskUrgency'

const props = defineProps({
  items: { type: Array, required: true },
  weekStart: { type: Date, required: true },
  now: { type: Date, required: true },
  savingItems: { type: Array, default: () => [] },
  loading: { type: Boolean, default: false },
  loadError: { type: String, default: '' },
})
const emit = defineEmits(['complete'])
const expanded = ref({ assignment: false, quiz: false })
const weekEnd = computed(() => {
  const end = new Date(props.weekStart)
  end.setDate(end.getDate() + 7)
  return end
})
const weekRange = computed(() => {
  const lastDay = new Date(weekEnd.value)
  lastDay.setDate(lastDay.getDate() - 1)
  const format = (date) => date.toLocaleDateString('en-SG', { day: 'numeric', month: 'short' })
  return format(props.weekStart) + ' – ' + format(lastDay)
})
function itemDate(item) {
  const value = item.type === 'assignment' ? item.dueAt || item.when : item.when || item.dueAt
  if (!value) return null
  const date = new Date(value)
  return Number.isFinite(date.getTime()) ? date : null
}
const groups = computed(() =>
  [
    {
      type: 'assignment',
      heading: 'Assignments due',
      icon: 'check',
      empty: 'No unfinished assignments due in the selected week.',
    },
    {
      type: 'quiz',
      heading: 'Upcoming quizzes',
      icon: 'book',
      empty: 'No upcoming quizzes in the selected week.',
    },
  ].map((group) => ({
    ...group,
    items: props.items
      .filter((item) => {
        if (item.type !== group.type || item.done) return false
        const date = itemDate(item)
        return (
          date &&
          date >= props.weekStart &&
          date < weekEnd.value &&
          (group.type !== 'quiz' || date >= props.now)
        )
      })
      .sort((first, second) => itemDate(first) - itemDate(second)),
  })),
)
function formatDate(item) {
  return itemDate(item).toLocaleString('en-SG', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    hour: 'numeric',
    minute: '2-digit',
  })
}
function urgency(item) {
  return getTaskUrgency(itemDate(item), {
    now: props.now,
    prefix: item.type === 'quiz' ? 'Starts' : 'Due',
  })
}
watch(
  () => props.weekStart.getTime(),
  () => {
    expanded.value = { assignment: false, quiz: false }
  },
)
</script>

<template>
  <section
    class="dashboard-panel weekly-coursework-panel p-3 p-sm-4"
    aria-labelledby="weekly-coursework-heading"
    :aria-busy="loading"
  >
    <div class="d-flex align-items-start justify-content-between gap-2">
      <div class="min-width-0">
        <h2 id="weekly-coursework-heading" tabindex="-1">Weekly coursework</h2>
        <p class="coursework-week mb-0 mt-1">{{ weekRange }}</p>
      </div>
      <RouterLink class="coursework-all" to="/assignments">View all</RouterLink>
    </div>
    <p v-if="loading" class="coursework-state mt-3 mb-0" role="status">
      Loading this week’s coursework…
    </p>
    <p v-else-if="loadError" class="coursework-state mt-3 mb-0">
      Your coursework will appear when the planner loads.
    </p>
    <template v-else>
      <section
        v-for="group in groups"
        :key="group.type"
        class="coursework-group"
        :aria-labelledby="'weekly-' + group.type + '-heading'"
      >
        <div class="d-flex align-items-center gap-2">
          <PlannerIcon :name="group.icon" class="coursework-group-icon" />
          <h3 :id="'weekly-' + group.type + '-heading'" class="mb-0">{{ group.heading }}</h3>
          <span
            class="coursework-count"
            :aria-label="
              group.items.length +
              ' ' +
              (group.type === 'quiz' ? 'upcoming quizzes' : 'assignments due')
            "
            >{{ group.items.length }}</span
          >
        </div>
        <p v-if="!group.items.length" class="coursework-state mb-0 mt-2">{{ group.empty }}</p>
        <ul v-else :id="'weekly-' + group.type + '-list'" class="list-unstyled mb-0">
          <li
            v-for="item in expanded[group.type] ? group.items : group.items.slice(0, 3)"
            :key="item.key"
            class="coursework-row d-flex align-items-start gap-2 gap-sm-3"
            :data-coursework-key="item.key"
          >
            <div class="flex-grow-1 min-width-0">
              <strong>{{ item.title }}</strong>
              <span class="coursework-course">{{ item.courseName || 'Your coursework' }}</span>
              <time :datetime="itemDate(item).toISOString()" class="coursework-date">{{
                formatDate(item)
              }}</time>
              <TaskUrgencyBadge :urgency="urgency(item)" />
            </div>
            <input
              type="checkbox"
              class="form-check-input mt-1"
              :checked="item.done"
              :disabled="savingItems.includes(item.key)"
              :data-completion-key="item.key"
              :aria-label="'Mark ' + item.title + ' as complete'"
              @change="emit('complete', { item, event: $event })"
            />
          </li>
        </ul>
        <button
          v-if="group.items.length > 3"
          type="button"
          class="coursework-more"
          :aria-expanded="expanded[group.type]"
          :aria-controls="'weekly-' + group.type + '-list'"
          @click="expanded[group.type] = !expanded[group.type]"
        >
          {{ expanded[group.type] ? 'Show fewer' : 'Show ' + (group.items.length - 3) + ' more'
          }}<span class="visually-hidden">
            {{ group.type === 'quiz' ? 'quizzes' : 'assignments' }}</span
          >
        </button>
      </section>
    </template>
  </section>
</template>

<style scoped>
.min-width-0 {
  min-width: 0;
}
.coursework-week {
  color: var(--muted);
  font-size: 0.72rem;
}
.coursework-all,
.coursework-more {
  color: var(--brand);
  font-size: 0.74rem;
  font-weight: 600;
  text-underline-offset: 3px;
}
.coursework-all {
  flex-shrink: 0;
  padding: 3px 0 5px 8px;
}
.coursework-group {
  margin-top: 18px;
  padding-top: 18px;
  border-top: 1px solid var(--border);
}
.coursework-group h3 {
  font-size: 0.84rem;
}
.coursework-group-icon {
  width: 24px;
  height: 24px;
  flex: 0 0 24px;
}
.coursework-count {
  margin-left: auto;
  min-width: 24px;
  text-align: center;
  padding: 3px 7px;
  border-radius: 8px;
  background: var(--brand-soft);
  color: var(--brand);
  font-size: 0.7rem;
  font-weight: 650;
}
.coursework-row {
  padding: 13px 0;
  border-bottom: 1px solid var(--border);
}
.coursework-row:last-child {
  border-bottom: 0;
  padding-bottom: 0;
}
.coursework-row strong {
  display: block;
  font-size: 0.83rem;
  font-weight: 600;
  line-height: 1.55;
  overflow-wrap: anywhere;
}
.coursework-course,
.coursework-date {
  display: block;
  margin-top: 4px;
  color: var(--muted);
  font-size: 0.7rem;
  line-height: 1.6;
  overflow-wrap: anywhere;
}
.coursework-date {
  color: var(--ink);
}
.coursework-row .task-urgency-badge {
  margin-top: 7px;
}
.coursework-state {
  color: var(--muted);
  font-size: 0.76rem;
  line-height: 1.7;
}
.coursework-more {
  margin-top: 10px;
  padding: 7px 0;
  border: 0;
  background: none;
  text-decoration: underline;
}
.coursework-more:focus-visible,
.coursework-all:focus-visible {
  outline: 3px solid #bcb0d9;
  outline-offset: 3px;
  border-radius: 3px;
}
@media (pointer: coarse) {
  .coursework-all,
  .coursework-more {
    min-height: 44px;
    display: inline-flex;
    align-items: center;
  }
}
</style>
