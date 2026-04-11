export function deriveSaleWizardStartStep({ cartLength = 0 } = {}) {
  return Number(cartLength || 0) > 0 ? 2 : 1
}

export function getSaleWizardStepBlocker({
  targetStep = 1,
  cartLength = 0,
  remaining = 0,
  creditError = '',
  saleDateTimeError = '',
  cashSessionError = '',
} = {}) {
  const normalizedTargetStep = Number(targetStep || 1)

  if (normalizedTargetStep >= 3 && Number(cartLength || 0) <= 0) {
    return 'Agrega al menos un producto para continuar.'
  }

  if (normalizedTargetStep >= 4) {
    if (cashSessionError) return cashSessionError
    if (creditError) return creditError
    if (Number(remaining || 0) > 0) return 'Aún falta dinero por asignar en los pagos.'
    if (saleDateTimeError) return saleDateTimeError
  }

  return ''
}
