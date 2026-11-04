<script setup>
import { ref } from 'vue'
import { RouterLink } from 'vue-router'
import LogoutButton from './LogoutButton.vue'
import PlannerIcon from './PlannerIcon.vue'

defineProps({
  active: { type: String, required: true },
  mobile: { type: Boolean, default: false },
})
const menu = ref(null)
const links = [
  { to: '/dashboard', label: 'Dashboard', icon: 'grid' },
  { to: '/assignments', label: 'Assignments', icon: 'check' },
  { to: '/activities', label: 'Activities', icon: 'pin' },
  { to: '/groupwork', label: 'Group Meetings', icon: 'users' },
]
function closeMenu() {
  if (menu.value) menu.value.open = false
}
</script>

<template>
  <aside v-if="!mobile" class="planner-sidebar d-none d-lg-flex">
    <RouterLink class="planner-brand" to="/dashboard" aria-label="Student Planner home">
      <span class="brand-mark"><PlannerIcon name="book" /></span>
      <span>Student Planner<small>A LITTLE SPACE FOR EVERYTHING</small></span>
    </RouterLink>
    <p class="nav-caption">YOUR WORKSPACE</p>
    <nav class="nav flex-column gap-2" aria-label="Main navigation">
      <RouterLink
        v-for="link in links"
        :key="link.to"
        :to="link.to"
        class="nav-link"
        :class="{ active: active === link.to }"
        :aria-current="active === link.to ? 'page' : undefined"
      >
        <PlannerIcon :name="link.icon" />{{ link.label }}
      </RouterLink>
      <RouterLink class="nav-link" to="/dashboard#dashboard-weather"
        ><PlannerIcon name="cloud" />Weather outlook</RouterLink
      >
      <slot name="extra" />
    </nav>
    <div class="sidebar-note mt-auto">
      <PlannerIcon name="sparkles" />
      <p>A little structure.<br /><strong>More room for life.</strong></p>
    </div>
    <LogoutButton />
  </aside>
  <div
    v-else
    class="planner-mobile-bar d-flex d-lg-none align-items-center justify-content-between gap-2 mb-4"
  >
    <RouterLink class="planner-brand" to="/dashboard"
      ><span class="brand-mark"><PlannerIcon name="book" /></span
      ><span>Student Planner</span></RouterLink
    >
    <details ref="menu" class="planner-mobile-menu">
      <summary class="btn btn-light d-flex align-items-center gap-2">
        <PlannerIcon name="menu" /><span>Menu</span>
      </summary>
      <nav class="planner-mobile-panel nav flex-column gap-1 p-2" aria-label="Mobile navigation">
        <RouterLink
          v-for="link in links"
          :key="link.to"
          :to="link.to"
          class="nav-link"
          :class="{ active: active === link.to }"
          :aria-current="active === link.to ? 'page' : undefined"
          @click="closeMenu"
        >
          <PlannerIcon :name="link.icon" />{{ link.label }}
        </RouterLink>
        <RouterLink class="nav-link" to="/dashboard#dashboard-weather" @click="closeMenu"
          ><PlannerIcon name="cloud" />Weather outlook</RouterLink
        >
        <slot name="extra" />
        <LogoutButton />
      </nav>
    </details>
  </div>
</template>
