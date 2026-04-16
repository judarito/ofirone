const {
  buildSetupOverall,
  buildSetupProcesses,
  finalizeSetupProcess,
} = require('../services/setupAssistant.service');

describe('setupAssistant.service', () => {
  it('marca un proceso como listo para probar cuando ya no faltan pasos obligatorios', () => {
    const process = finalizeSetupProcess({
      id: 'sales',
      title: 'Vender',
      steps: [
        { id: 'required-1', required: true, completed: true },
        { id: 'proof', required: false, completed: false, kind: 'proof' },
      ],
    });

    expect(process.state).toBe('READY_FOR_TEST');
    expect(process.nextStep.id).toBe('proof');
  });

  it('construye procesos de setup usando el snapshot operativo del tenant', () => {
    const processes = buildSetupProcesses({
      settings: {
        business_name: 'OfirOne',
        invoice_prefix: 'FAC',
        accounting_enabled: true,
      },
      locationsCount: 1,
      registersCount: 1,
      paymentMethodsCount: 2,
      productsCount: 4,
      productVariantsCount: 4,
      inventoryProductsCount: 3,
      cashAssignmentsCount: 1,
      salesCount: 0,
      suppliersCount: 1,
      purchasesCount: 1,
      stockWithQtyCount: 2,
      inventoryMovesCount: 0,
      cashSessionsCount: 1,
      accountingEntriesCount: 0,
    });

    const sales = processes.find((item) => item.id === 'sales');
    const accounting = processes.find((item) => item.id === 'accounting');

    expect(sales).toBeTruthy();
    expect(sales.state).toBe('READY_FOR_TEST');
    expect(accounting).toBeTruthy();
    expect(accounting.webOnly).toBe(true);
  });

  it('resume el siguiente paso global desde el proceso mas bloqueado', () => {
    const processes = buildSetupProcesses({
      settings: {
        business_name: '',
        invoice_prefix: '',
      },
      locationsCount: 0,
      registersCount: 1,
      paymentMethodsCount: 1,
      productsCount: 0,
      productVariantsCount: 0,
      inventoryProductsCount: 0,
      cashAssignmentsCount: 0,
      salesCount: 0,
      suppliersCount: 1,
      purchasesCount: 0,
      stockWithQtyCount: 0,
      inventoryMovesCount: 0,
      cashSessionsCount: 0,
      accountingEntriesCount: 0,
    });

    const overall = buildSetupOverall(processes);

    expect(overall.totalProcesses).toBeGreaterThan(0);
    expect(overall.nextAction).toBeTruthy();
    expect(overall.nextAction.processTitle).toBe('Vender');
    expect(overall.nextAction.screen).toBe('TenantConfig');
  });
});
