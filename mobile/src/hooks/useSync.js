import { useEffect, useRef } from 'react';
import { syncPendingOperations } from '../services/sync.service';
import { getPendingOpsCount } from '../storage/sqlite/database';

/**
 * Gestiona el loop de sincronización de operaciones pendientes (cada 20s)
 * y el calentamiento de cachés cuando la red se recupera.
 *
 * @param {object} params
 * @param {object} params.session - Sesión activa de Supabase
 * @param {boolean} params.networkReachable - Si hay red disponible
 * @param {object} params.tenant - Tenant activo
 * @param {object} params.userProfile - Perfil del usuario
 * @param {function} params.onPendingOpsChange - Callback para actualizar el conteo de ops pendientes
 * @param {function} params.onSyncSuccess - Callback al sincronizar con éxito (recibe tenantId, userId)
 * @param {function} params.onNetworkRecovery - Callback al recuperar red (recibe tenantId, userId)
 */
export function useSync({
  session,
  networkReachable,
  tenant,
  userProfile,
  onPendingOpsChange,
  onSyncSuccess,
  onNetworkRecovery,
}) {
  const previousReachableRef = useRef(networkReachable);

  useEffect(() => {
    let timer = null;
    let active = true;

    const runSync = async () => {
      // Use networkReachable (actual connectivity) instead of offlineMode (UI state).
      // This allows the sync loop to run even while the UI is in offline mode,
      // as long as the network is physically reachable.
      if (!active || !networkReachable || !session || !userProfile?.user_id || !tenant?.tenant_id) return;
      const syncResult = await syncPendingOperations({
        limit: 20,
        tenantId: tenant.tenant_id,
        userId: userProfile.user_id,
      });
      const pendingCount = await getPendingOpsCount({
        tenantId: tenant.tenant_id,
        userId: userProfile.user_id,
      });
      onPendingOpsChange?.(pendingCount);
      if (syncResult?.processed > 0) {
        onSyncSuccess?.(tenant.tenant_id, userProfile.user_id);
      }
    };

    runSync();
    timer = setInterval(runSync, 20000);

    return () => {
      active = false;
      if (timer) clearInterval(timer);
    };
  }, [networkReachable, onPendingOpsChange, onSyncSuccess, session, userProfile?.user_id, tenant?.tenant_id]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const wasReachable = previousReachableRef.current;
    previousReachableRef.current = networkReachable;

    if (!session || !networkReachable || !tenant?.tenant_id || !userProfile?.user_id) return;
    if (!wasReachable && networkReachable) {
      onNetworkRecovery?.(tenant.tenant_id, userProfile.user_id);
    }
  }, [networkReachable, onNetworkRecovery, session, tenant?.tenant_id, userProfile?.user_id]); // eslint-disable-line react-hooks/exhaustive-deps
}
