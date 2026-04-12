export function toggleDomainSelection(selectedDomains = [], domainId) {
  const current = Array.isArray(selectedDomains) ? selectedDomains : []
  if (!domainId) return [...current]
  return current.includes(domainId)
    ? current.filter((item) => item !== domainId)
    : [...current, domainId]
}

export function buildQuickActionExecution(action = {}) {
  return {
    activeActionId: action?.id || '',
    query: String(action?.prompt || '').trim(),
    domains: Array.isArray(action?.domains) ? [...action.domains] : [],
  }
}

export function validateOpsAgentRequest({ tenantId, query } = {}) {
  if (!tenantId) {
    return { valid: false, error: 'No hay tenant activo para consultar.' }
  }

  const text = String(query || '').trim()
  if (!text) {
    return { valid: false, error: 'Escribe una consulta para el agente operativo.' }
  }

  return {
    valid: true,
    data: {
      tenantId,
      query: text,
    },
  }
}
