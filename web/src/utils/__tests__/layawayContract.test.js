import { describe, expect, it } from 'vitest'

import {
  LAYAWAY_STATUS,
  calculateLayawayDraftLine,
  createLayawayInstallmentDraft,
  getLayawayDueState,
  getLayawayStatusLabel,
  sanitizeLayawayInstallments,
  summarizeLayawayDraftItems,
  summarizeLayawayInstallments,
} from '../../../../shared/utils/layawayContract'

describe('layawayContract shared utils', () => {
  it('calcula linea con IVA adicional y descuento porcentual', () => {
    const result = calculateLayawayDraftLine({
      qty: 2,
      unit_price: 10000,
      discount: 10,
      discount_type: 'PERCENT',
      price_includes_tax: false,
    }, {
      success: true,
      rate: 0.19,
      code: 'IVA19',
      name: 'IVA 19%',
    })

    expect(result.subtotal).toBe(20000)
    expect(result.discount_amount).toBe(2000)
    expect(result.base_amount).toBe(18000)
    expect(result.tax_amount).toBe(3420)
    expect(result.total).toBe(21420)
  })

  it('calcula linea con precio que ya incluye IVA', () => {
    const result = calculateLayawayDraftLine({
      qty: 1,
      unit_price: 11900,
      discount: 0,
      discount_type: 'AMOUNT',
      price_includes_tax: true,
      tax_rate: 0.19,
    })

    expect(result.base_amount).toBe(10000)
    expect(result.tax_amount).toBe(1900)
    expect(result.total).toBe(11900)
  })

  it('resume items y cuotas validas', () => {
    const itemsSummary = summarizeLayawayDraftItems([
      { qty: 1, unit_price: 10000, discount: 0, discount_type: 'AMOUNT', tax_rate: 0, price_includes_tax: false },
      { qty: 1, unit_price: 5000, discount: 1000, discount_type: 'AMOUNT', tax_rate: 0, price_includes_tax: false },
    ])
    const installments = sanitizeLayawayInstallments([
      createLayawayInstallmentDraft({ due_date: '2026-04-20', amount: '3000' }),
      createLayawayInstallmentDraft({ due_date: '', amount: '2000' }),
      createLayawayInstallmentDraft({ due_date: '2026-05-20', amount: '4000' }),
    ])
    const installmentsSummary = summarizeLayawayInstallments(installments)

    expect(itemsSummary.total).toBe(14000)
    expect(installments).toHaveLength(2)
    expect(installmentsSummary.count).toBe(2)
    expect(installmentsSummary.totalAmount).toBe(7000)
  })

  it('detecta cuando un contrato debe expirar automaticamente', () => {
    const dueState = getLayawayDueState(
      {
        status: LAYAWAY_STATUS.ACTIVE,
        due_date: '2026-04-10',
        balance: 5000,
      },
      new Date('2026-04-16T10:00:00'),
    )

    expect(dueState.isOverdue).toBe(true)
    expect(dueState.shouldAutoExpire).toBe(true)
  })

  it('detecta contratos proximos a vencer sin marcarlos como expirados', () => {
    const dueState = getLayawayDueState(
      {
        status: LAYAWAY_STATUS.ACTIVE,
        due_date: '2026-04-20',
        balance: 5000,
      },
      new Date('2026-04-16T10:00:00'),
    )

    expect(dueState.daysUntilDue).toBe(4)
    expect(dueState.isDueSoon).toBe(true)
    expect(dueState.isOverdue).toBe(false)
    expect(dueState.shouldAutoExpire).toBe(false)
  })

  it('sanea cuotas ordenandolas y descartando montos invalidos', () => {
    const installments = sanitizeLayawayInstallments([
      { due_date: '2026-05-10', amount: 0 },
      { due_date: '2026-05-20', amount: 1000.4, status: 'pending' },
      { due_date: '2026-04-20', amount: '2000.235', status: 'pending' },
      { due_date: '', amount: 3000 },
    ])

    expect(installments).toEqual([
      { due_date: '2026-04-20', amount: 2000.24, status: 'PENDING' },
      { due_date: '2026-05-20', amount: 1000.4, status: 'PENDING' },
    ])
  })

  it('devuelve estado neutro cuando no hay fecha de vencimiento', () => {
    expect(getLayawayDueState({ status: LAYAWAY_STATUS.ACTIVE, balance: 0 })).toEqual({
      dueDate: null,
      daysUntilDue: null,
      isDueSoon: false,
      isOverdue: false,
      shouldAutoExpire: false,
    })
  })

  it('normaliza etiqueta de estado', () => {
    expect(getLayawayStatusLabel(LAYAWAY_STATUS.EXPIRED)).toBe('Expirado')
  })
})
