import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { getAllQueuedOps, discardPendingOp, retryPendingOp } from '../storage/sqlite/database';
import { syncPendingOperations } from '../services/sync.service';

const OP_TYPE_LABELS = {
  CREATE_SALE: 'Venta',
  CREATE_CARTERA_PAYMENT: 'Pago cartera',
  CREATE_SUPPLIER_PAYMENT: 'Pago proveedor',
  CREATE_RETURN: 'Devolución',
};

function formatRelativeTime(isoDate) {
  if (!isoDate) return '';
  const diffMs = Date.now() - new Date(isoDate).getTime();
  const diffMin = Math.floor(diffMs / 60000);
  if (diffMin < 1) return 'ahora';
  if (diffMin < 60) return `hace ${diffMin} min`;
  const diffH = Math.floor(diffMin / 60);
  if (diffH < 24) return `hace ${diffH} h`;
  return `hace ${Math.floor(diffH / 24)} d`;
}

function cleanError(lastError) {
  return String(lastError || '').replace(/^NO_RETRY:/, '').trim();
}

/**
 * Modal que muestra la cola de operaciones pendientes de sincronización,
 * permite reintentar o descartar cada operación.
 */
export function SyncQueueModal({
  visible,
  isLightTheme,
  tenantId,
  userId,
  offlineMode,
  onClose,
  onQueueChange,
}) {
  const [ops, setOps] = useState([]);
  const [loading, setLoading] = useState(false);
  const [syncing, setSyncing] = useState(false);

  const load = useCallback(async () => {
    if (!tenantId) return;
    setLoading(true);
    try {
      const result = await getAllQueuedOps({ tenantId, userId, limit: 100 });
      setOps(result);
    } finally {
      setLoading(false);
    }
  }, [tenantId, userId]);

  useEffect(() => {
    if (visible) load();
  }, [visible, load]);

  const handleRetry = async (opId) => {
    await retryPendingOp(opId);
    await load();
    onQueueChange?.();
  };

  const handleDiscard = async (opId) => {
    await discardPendingOp(opId);
    await load();
    onQueueChange?.();
  };

  const handleSyncNow = async () => {
    if (offlineMode) return;
    setSyncing(true);
    try {
      await syncPendingOperations({ tenantId, userId, limit: 100 });
      await load();
      onQueueChange?.();
    } finally {
      setSyncing(false);
    }
  };

  const pendingCount = ops.filter((o) => !o.isNoRetry).length;
  const blockedCount = ops.filter((o) => o.isNoRetry).length;

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={s.overlay}>
        <Pressable style={s.backdrop} onPress={onClose} />
        <View style={[s.sheet, isLightTheme ? s.sheetLight : null]}>

          {/* Header */}
          <View style={[s.header, isLightTheme ? s.headerLight : null]}>
            <View style={s.headerLeft}>
              <Ionicons
                name="sync-outline"
                size={16}
                style={[s.headerIcon, isLightTheme ? s.headerIconLight : null]}
              />
              <Text style={[s.headerTitle, isLightTheme ? s.headerTitleLight : null]}>
                Cola de sincronización
              </Text>
            </View>
            <Pressable onPress={onClose} style={[s.closeBtn, isLightTheme ? s.closeBtnLight : null]}>
              <Text style={[s.closeBtnText, isLightTheme ? s.closeBtnTextLight : null]}>Cerrar</Text>
            </Pressable>
          </View>

          {/* Stats row */}
          <View style={[s.statsRow, isLightTheme ? s.statsRowLight : null]}>
            <View style={s.statChip}>
              <Text style={[s.statNum, { color: '#60a5fa' }]}>{pendingCount}</Text>
              <Text style={[s.statLabel, isLightTheme ? s.statLabelLight : null]}>pendientes</Text>
            </View>
            <View style={s.statChip}>
              <Text style={[s.statNum, { color: '#f87171' }]}>{blockedCount}</Text>
              <Text style={[s.statLabel, isLightTheme ? s.statLabelLight : null]}>bloqueadas</Text>
            </View>
            <Pressable
              onPress={handleSyncNow}
              disabled={offlineMode || syncing}
              style={[s.syncNowBtn, (offlineMode || syncing) ? s.syncNowBtnDisabled : null]}
            >
              {syncing
                ? <ActivityIndicator size="small" color="#ffffff" />
                : <Text style={s.syncNowText}>{offlineMode ? 'Sin red' : 'Sync ahora'}</Text>
              }
            </Pressable>
          </View>

          {/* List */}
          <ScrollView contentContainerStyle={s.list}>
            {loading ? (
              <ActivityIndicator color="#60a5fa" style={{ marginVertical: 24 }} />
            ) : ops.length === 0 ? (
              <View style={s.emptyWrap}>
                <Ionicons name="checkmark-circle-outline" size={32} color="#4ade80" />
                <Text style={[s.emptyText, isLightTheme ? s.emptyTextLight : null]}>
                  No hay operaciones pendientes
                </Text>
              </View>
            ) : (
              ops.map((op) => (
                <View
                  key={op.opId}
                  style={[
                    s.opCard,
                    isLightTheme ? s.opCardLight : null,
                    op.isNoRetry ? s.opCardBlocked : null,
                  ]}
                >
                  <View style={s.opTopRow}>
                    <View style={[s.opTypeBadge, op.isNoRetry ? s.opTypeBadgeBlocked : s.opTypeBadgePending]}>
                      <Text style={s.opTypeBadgeText}>
                        {OP_TYPE_LABELS[op.opType] || op.opType}
                      </Text>
                    </View>
                    <Text style={[s.opDate, isLightTheme ? s.opDateLight : null]}>
                      {formatRelativeTime(op.createdAt)}
                    </Text>
                  </View>

                  <View style={s.opMeta}>
                    <Text style={[s.opMetaText, isLightTheme ? s.opMetaTextLight : null]}>
                      Reintentos: {op.retryCount}
                    </Text>
                    {op.isNoRetry && (
                      <View style={s.blockedBadge}>
                        <Ionicons name="ban-outline" size={11} color="#fca5a5" />
                        <Text style={s.blockedBadgeText}>bloqueada</Text>
                      </View>
                    )}
                  </View>

                  {op.lastError ? (
                    <Text style={[s.opError, isLightTheme ? s.opErrorLight : null]} numberOfLines={2}>
                      {cleanError(op.lastError)}
                    </Text>
                  ) : null}

                  <View style={s.opActions}>
                    <Pressable
                      onPress={() => handleRetry(op.opId)}
                      style={[s.actionBtn, s.retryBtn]}
                      disabled={syncing || loading}
                    >
                      <Ionicons name="refresh-outline" size={13} color="#bfdbfe" />
                      <Text style={s.retryBtnText}>Reintentar</Text>
                    </Pressable>
                    <Pressable
                      onPress={() => handleDiscard(op.opId)}
                      style={[s.actionBtn, s.discardBtn, isLightTheme ? s.discardBtnLight : null]}
                      disabled={syncing || loading}
                    >
                      <Ionicons name="trash-outline" size={13} color={isLightTheme ? '#dc2626' : '#fca5a5'} />
                      <Text style={[s.discardBtnText, isLightTheme ? s.discardBtnTextLight : null]}>
                        Descartar
                      </Text>
                    </Pressable>
                  </View>
                </View>
              ))
            )}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

const s = StyleSheet.create({
  overlay: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(2,6,23,0.6)',
  },
  sheet: {
    backgroundColor: '#0f172a',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    borderTopWidth: 1,
    borderColor: '#1e3a5f',
    maxHeight: '80%',
  },
  sheetLight: {
    backgroundColor: '#f8fafc',
    borderColor: '#cbd5e1',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#1e293b',
  },
  headerLight: {
    borderBottomColor: '#e2e8f0',
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
  },
  headerIcon: {
    color: '#60a5fa',
  },
  headerIconLight: {
    color: '#2563eb',
  },
  headerTitle: {
    color: '#e2e8f0',
    fontSize: 15,
    fontWeight: '700',
  },
  headerTitleLight: {
    color: '#0f172a',
  },
  closeBtn: {
    borderWidth: 1,
    borderColor: '#334155',
    borderRadius: 8,
    paddingVertical: 5,
    paddingHorizontal: 10,
    backgroundColor: '#1e293b',
  },
  closeBtnLight: {
    borderColor: '#cbd5e1',
    backgroundColor: '#ffffff',
  },
  closeBtnText: {
    color: '#e2e8f0',
    fontSize: 12,
    fontWeight: '600',
  },
  closeBtnTextLight: {
    color: '#334155',
  },
  statsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 10,
    gap: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#1e293b',
  },
  statsRowLight: {
    borderBottomColor: '#e2e8f0',
  },
  statChip: {
    alignItems: 'center',
  },
  statNum: {
    fontSize: 20,
    fontWeight: '800',
  },
  statLabel: {
    color: '#94a3b8',
    fontSize: 10,
    fontWeight: '600',
    textTransform: 'uppercase',
  },
  statLabelLight: {
    color: '#64748b',
  },
  syncNowBtn: {
    marginLeft: 'auto',
    backgroundColor: '#1d4ed8',
    borderRadius: 10,
    paddingVertical: 8,
    paddingHorizontal: 14,
    minWidth: 90,
    alignItems: 'center',
  },
  syncNowBtnDisabled: {
    backgroundColor: '#334155',
  },
  syncNowText: {
    color: '#ffffff',
    fontSize: 13,
    fontWeight: '700',
  },
  list: {
    padding: 12,
    gap: 8,
  },
  emptyWrap: {
    alignItems: 'center',
    paddingVertical: 32,
    gap: 10,
  },
  emptyText: {
    color: '#94a3b8',
    fontSize: 14,
  },
  emptyTextLight: {
    color: '#475569',
  },
  opCard: {
    borderWidth: 1,
    borderColor: '#1e3a5f',
    borderRadius: 12,
    backgroundColor: '#111827',
    padding: 11,
    gap: 6,
  },
  opCardLight: {
    borderColor: '#cbd5e1',
    backgroundColor: '#ffffff',
  },
  opCardBlocked: {
    borderColor: '#7f1d1d',
  },
  opTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  opTypeBadge: {
    borderRadius: 6,
    paddingVertical: 2,
    paddingHorizontal: 8,
  },
  opTypeBadgePending: {
    backgroundColor: '#1e3a5f',
  },
  opTypeBadgeBlocked: {
    backgroundColor: '#4c1010',
  },
  opTypeBadgeText: {
    color: '#bfdbfe',
    fontSize: 11,
    fontWeight: '700',
  },
  opDate: {
    color: '#64748b',
    fontSize: 11,
  },
  opDateLight: {
    color: '#94a3b8',
  },
  opMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  opMetaText: {
    color: '#94a3b8',
    fontSize: 11,
  },
  opMetaTextLight: {
    color: '#64748b',
  },
  blockedBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    backgroundColor: '#450a0a',
    borderRadius: 5,
    paddingVertical: 2,
    paddingHorizontal: 5,
  },
  blockedBadgeText: {
    color: '#fca5a5',
    fontSize: 10,
    fontWeight: '700',
  },
  opError: {
    color: '#f87171',
    fontSize: 11,
    lineHeight: 15,
  },
  opErrorLight: {
    color: '#dc2626',
  },
  opActions: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 2,
  },
  actionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    borderRadius: 8,
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderWidth: 1,
  },
  retryBtn: {
    borderColor: '#1d4ed8',
    backgroundColor: '#172554',
  },
  retryBtnText: {
    color: '#bfdbfe',
    fontSize: 12,
    fontWeight: '600',
  },
  discardBtn: {
    borderColor: '#450a0a',
    backgroundColor: '#1c0808',
  },
  discardBtnLight: {
    borderColor: '#fecaca',
    backgroundColor: '#fff1f1',
  },
  discardBtnText: {
    color: '#fca5a5',
    fontSize: 12,
    fontWeight: '600',
  },
  discardBtnTextLight: {
    color: '#dc2626',
  },
});
