<script setup>
import { ref } from 'vue'
import { RouterLink } from 'vue-router'
import LogoutButton from './LogoutButton.vue'
import PlannerIcon from '@/components/icons/PlannerIcon.vue'
import PocketSemesterBrand from './PocketSemesterBrand.vue'

defineProps({
  active: { type: String, required: true },
  mobile: { type: Boolean, default: false },
})
const menu = ref(null)
const links = [
  { to: '/dashboard', label: 'Dashboard', icon: 'grid' },
  { to: '/calendar', label: 'Calendar', icon: 'calendar' },
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
    <RouterLink class="planner-brand" to="/dashboard" aria-label="PocketSemester home">
      <PocketSemesterBrand compact tagline />
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
      <slot name="extra" />
    </nav>
    <LogoutButton />
  </aside>
  <div v-else class="planner-mobile-nav d-lg-none">
    <div class="planner-mobile-bar d-flex align-items-center justify-content-between gap-2">
      <RouterLink class="planner-brand" to="/dashboard" aria-label="PocketSemester home">
        <PocketSemesterBrand compact />
      </RouterLink>
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
          <slot name="extra" />
          <LogoutButton />
        </nav>
      </details>
    </div>
  </div>
</template>
