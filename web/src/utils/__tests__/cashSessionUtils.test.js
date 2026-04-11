import { describe, expect, it } from 'vitest'
import {
  buildCashSessionExpiredMessage,
  getCashSessionState,
  resolveCashSessionMaxHours,
  validateCashSessionForOperation,
} from '../../../../shared/utils/cashSessionUtils'

describe('cashSessionUtils', () => {
  it('normaliza el limite maximo de horas', () => {
    expect(resolveCashSessionMaxHours({ cash_session_max_hours: 12 }, 24)).toBe(12)
    expect(resolveCashSessionMaxHours({ cash_session_max_hours: 0 }, 24)).toBe(24)
    expect(resolveCashSessionMaxHours({}, 24)).toBe(24)
  })

  it('resume el estado de una sesion abierta', () => {
    const nowMs = new Date('2026-04-10T12:00:00.000Z').getTime()
    const state = getCashSessionState({ opened_at: '2026-04-10T07:15:00.000Z' }, 4, nowMs)

    expect(state.hasSession).toBe(true)
    expect(state.ageHours).toBe(4)
    expect(state.maxHours).toBe(4)
    expect(state.expired).toBe(true)
  })

  it('marca invalida una operacion sin caja abierta', () => {
    const result = validateCashSessionForOperation(null, 24, {
      missingMessage: 'Debe abrir una caja antes de vender.',
    })

    expect(result.valid).toBe(false)
    expect(result.code).toBe('NO_OPEN_SESSION')
    expect(result.message).toBe('Debe abrir una caja antes de vender.')
  })

  it('marca invalida una operacion cuando la sesion supero el limite', () => {
    const nowMs = new Date('2026-04-10T12:00:00.000Z').getTime()
    const result = validateCashSessionForOperation(
      { opened_at: '2026-04-10T08:00:00.000Z' },
      3,
      { nowMs }
    )

    expect(result.valid).toBe(false)
    expect(result.code).toBe('EXPIRED_SESSION')
    expect(result.message).toBe(buildCashSessionExpiredMessage({ ageHours: 4, maxHours: 3 }))
  })

  it('permite operar cuando la sesion sigue vigente', () => {
    const nowMs = new Date('2026-04-10T12:00:00.000Z').getTime()
    const result = validateCashSessionForOperation(
      { opened_at: '2026-04-10T10:30:00.000Z' },
      4,
      { nowMs }
    )

    expect(result.valid).toBe(true)
    expect(result.code).toBe(null)
    expect(result.message).toBe('')
    expect(result.expired).toBe(false)
  })
})
