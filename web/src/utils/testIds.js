export function normalizeTestIdSegment(value) {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

export function buildTestId(...segments) {
  return segments
    .map(normalizeTestIdSegment)
    .filter(Boolean)
    .join('-')
}

export function buildRouteTestId(route) {
  if (!route) return 'module-unknown'

  return buildTestId(
    'module',
    route.name || route.path || 'unknown'
  )
}

export function buildItemTestId(prefix, value) {
  const normalizedValue = normalizeTestIdSegment(value)
  return normalizedValue
    ? buildTestId(prefix, normalizedValue)
    : buildTestId(prefix, 'item')
}
