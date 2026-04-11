import {
  deriveSaleWizardStartStep,
  getSaleWizardStepBlocker,
} from '../../../shared/utils/saleWizard';

describe('saleWizard shared utils', () => {
  test('abre en productos si ya existe carrito', () => {
    expect(deriveSaleWizardStartStep({ cartLength: 1 })).toBe(2);
    expect(deriveSaleWizardStartStep({ cartLength: 0 })).toBe(1);
  });

  test('bloquea pago sin productos', () => {
    expect(getSaleWizardStepBlocker({ targetStep: 3, cartLength: 0 })).toContain('Agrega');
  });

  test('bloquea confirmacion si la caja no esta operativa', () => {
    expect(getSaleWizardStepBlocker({
      targetStep: 4,
      cartLength: 1,
      cashSessionError: 'Debe abrir una caja antes de vender.',
    })).toContain('Debe abrir una caja');
  });

  test('permite confirmar cuando no hay bloqueos', () => {
    expect(getSaleWizardStepBlocker({ targetStep: 4, cartLength: 1, remaining: 0 })).toBe('');
  });
});
