import * as SQLite from 'expo-sqlite';

import { normalizeOutboxStatus } from '../../../../shared/sync/core/outboxState';

const DB_NAME = 'poslite_mobile.db';

let dbPromise = null;

async function getDb() {
  if (!dbPromise) {
    dbPromise = SQLite.openDatabaseAsync(DB_NAME);
  }
  return dbPromise;
}

async function addColumnIfMissing(db, tableName, columnDefinition) {
  try {
    await db.execAsync(`ALTER TABLE ${tableName} ADD COLUMN ${columnDefinition}`);
  } catch (error) {
    if (
      !String(error?.message || '')
        .toLowerCase()
        .includes('duplicate column')
    ) {
      throw error;
    }
  }
}

async function ensurePendingOpsSyncColumns(db) {
  await addColumnIfMissing(db, 'pending_ops', 'entity_type TEXT');
  await addColumnIfMissing(db, 'pending_ops', 'entity_id TEXT');
  await addColumnIfMissing(db, 'pending_ops', 'idempotency_key TEXT');
  await addColumnIfMissing(db, 'pending_ops', 'last_attempt_at TEXT');
  await addColumnIfMissing(db, 'pending_ops', 'error_code TEXT');
  await db.execAsync(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_pending_ops_idempotency
      ON pending_ops (idempotency_key)
      WHERE idempotency_key IS NOT NULL;
  `);
}

// Migra los estados legacy (PENDING/PROCESSING/DONE/FAILED) al contrato
// canónico del shared sync engine. Idempotente: corre una sola vez por fila.
async function migratePendingOpsStatuses(db) {
  await db.execAsync(`
    UPDATE pending_ops SET status = 'pending'    WHERE status = 'PENDING';
    UPDATE pending_ops SET status = 'processing' WHERE status = 'PROCESSING';
    UPDATE pending_ops SET status = 'synced'     WHERE status = 'DONE';
    UPDATE pending_ops SET status = 'conflict'   WHERE status = 'CONFLICT';
    UPDATE pending_ops SET status = 'dead_letter'
      WHERE status = 'FAILED' AND last_error LIKE 'NO_RETRY:%';
    UPDATE pending_ops SET status = 'failed'
      WHERE status = 'FAILED' AND (last_error IS NULL OR last_error NOT LIKE 'NO_RETRY:%');
  `);
}

function extractSyncMeta(op = {}) {
  const payload = op.payload || {};
  const sync = payload.sync || {};
  return {
    entityType: op.entityType || op.entity_type || sync.entity_type || null,
    entityId: op.entityId || op.entity_id || sync.entity_id || op.opId || null,
    idempotencyKey: op.idempotencyKey || op.idempotency_key || sync.idempotency_key || null,
    lastAttemptAt: op.lastAttemptAt || op.last_attempt_at || null,
    errorCode: op.errorCode || op.error_code || null,
  };
}

export async function initOfflineDatabase() {
  const db = await getDb();

  await db.execAsync(`
    PRAGMA journal_mode = WAL;

    CREATE TABLE IF NOT EXISTS local_sales_draft (
      id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      location_id TEXT,
      payload TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS local_sale_lines_draft (
      id TEXT PRIMARY KEY,
      sale_draft_id TEXT NOT NULL,
      payload TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS local_payments_draft (
      id TEXT PRIMARY KEY,
      sale_draft_id TEXT NOT NULL,
      payload TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS local_cartera_payments_draft (
      id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      payload TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS local_supplier_payments_draft (
      id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      payload TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS pending_ops (
      op_id TEXT PRIMARY KEY,
      op_type TEXT NOT NULL,
      tenant_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      device_id TEXT NOT NULL,
      entity_type TEXT,
      entity_id TEXT,
      idempotency_key TEXT,
      payload TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      retry_count INTEGER NOT NULL DEFAULT 0,
      last_attempt_at TEXT,
      error_code TEXT,
      last_error TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_pending_ops_status_created
      ON pending_ops (status, created_at);

    CREATE TABLE IF NOT EXISTS sync_state (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS auth_cache (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      auth_user_id TEXT NOT NULL,
      user_profile_json TEXT NOT NULL,
      tenant_json TEXT NOT NULL,
      cached_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS menu_cache (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      auth_user_id TEXT NOT NULL,
      menu_json TEXT NOT NULL,
      cached_at TEXT NOT NULL
    );
  `);

  await ensurePendingOpsSyncColumns(db);
  await migratePendingOpsStatuses(db);
  await db.execAsync(`
    CREATE TABLE IF NOT EXISTS local_catalog (
      tenant_id TEXT NOT NULL,
      entity_type TEXT NOT NULL,
      entity_id TEXT NOT NULL,
      updated_at TEXT,
      payload TEXT NOT NULL,
      fetched_at TEXT NOT NULL,
      PRIMARY KEY (tenant_id, entity_type, entity_id)
    );
    CREATE INDEX IF NOT EXISTS idx_local_catalog_since
      ON local_catalog (tenant_id, entity_type, updated_at);
  `);

  // Reset any ops stuck in PROCESSING state from a previous crash/kill
  await resetStuckProcessingOps();
}

export async function saveAuthCache({ authUserId, userProfile, tenant }) {
  const db = await getDb();
  const now = new Date().toISOString();
  await db.runAsync(
    `
      INSERT INTO auth_cache (id, auth_user_id, user_profile_json, tenant_json, cached_at)
      VALUES (1, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        auth_user_id = excluded.auth_user_id,
        user_profile_json = excluded.user_profile_json,
        tenant_json = excluded.tenant_json,
        cached_at = excluded.cached_at
    `,
    [authUserId, JSON.stringify(userProfile), JSON.stringify(tenant || {}), now]
  );
}

export async function getAuthCache() {
  const db = await getDb();
  const row = await db.getFirstAsync(
    `SELECT auth_user_id, user_profile_json, tenant_json, cached_at FROM auth_cache WHERE id = 1`
  );
  if (!row) return null;

  return {
    authUserId: row.auth_user_id,
    userProfile: JSON.parse(row.user_profile_json),
    tenant: JSON.parse(row.tenant_json),
    cachedAt: row.cached_at,
  };
}

export async function clearAuthCache() {
  const db = await getDb();
  await db.runAsync(`DELETE FROM auth_cache WHERE id = 1`);
}

export async function saveMenuCache({ authUserId, menuTree }) {
  const db = await getDb();
  const now = new Date().toISOString();
  await db.runAsync(
    `
      INSERT INTO menu_cache (id, auth_user_id, menu_json, cached_at)
      VALUES (1, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        auth_user_id = excluded.auth_user_id,
        menu_json = excluded.menu_json,
        cached_at = excluded.cached_at
    `,
    [authUserId, JSON.stringify(menuTree || []), now]
  );
}

export async function getMenuCache() {
  const db = await getDb();
  const row = await db.getFirstAsync(
    `SELECT auth_user_id, menu_json, cached_at FROM menu_cache WHERE id = 1`
  );
  if (!row) return null;

  return {
    authUserId: row.auth_user_id,
    menuTree: JSON.parse(row.menu_json),
    cachedAt: row.cached_at,
  };
}

export async function clearMenuCache() {
  const db = await getDb();
  await db.runAsync(`DELETE FROM menu_cache WHERE id = 1`);
}

export async function upsertSyncState(key, value) {
  const db = await getDb();
  const now = new Date().toISOString();
  await db.runAsync(
    `
      INSERT INTO sync_state (key, value, updated_at)
      VALUES (?, ?, ?)
      ON CONFLICT(key) DO UPDATE SET
        value = excluded.value,
        updated_at = excluded.updated_at
    `,
    [key, JSON.stringify(value), now]
  );
}

export async function getSyncState(key) {
  const db = await getDb();
  const row = await db.getFirstAsync(`SELECT value, updated_at FROM sync_state WHERE key = ?`, [
    key,
  ]);
  if (!row) return null;
  return {
    value: JSON.parse(row.value),
    updatedAt: row.updated_at,
  };
}

export async function clearSyncState(key) {
  const db = await getDb();
  await db.runAsync(`DELETE FROM sync_state WHERE key = ?`, [key]);
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

export async function enqueuePendingOp(op) {
  const db = await getDb();
  const now = new Date().toISOString();
  const syncMeta = extractSyncMeta(op);

  // Dedupe por idempotency_key: si ya existe una operación con la misma clave
  // (cualquier estado), no se duplica; se devuelve la existente.
  if (syncMeta.idempotencyKey) {
    const existing = await db.getFirstAsync(
      `SELECT op_id FROM pending_ops WHERE idempotency_key = ? LIMIT 1`,
      [syncMeta.idempotencyKey]
    );
    if (existing?.op_id) {
      return { opId: existing.op_id, duplicate: true };
    }
  }

  const insertResult = await db.runAsync(
    `
      INSERT OR IGNORE INTO pending_ops (
        op_id, op_type, tenant_id, user_id, device_id,
        entity_type, entity_id, idempotency_key,
        payload, status, retry_count, last_attempt_at, error_code, created_at, updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', 0, ?, ?, ?, ?)
    `,
    [
      op.opId,
      op.opType,
      op.tenantId,
      op.userId,
      op.deviceId,
      syncMeta.entityType,
      syncMeta.entityId,
      syncMeta.idempotencyKey,
      JSON.stringify(op.payload || {}),
      syncMeta.lastAttemptAt,
      syncMeta.errorCode,
      now,
      now,
    ]
  );

  // Red de seguridad: si un insert concurrente con la misma clave ganó la
  // carrera, OR IGNORE no inserta y el changes() es 0 → duplicado.
  const ignoredDuplicate = Number(insertResult?.changes || 0) === 0;
  return { opId: op.opId, duplicate: ignoredDuplicate };
}

export async function getPendingOpsCount(filters = {}) {
  const tenantId = filters?.tenantId || null;
  const userId = filters?.userId || null;
  const db = await getDb();
  const row = await db.getFirstAsync(
    `
      SELECT COUNT(*) AS total
      FROM pending_ops
      WHERE status IN ('pending','failed')
        AND (? IS NULL OR tenant_id = ?)
        AND (? IS NULL OR user_id = ?)
    `,
    [tenantId, tenantId, userId, userId]
  );
  return Number(row?.total || 0);
}

export async function getPendingOps(input = 50) {
  const { limit, tenantId, userId } = normalizePendingQueryInput(input, 50);
  const db = await getDb();
  const rows = await db.getAllAsync(
    `
      SELECT
        op_id, op_type, tenant_id, user_id, device_id, entity_type, entity_id,
        idempotency_key, payload, status, retry_count, last_attempt_at,
        error_code, last_error, created_at, updated_at
      FROM pending_ops
      WHERE status IN ('pending', 'failed')
        AND (last_error IS NULL OR last_error NOT LIKE 'NO_RETRY:%')
        AND (? IS NULL OR tenant_id = ?)
        AND (? IS NULL OR user_id = ?)
      ORDER BY created_at ASC
      LIMIT ?
    `,
    [tenantId, tenantId, userId, userId, limit]
  );

  return (rows || []).map((row) => ({
    opId: row.op_id,
    opType: row.op_type,
    tenantId: row.tenant_id,
    userId: row.user_id,
    deviceId: row.device_id,
    entityType: row.entity_type || null,
    entityId: row.entity_id || null,
    idempotencyKey: row.idempotency_key || null,
    payload: JSON.parse(row.payload || '{}'),
    status: normalizeOutboxStatus(row.status),
    retryCount: Number(row.retry_count || 0),
    lastAttemptAt: row.last_attempt_at || null,
    errorCode: row.error_code || null,
    lastError: row.last_error || null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }));
}

export async function markPendingOpProcessing(opId) {
  const db = await getDb();
  const now = new Date().toISOString();
  await db.runAsync(
    `
      UPDATE pending_ops
      SET status = 'processing', last_attempt_at = ?, updated_at = ?
      WHERE op_id = ?
        AND status IN ('pending', 'failed')
    `,
    [now, now, opId]
  );
}

export async function markPendingOpDone(opId) {
  const db = await getDb();
  const now = new Date().toISOString();
  await db.runAsync(
    `
      UPDATE pending_ops
      SET status = 'synced',
          last_error = NULL,
          error_code = NULL,
          updated_at = ?
      WHERE op_id = ?
    `,
    [now, opId]
  );
}

export async function markPendingOpFailed(opId, errorMessage, errorCode = null) {
  const db = await getDb();
  const now = new Date().toISOString();
  const message = String(errorMessage || 'Error desconocido');
  const isBlocked = message.startsWith('NO_RETRY:');
  // Error permanente → dead_letter (no se reintenta); transitorio → failed.
  const status = isBlocked ? 'dead_letter' : 'failed';
  const code = errorCode || (isBlocked ? 'BLOCKED' : 'SYNC_FAILED');
  await db.runAsync(
    `
      UPDATE pending_ops
      SET status = ?,
          retry_count = retry_count + 1,
          last_error = ?,
          error_code = ?,
          updated_at = ?
      WHERE op_id = ?
    `,
    [status, message, code, now, opId]
  );
}

export async function resetStuckProcessingOps() {
  const db = await getDb();
  const now = new Date().toISOString();
  await db.runAsync(
    `
      UPDATE pending_ops
      SET status = 'pending',
          updated_at = ?
      WHERE status = 'processing'
    `,
    [now]
  );
}

export async function getPendingSaleOps(tenantId, limit = 200, userId = null) {
  const db = await getDb();
  const rows = await db.getAllAsync(
    `
      SELECT
        op_id, tenant_id, payload, status, retry_count, last_error, created_at, updated_at
      FROM pending_ops
      WHERE op_type = 'CREATE_SALE'
        AND status IN ('pending','failed')
        AND tenant_id = ?
        AND (? IS NULL OR user_id = ?)
      ORDER BY created_at DESC
      LIMIT ?
    `,
    [tenantId, userId, userId, limit]
  );

  return (rows || []).map((row) => ({
    opId: row.op_id,
    tenantId: row.tenant_id,
    payload: JSON.parse(row.payload || '{}'),
    status: normalizeOutboxStatus(row.status),
    retryCount: Number(row.retry_count || 0),
    lastError: row.last_error || null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }));
}

export async function getPendingSaleOpById(opId, userId = null) {
  const db = await getDb();
  const row = await db.getFirstAsync(
    `
      SELECT
        op_id, tenant_id, payload, status, retry_count, last_error, created_at, updated_at
      FROM pending_ops
      WHERE op_type = 'CREATE_SALE'
        AND op_id = ?
        AND status IN ('pending','failed')
        AND (? IS NULL OR user_id = ?)
      LIMIT 1
    `,
    [opId, userId, userId]
  );

  if (!row) return null;
  return {
    opId: row.op_id,
    tenantId: row.tenant_id,
    payload: JSON.parse(row.payload || '{}'),
    status: normalizeOutboxStatus(row.status),
    retryCount: Number(row.retry_count || 0),
    lastError: row.last_error || null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function retryPendingOp(opId) {
  const db = await getDb();
  const now = new Date().toISOString();
  await db.runAsync(
    `
      UPDATE pending_ops
      SET status = 'pending',
          retry_count = 0,
          last_error = NULL,
          error_code = NULL,
          updated_at = ?
      WHERE op_id = ?
    `,
    [now, opId]
  );
}

export async function discardPendingOp(opId) {
  const db = await getDb();
  await db.runAsync(
    `
      DELETE FROM pending_ops
      WHERE op_id = ?
    `,
    [opId]
  );
}

export async function updatePendingOpPayload(opId, payload) {
  const db = await getDb();
  const now = new Date().toISOString();
  await db.runAsync(
    `
      UPDATE pending_ops
      SET payload = ?,
          updated_at = ?
      WHERE op_id = ?
    `,
    [JSON.stringify(payload || {}), now, opId]
  );
}

export async function getAllQueuedOps({ tenantId = null, userId = null, limit = 100 } = {}) {
  const db = await getDb();
  const rows = await db.getAllAsync(
    `
      SELECT
        op_id, op_type, tenant_id, user_id, entity_type, entity_id,
        idempotency_key, payload, status, retry_count, last_attempt_at,
        error_code, last_error, created_at, updated_at
      FROM pending_ops
      WHERE status IN ('pending', 'failed', 'dead_letter')
        AND (? IS NULL OR tenant_id = ?)
        AND (? IS NULL OR user_id = ?)
      ORDER BY created_at ASC
      LIMIT ?
    `,
    [tenantId, tenantId, userId, userId, limit]
  );

  return (rows || []).map((row) => ({
    opId: row.op_id,
    opType: row.op_type,
    tenantId: row.tenant_id,
    userId: row.user_id,
    entityType: row.entity_type || null,
    entityId: row.entity_id || null,
    idempotencyKey: row.idempotency_key || null,
    payload: JSON.parse(row.payload || '{}'),
    status: normalizeOutboxStatus(row.status),
    retryCount: Number(row.retry_count || 0),
    lastAttemptAt: row.last_attempt_at || null,
    errorCode: row.error_code || null,
    lastError: row.last_error || null,
    isNoRetry:
      normalizeOutboxStatus(row.status) === 'dead_letter' ||
      String(row.last_error || '').startsWith('NO_RETRY:'),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }));
}

// ---- Catálogo local (fase 15A.12 / B3): caché por entidad para lectura
// offline y pull incremental. El payload se guarda como JSON (normalizado).

export async function upsertLocalCatalogRows({ tenantId, entityType, rows = [] } = {}) {
  const db = await getDb();
  const now = new Date().toISOString();
  for (const row of rows || []) {
    if (!row?.id) continue;
    await db.runAsync(
      `
        INSERT INTO local_catalog (tenant_id, entity_type, entity_id, updated_at, payload, fetched_at)
        VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(tenant_id, entity_type, entity_id)
        DO UPDATE SET updated_at = excluded.updated_at, payload = excluded.payload, fetched_at = excluded.fetched_at
      `,
      [
        tenantId,
        entityType,
        String(row.id),
        row.updatedAt || null,
        JSON.stringify(row.payload || {}),
        now,
      ]
    );
  }
}

export async function listLocalCatalogSince({
  tenantId,
  entityType,
  since = null,
  limit = 500,
} = {}) {
  const db = await getDb();
  const rows = await db.getAllAsync(
    `
      SELECT entity_id, updated_at, payload
      FROM local_catalog
      WHERE tenant_id = ?
        AND entity_type = ?
        AND (? IS NULL OR updated_at > ?)
      ORDER BY updated_at ASC
      LIMIT ?
    `,
    [tenantId, entityType, since, since, Math.max(1, Number(limit) || 500)]
  );
  return (rows || []).map((row) => ({
    id: row.entity_id,
    updatedAt: row.updated_at,
    payload: JSON.parse(row.payload || '{}'),
  }));
}

export async function countLocalCatalog({ tenantId, entityType = null } = {}) {
  const db = await getDb();
  const row = await db.getFirstAsync(
    `
      SELECT COUNT(*) AS total
      FROM local_catalog
      WHERE tenant_id = ?
        AND (? IS NULL OR entity_type = ?)
    `,
    [tenantId, entityType, entityType]
  );
  return Number(row?.total || 0);
}

export async function clearLocalCatalog({ tenantId = null } = {}) {
  const db = await getDb();
  if (tenantId) {
    await db.runAsync(`DELETE FROM local_catalog WHERE tenant_id = ?`, [tenantId]);
    return;
  }
  await db.execAsync(`DELETE FROM local_catalog;`);
}

export async function clearOfflineOperationalData() {
  const db = await getDb();
  await db.execAsync(`
    DELETE FROM pending_ops;
    DELETE FROM local_catalog;
    DELETE FROM sync_state;
    DELETE FROM local_sales_draft;
    DELETE FROM local_sale_lines_draft;
    DELETE FROM local_payments_draft;
    DELETE FROM local_cartera_payments_draft;
    DELETE FROM local_supplier_payments_draft;
  `);
}
