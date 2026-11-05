export function hasActivityEnded(activity, now = Date.now()) {
  const end = activity.end
  if (end == null || end === '') return false
  return new Date(end).getTime() <= Number(now)
}

export function isActivityComplete(activity, now = Date.now()) {
  return Boolean(activity.done) || hasActivityEnded(activity, now)
}
