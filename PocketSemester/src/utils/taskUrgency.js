export function getTaskUrgency(value, { done = false, now = new Date(), prefix = 'Due', end = null } = {}) {
  if (done || !value) return null

  const date = new Date(value)
  const current = new Date(now)
  if (!Number.isFinite(date.getTime()) || !Number.isFinite(current.getTime())) return null

  if (date < current) {
    if (prefix === 'Starts') {
      const endDate = end ? new Date(end) : null
      return endDate && endDate > current ? { level: 'active', label: 'In progress' } : null
    }
    return { level: 'overdue', label: 'Overdue' }
  }

  // Compare local calendar dates, so tomorrow is consistent across midnight and DST.
  const day = Date.UTC(date.getFullYear(), date.getMonth(), date.getDate())
  const today = Date.UTC(current.getFullYear(), current.getMonth(), current.getDate())
  const daysAway = Math.round((day - today) / 86400000)

  if (daysAway === 0) return { level: 'urgent', label: `${prefix} today` }
  if (daysAway === 1) return { level: 'urgent', label: `${prefix} tomorrow` }
  if (daysAway <= 3) return { level: 'soon', label: `${prefix} in ${daysAway} days` }
  if (daysAway <= 7) return { level: 'week', label: `${prefix} in ${daysAway} days` }
  return null
}
