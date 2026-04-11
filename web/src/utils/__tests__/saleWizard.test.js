import { describe, expect, it } from 'vitest'
import { deriveSaleWizardStartStep, getSaleWizardStepBlocker } from '../saleWizard'

describe('saleWizard utils', () => {
  it('abre en productos si ya hay carrito', () => {
    expect(deriveSaleWizardStartStep({ cartLength: 2 })).toBe(2)
    expect(deriveSaleWizardStartStep({ cartLength: 0 })).toBe(1)
  })

  it('bloquea avanzar a pago sin productos', () => {
    expect(getSaleWizardStepBlocker({ targetStep: 3, cartLength: 0 })).toContain('Agrega')
  })

  it('bloquea confirmar si falta dinero', () => {
    expect(getSaleWizardStepBlocker({ targetStep: 4, cartLength: 1, remaining: 5000 })).toContain('falta dinero')
  })

  it('bloquea confirmar si la caja no esta operativa', () => {
    expect(getSaleWizardStepBlocker({
      targetStep: 4,
      cartLength: 1,
      remaining: 0,
      cashSessionError: 'Debe abrir una caja antes de vender.',
    })).toContain('Debe abrir una caja')
  })

  it('permite confirmar cuando el borrador esta completo', () => {
    expect(getSaleWizardStepBlocker({ targetStep: 4, cartLength: 1, remaining: 0 })).toBe('')
  })
})
