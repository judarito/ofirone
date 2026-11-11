// Puente para llevar un draft de factura de compra (job de media_processing,
// persistido en async_jobs.result) desde la pantalla de importaciones hacia
// la de Compras, donde se aplica reutilizando el merge existente.
// Implementación a prueba de tests (node) con fallback en memoria.

const KEY = 'ofirone:purchase-draft-bridge';
let memory = null;

function hasStorage() {
  try {
    return typeof window !== 'undefined' && Boolean(window.sessionStorage);
  } catch (_error) {
    return false;
  }
}

export function savePendingPurchaseDraft(draft) {
  memory = draft || null;
  if (hasStorage()) {
    try {
      window.sessionStorage.setItem(KEY, JSON.stringify(draft || {}));
    } catch (_error) {
      // No-op: se mantiene la copia en memoria.
    }
  }
}

export function peekPendingPurchaseDraft() {
  if (memory) return memory;
  if (hasStorage()) {
    try {
      const raw = window.sessionStorage.getItem(KEY);
      if (raw) return JSON.parse(raw);
    } catch (_error) {
      return null;
    }
  }
  return null;
}

export function consumePendingPurchaseDraft() {
  const draft = peekPendingPurchaseDraft();
  memory = null;
  if (hasStorage()) {
    try {
      window.sessionStorage.removeItem(KEY);
    } catch (_error) {
      // No-op.
    }
  }
  return draft;
}
