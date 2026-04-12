import { describe, expect, it } from 'vitest'
import {
  buildQuickActionExecution,
  toggleDomainSelection,
  validateOpsAgentRequest,
} from '@/utils/aiInsightsViewModel'

describe('aiInsightsViewModel', () => {
  it('activa y desactiva dominios', () => {
    expect(toggleDomainSelection([], 'sales')).toEqual(['sales'])
    expect(toggleDomainSelection(['sales', 'inventory'], 'sales')).toEqual(['inventory'])
  })

  it('construye la ejecucion de una accion rapida', () => {
    expect(buildQuickActionExecution({
      id: 'inventory-alerts',
      prompt: ' Revisa inventario ',
      domains: ['inventory'],
    })).toEqual({
      activeActionId: 'inventory-alerts',
      query: 'Revisa inventario',
      domains: ['inventory'],
    })
  })

  it('valida tenant y query antes de consultar', () => {
    expect(validateOpsAgentRequest({ tenantId: null, query: 'hola' })).toEqual({
      valid: false,
      error: 'No hay tenant activo para consultar.',
    })

    expect(validateOpsAgentRequest({ tenantId: 't1', query: '   ' })).toEqual({
      valid: false,
      error: 'Escribe una consulta para el agente operativo.',
    })

    expect(validateOpsAgentRequest({ tenantId: 't1', query: ' resumen ventas ' })).toEqual({
      valid: true,
      data: {
        tenantId: 't1',
        query: 'resumen ventas',
      },
    })
  })
})
