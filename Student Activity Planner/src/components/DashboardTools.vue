<script setup>
import { computed, ref } from 'vue'

const props = defineProps({
  items: { type: Array, required: true },
  personal: { type: Object, required: true },
  savingItems: { type: Array, default: () => [] },
})
const emit = defineEmits(['complete'])
const editing = ref(false)
const priorityChoice = ref('')
const notice = ref('')
const coursework = computed(() =>
  props.items.filter((item) => !item.done && ['assignment', 'quiz'].includes(item.type)),
)
const available = computed(() =>
  coursework.value.filter((item) => !props.personal.state.priorities.includes(item.key)),
)
const priorities = computed(() =>
  props.personal.state.priorities
    .map((key) => coursework.value.find((item) => item.key === key))
    .filter(Boolean),
)
function addPriority() {
  if (!priorityChoice.value) return
  const added = props.personal.togglePriority(priorityChoice.value)
  notice.value = added ? 'Priority pinned.' : 'You can pin up to three priorities.'
  priorityChoice.value = ''
}
</script>

<template>
  <section class="dashboard-panel priorities-panel p-3 p-sm-4" aria-labelledby="priorities-heading">
    <div class="d-flex align-items-center justify-content-between gap-2 mb-2">
      <h2 id="priorities-heading">Your top three</h2>
      <button
        type="button"
        class="priority-edit"
        :aria-expanded="editing"
        aria-controls="priority-editor"
        @click="editing = !editing"
      >
        {{ editing ? 'Done' : 'Edit' }}
      </button>
    </div>
    <ol v-if="priorities.length" class="priority-list list-unstyled mb-0">
      <li
        v-for="(item, index) in priorities"
        :key="item.key"
        class="priority-row d-flex align-items-start gap-2 gap-sm-3"
      >
        <span class="priority-rank">{{ index + 1 }}</span>
        <div class="flex-grow-1 min-width-0">
          <strong>{{ item.title }}</strong><small>{{ item.courseName }}</small>
        </div>
        <button
          v-if="editing"
          type="button"
          class="btn btn-sm btn-light"
          :aria-label="'Unpin ' + item.title"
          @click="personal.togglePriority(item.key)"
        >
          Unpin
        </button>
        <input
          v-else
          type="checkbox"
          class="form-check-input mt-1"
          :checked="item.done"
          :disabled="savingItems.includes(item.key)"
          :aria-label="'Mark ' + item.title + ' as complete'"
          @change="emit('complete', { item, event: $event })"
        />
      </li>
    </ol>
    <p v-else class="small dashboard-muted mt-3 mb-0">
      {{
        coursework.length
          ? 'Choose up to three coursework priorities. Your next deadline doesn’t have to decide your day.'
          : 'No unfinished coursework. A little room to breathe.'
      }}
    </p>
    <div v-if="editing" id="priority-editor" class="mt-3">
      <label class="form-label" for="priority-choice"
        >Pin coursework · {{ priorities.length }} of 3</label
      >
      <select
        id="priority-choice"
        v-model="priorityChoice"
        class="form-select mb-2"
        :disabled="priorities.length >= 3 || !available.length"
      >
        <option value="">Choose an assignment or quiz</option>
        <option v-for="item in available" :key="item.key" :value="item.key">
          {{ item.title }} · {{ item.courseName }}
        </option>
      </select>
      <button
        type="button"
        class="btn btn-primary"
        :disabled="!priorityChoice || priorities.length >= 3"
        @click="addPriority"
      >
        Pin priority
      </button>
    </div>
    <p class="visually-hidden" role="status">{{ notice }}</p>
  </section>
</template>

<style scoped>
.priority-edit {
  border: 0;
  background: none;
  color: var(--brand);
  font-size: 0.76rem;
  font-weight: 600;
  padding: 8px 0 8px 12px;
  text-decoration: underline;
}
.priority-row {
  padding: 14px 0;
  border-bottom: 1px solid var(--border);
}
.priority-row:last-child {
  border-bottom: 0;
  padding-bottom: 0;
}
.priority-rank {
  display: grid;
  place-items: center;
  width: 28px;
  height: 28px;
  flex: 0 0 28px;
  background: var(--brand-soft);
  color: var(--brand);
  border-radius: 8px;
  font-size: 0.75rem;
  font-weight: 650;
}
.priority-row strong {
  display: block;
  font-size: 0.84rem;
  font-weight: 600;
  overflow-wrap: anywhere;
}
.priority-row small {
  display: block;
  font-size: 0.69rem;
  margin-top: 4px;
  color: var(--muted);
  overflow-wrap: anywhere;
}
.min-width-0 {
  min-width: 0;
}
.dashboard-muted {
  color: var(--muted);
}
.priorities-panel .small {
  font-size: 0.78rem;
  line-height: 1.7;
}
@media (pointer: coarse) {
  .priority-edit {
    min-height: 44px;
  }
}
</style>
