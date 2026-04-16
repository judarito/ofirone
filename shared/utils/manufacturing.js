const PENDING_STATUSES = new Set(['PENDING', 'DRAFT'])
const DONE_STATUSES = new Set(['COMPLETED', 'CANCELLED'])

export function normalizeProductionOrderStatus(status) {
  const normalized = String(status || '').trim().toUpperCase()
  if (PENDING_STATUSES.has(normalized)) return 'PENDING'
  return normalized || 'PENDING'
}

export function isProductionOrderPending(status) {
  return normalizeProductionOrderStatus(status) === 'PENDING'
}

export function isProductionOrderDone(status) {
  return DONE_STATUSES.has(normalizeProductionOrderStatus(status))
}

export function getWasteMultiplier(wastePercentage = 0) {
  return 1 + (Number(wastePercentage) || 0) / 100
}

export function getRequiredComponentQuantity(quantityRequired = 0, wastePercentage = 0, orderQuantity = 1) {
  return (Number(quantityRequired) || 0) * getWasteMultiplier(wastePercentage) * (Number(orderQuantity) || 0)
}

export function getBomComponentLineCost(unitCost = 0, quantityRequired = 0, wastePercentage = 0, orderQuantity = 1) {
  return (Number(unitCost) || 0) * getRequiredComponentQuantity(quantityRequired, wastePercentage, orderQuantity)
}

export function getBomEstimatedCost(components = [], orderQuantity = 1) {
  return (components || []).reduce((total, component) => {
    const unitCost = component?.component_variant?.cost ?? component?.unit_cost ?? 0
    const quantityRequired = component?.quantity_required ?? component?.quantity ?? 0
    const wastePercentage = component?.waste_percentage ?? 0
    return total + getBomComponentLineCost(unitCost, quantityRequired, wastePercentage, orderQuantity)
  }, 0)
}

export function getManufacturingTotalCost({
  componentTotalCost = 0,
  laborCost = 0,
  overheadCost = 0,
} = {}) {
  return (Number(componentTotalCost) || 0) + (Number(laborCost) || 0) + (Number(overheadCost) || 0)
}

export function getManufacturingUnitCost({
  componentTotalCost = 0,
  laborCost = 0,
  overheadCost = 0,
  quantityProduced = 0,
} = {}) {
  const quantity = Number(quantityProduced) || 0
  if (quantity <= 0) return 0

  return getManufacturingTotalCost({ componentTotalCost, laborCost, overheadCost }) / quantity
}

export function getBomTargetLabel(bom = {}) {
  return bom?.product?.name || bom?.variant?.variant_name || 'Sin destino'
}

export function getBomDisplayName(bom = {}) {
  return `${bom?.bom_name || 'BOM'} - ${getBomTargetLabel(bom)}`
}

export function normalizeAvailabilityResult(rawData = {}) {
  const sourceComponents = Array.isArray(rawData)
    ? rawData
    : Array.isArray(rawData?.components)
      ? rawData.components
      : []

  const components = sourceComponents.map((component) => {
    const componentVariantId =
      component?.component_variant_id ||
      component?.variant_id ||
      component?.component_variant?.variant_id ||
      null
    const required =
      component?.required_quantity ??
      component?.required ??
      getRequiredComponentQuantity(
        component?.quantity_required ?? component?.quantity ?? 0,
        component?.waste_percentage ?? 0,
        component?.order_quantity ?? 1,
      )
    const available = component?.available_quantity ?? component?.available ?? 0
    const isSufficient =
      component?.is_sufficient ??
      component?.is_available ??
      (Number(available) >= Number(required))
    const componentName =
      component?.component_name ||
      component?.variant_name ||
      component?.sku ||
      component?.component_variant?.variant_name ||
      component?.component_variant?.sku ||
      'Sin nombre'

    return {
      component_variant_id: componentVariantId,
      component_name: componentName,
      sku: component?.sku || component?.component_variant?.sku || null,
      variant_name: component?.variant_name || component?.component_variant?.variant_name || null,
      required_quantity: required,
      available_quantity: available,
      is_sufficient: Boolean(isSufficient),
      is_optional: Boolean(component?.is_optional),
      required,
      available,
      is_available: Boolean(isSufficient),
    }
  })

  const allAvailable = components.every((component) => component.is_sufficient || component.is_optional)

  return {
    all_available:
      rawData?.all_available === undefined
        ? allAvailable
        : Boolean(rawData.all_available),
    components,
  }
}
