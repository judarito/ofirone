import AsyncStorage from '@react-native-async-storage/async-storage';

const WEB_CACHE_KEY = 'poslite_web_auth_cache';
const WEB_PENDING_KEY = 'poslite_web_pending_count';
const WEB_MENU_KEY = 'poslite_web_menu_cache';
const WEB_PENDING_OPS_KEY = 'poslite_web_pending_ops';
const WEB_CATALOG_KEY = 'poslite_web_catalog';

export async function initOfflineDatabase() {}

async function readCatalogList() {
  const raw = await AsyncStorage.getItem(WEB_CATALOG_KEY);
  const parsed = raw ? JSON.parse(raw) : [];
  return Array.isArray(parsed) ? parsed : [];
}

async function writeCatalogList(list) {
  await AsyncStorage.setItem(WEB_CATALOG_KEY, JSON.stringify(list));
}

export async function upsertLocalCatalogRows({ tenantId, entityType, rows = [] } = {}) {
  const list = await readCatalogList();
  const now = new Date().toISOString();
  const next = [...list];
  for (const row of rows || []) {
    if (!row?.id) continue;
    const index = next.findIndex(
      (item) =>
        item.tenantId === tenantId && item.entityType === entityType && item.id === String(row.id)
    );
    const entry = {
      tenantId,
      entityType,
      id: String(row.id),
      updatedAt: row.updatedAt || null,
      payload: row.payload || {},
      fetchedAt: now,
    };
    if (index >= 0) next[index] = entry;
    else next.push(entry);
  }
  await writeCatalogList(next);
}

export async function listLocalCatalogSince({
  tenantId,
  entityType,
  since = null,
  limit = 500,
} = {}) {
  const list = await readCatalogList();
  return list
    .filter(
      (item) =>
        item.tenantId === tenantId &&
        item.entityType === entityType &&
        (!since || item.updatedAt > since)
    )
    .sort((a, b) => String(a.updatedAt || '').localeCompare(String(b.updatedAt || '')))
    .slice(0, Math.max(1, Number(limit) || 500))
    .map((item) => ({ id: item.id, updatedAt: item.updatedAt, payload: item.payload }));
}

export async function countLocalCatalog({ tenantId, entityType = null } = {}) {
  const list = await readCatalogList();
  return list.filter(
    (item) => item.tenantId === tenantId && (!entityType || item.entityType === entityType)
  ).length;
}

export async function clearLocalCatalog({ tenantId = null } = {}) {
  let list = await readCatalogList();
  if (tenantId) list = list.filter((item) => item.tenantId !== tenantId);
  else list = [];
  await writeCatalogList(list);
}

function normalizePendingQueryInput(input, defaultLimit = 50) {
  if (typeof input === 'number') {
    return {
      limit: Number.isFinite(input) ? Math.max(1, Math.floor(input)) : defaultLimit,
      tenantId: null,
      userId: null,
    };
  }

  const options = input || {};
  const parsedLimit = Number(options.limit || defaultLimit);
  return {
    limit: Number.isFinite(parsedLimit) ? Math.max(1, Math.floor(parsedLimit)) : defaultLimit,
    tenantId: options.tenantId || null,
    userId: options.userId || null,
  };
}

export async function saveAuthCache({ authUserId, userProfile, tenant }) {
  const payload = {
    authUserId,
    userProfile,
    tenant: tenant || {},
    cachedAt: new Date().toISOString(),
  };
  await AsyncStorage.setItem(WEB_CACHE_KEY, JSON.stringify(payload));
}

export async function getAuthCache() {
  const raw = await AsyncStorage.getItem(WEB_CACHE_KEY);
  return raw ? JSON.parse(raw) : null;
}

export async function clearAuthCache() {
  await AsyncStorage.removeItem(WEB_CACHE_KEY);
}

export async function saveMenuCache({ authUserId, menuTree }) {
  const payload = {
    authUserId,
    menuTree: menuTree || [],
    cachedAt: new Date().toISOString(),
  };
  await AsyncStorage.setItem(WEB_MENU_KEY, JSON.stringify(payload));
}

export async function getMenuCache() {
  const raw = await AsyncStorage.getItem(WEB_MENU_KEY);
  return raw ? JSON.parse(raw) : null;
}

export async function clearMenuCache() {
  await AsyncStorage.removeItem(WEB_MENU_KEY);
}

export async function upsertSyncState(key, value) {
  await AsyncStorage.setItem(`sync_state_${key}`, JSON.stringify(value));
}

export async function getSyncState(key) {
  const raw = await AsyncStorage.getItem(`sync_state_${key}`);
  if (!raw) return null;
  return {
    value: JSON.parse(raw),
    updatedAt: null,
  };
}

export async function clearSyncState(key) {
  await AsyncStorage.removeItem(`sync_state_${key}`);
}

export async function enqueuePendingOp(op = {}) {
  const raw = await AsyncStorage.getItem(WEB_PENDING_OPS_KEY);
  const list = raw ? JSON.parse(raw) : [];
  const syncMeta = op.payload?.sync || {};
  const idempotencyKey = op.idempotencyKey || syncMeta.idempotency_key || null;
  if (idempotencyKey && list.some((item) => item.idempotencyKey === idempotencyKey)) {
    return { opId: op.opId, duplicate: true };
  }
  list.push({
    opId: op.opId,
    opType: op.opType,
    tenantId: op.tenantId,
    userId: op.userId,
    deviceId: op.deviceId,
    entityType: op.entityType || syncMeta.entity_type || null,
    entityId: op.entityId || syncMeta.entity_id || op.opId || null,
    idempotencyKey: op.idempotencyKey || syncMeta.idempotency_key || null,
    payload: op.payload || {},
    status: 'pending',
    retryCount: 0,
    lastAttemptAt: op.lastAttemptAt || null,
    errorCode: op.errorCode || null,
    lastError: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });
  await AsyncStorage.setItem(WEB_PENDING_OPS_KEY, JSON.stringify(list));
  await AsyncStorage.setItem(
    WEB_PENDING_KEY,
    String(list.filter((op) => op.status === 'pending' || op.status === 'failed').length)
  );
  return { opId: op.opId, duplicate: false };
}

export async function getPendingOpsCount(filters = {}) {
  const tenantId = filters?.tenantId || null;
  const userId = filters?.userId || null;
  const raw = await AsyncStorage.getItem(WEB_PENDING_OPS_KEY);
  const list = raw ? JSON.parse(raw) : [];
  return list.filter(
    (op) =>
      (op.status === 'pending' || op.status === 'failed') &&
      (!tenantId || op.tenantId === tenantId) &&
      (!userId || op.userId === userId)
  ).length;
}

export async function getPendingOps(input = 50) {
  const { limit, tenantId, userId } = normalizePendingQueryInput(input, 50);
  const raw = await AsyncStorage.getItem(WEB_PENDING_OPS_KEY);
  const list = raw ? JSON.parse(raw) : [];
  return list
    .filter(
      (op) =>
        (op.status === 'pending' || op.status === 'failed') &&
        !String(op.lastError || '').startsWith('NO_RETRY:') &&
        (!tenantId || op.tenantId === tenantId) &&
        (!userId || op.userId === userId)
    )
    .sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt))
    .slice(0, limit);
}

async function updatePendingList(transform) {
  const raw = await AsyncStorage.getItem(WEB_PENDING_OPS_KEY);
  const list = raw ? JSON.parse(raw) : [];
  const next = transform(list);
  await AsyncStorage.setItem(WEB_PENDING_OPS_KEY, JSON.stringify(next));
  await AsyncStorage.setItem(
    WEB_PENDING_KEY,
    String(next.filter((op) => op.status === 'pending' || op.status === 'failed').length)
  );
}

export async function markPendingOpProcessing(opId) {
  await updatePendingList((list) =>
    list.map((op) =>
      op.opId === opId && (op.status === 'pending' || op.status === 'failed')
        ? {
            ...op,
            status: 'processing',
            lastAttemptAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          }
        : op
    )
  );
}

export async function markPendingOpDone(opId) {
  await updatePendingList((list) =>
    list.map((op) =>
      op.opId === opId
        ? {
            ...op,
            status: 'synced',
            lastError: null,
            updatedAt: new Date().toISOString(),
          }
        : op
    )
  );
}

export async function markPendingOpFailed(opId, errorMessage, errorCode = null) {
  await updatePendingList((list) =>
    list.map((op) =>
      op.opId === opId
        ? {
            ...op,
            status: String(errorMessage || '').startsWith('NO_RETRY:') ? 'dead_letter' : 'failed',
            retryCount: Number(op.retryCount || 0) + 1,
            lastError: String(errorMessage || 'Error desconocido'),
            errorCode:
              errorCode ||
              (String(errorMessage || '').startsWith('NO_RETRY:') ? 'BLOCKED' : 'SYNC_FAILED'),
            updatedAt: new Date().toISOString(),
          }
        : op
    )
  );
}

export async function resetStuckProcessingOps() {
  await updatePendingList((list) =>
    list.map((op) =>
      op.status === 'processing'
        ? { ...op, status: 'pending', updatedAt: new Date().toISOString() }
        : op
    )
  );
}

export async function getPendingSaleOps(tenantId, limit = 200, userId = null) {
  const raw = await AsyncStorage.getItem(WEB_PENDING_OPS_KEY);
  const list = raw ? JSON.parse(raw) : [];
  return list
    .filter(
      (op) =>
        op.opType === 'CREATE_SALE' &&
        op.tenantId === tenantId &&
        (!userId || op.userId === userId) &&
        (op.status === 'pending' || op.status === 'failed')
    )
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
    .slice(0, limit);
}

export async function getPendingSaleOpById(opId, userId = null) {
  const raw = await AsyncStorage.getItem(WEB_PENDING_OPS_KEY);
  const list = raw ? JSON.parse(raw) : [];
  const found = list.find(
    (op) =>
      op.opType === 'CREATE_SALE' &&
      op.opId === opId &&
      (!userId || op.userId === userId) &&
      (op.status === 'pending' || op.status === 'failed')
  );
  return found || null;
}

export async function retryPendingOp(opId) {
  await updatePendingList((list) =>
    list.map((op) =>
      op.opId === opId
        ? {
            ...op,
            status: 'pending',
            retryCount: 0,
            lastError: null,
            errorCode: null,
            updatedAt: new Date().toISOString(),
          }
        : op
    )
  );
}

export async function discardPendingOp(opId) {
  await updatePendingList((list) => list.filter((op) => op.opId !== opId));
}

export async function updatePendingOpPayload(opId, payload) {
  await updatePendingList((list) =>
    list.map((op) =>
      op.opId === opId
        ? {
            ...op,
            payload: payload || {},
            updatedAt: new Date().toISOString(),
          }
        : op
    )
  );
}

export async function getAllQueuedOps({ tenantId = null, userId = null, limit = 100 } = {}) {
  const raw = await AsyncStorage.getItem(WEB_PENDING_OPS_KEY);
  const list = raw ? JSON.parse(raw) : [];
  return list
    .filter(
      (op) =>
        (op.status === 'pending' || op.status === 'failed' || op.status === 'dead_letter') &&
        (!tenantId || op.tenantId === tenantId) &&
        (!userId || op.userId === userId)
    )
    .sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt))
    .slice(0, limit)
    .map((op) => ({
      ...op,
      isNoRetry: op.status === 'dead_letter' || String(op.lastError || '').startsWith('NO_RETRY:'),
    }));
}

export async function clearOfflineOperationalData() {
  await AsyncStorage.removeItem(WEB_PENDING_KEY);
  await AsyncStorage.removeItem(WEB_PENDING_OPS_KEY);
  await AsyncStorage.removeItem(WEB_CATALOG_KEY);

  const allKeys = await AsyncStorage.getAllKeys();
  const syncKeys = allKeys.filter((key) => key.startsWith('sync_state_'));
  if (syncKeys.length > 0) {
    await AsyncStorage.multiRemove(syncKeys);
  }
}
