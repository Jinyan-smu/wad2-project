import { onBeforeUnmount, ref, watch } from 'vue'

const MAX_TIMEOUT = 2_147_483_647

export function useActivityEndClock(endTimes, clock = ref(new Date())) {
  let timeout

  function scheduleNextEnd() {
    clearTimeout(timeout)
    const now = Date.now()
    clock.value = new Date(now)

    let nextEnd = Infinity
    for (const value of endTimes.value) {
      if (value == null || value === '') continue
      const end = new Date(value).getTime()
      if (end > now && end < nextEnd) nextEnd = end
    }

    if (Number.isFinite(nextEnd)) {
      timeout = setTimeout(scheduleNextEnd, Math.min(nextEnd - now, MAX_TIMEOUT))
    }
  }

  watch(endTimes, scheduleNextEnd, { immediate: true })
  onBeforeUnmount(() => clearTimeout(timeout))
  return clock
}
