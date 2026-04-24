import { useState, useEffect, useCallback } from 'react';
import {
  getOnlineOrderAlerts,
  subscribeToAlerts,
  unsubscribeFromAlerts,
} from '../services/alerts.service';

/**
 * Mantiene en tiempo real el conteo de alertas ONLINE_ORDER desde system_alerts.
 * Úsalo para el badge del tab y para saber cuántos pedidos siguen pendientes.
 */
export function useOnlineOrderAlerts({ tenantId, offlineMode }) {
  const [alerts, setAlerts] = useState([]);
  const [loading, setLoading] = useState(false);

  const pendingCount = alerts.length;

  const refresh = useCallback(async () => {
    if (!tenantId || offlineMode) return;
    setLoading(true);
    try {
      const result = await getOnlineOrderAlerts(tenantId);
      if (result.success) setAlerts(result.data || []);
    } finally {
      setLoading(false);
    }
  }, [tenantId, offlineMode]);

  useEffect(() => {
    if (!tenantId || offlineMode) return undefined;

    refresh();

    const channel = subscribeToAlerts(tenantId, (payload) => {
      const record = payload?.new || payload?.old;
      if (record?.alert_type !== 'ONLINE_ORDER') return;

      if (payload.eventType === 'INSERT') {
        setAlerts((prev) => {
          const exists = prev.find((a) => a.alert_id === record.alert_id);
          if (exists) return prev;
          return [record, ...prev];
        });
      } else if (payload.eventType === 'UPDATE') {
        setAlerts((prev) =>
          prev.map((a) => (a.alert_id === record.alert_id ? { ...a, ...record } : a)),
        );
      } else if (payload.eventType === 'DELETE') {
        setAlerts((prev) => prev.filter((a) => a.alert_id !== record.alert_id));
      }
    });

    return () => {
      unsubscribeFromAlerts(channel);
    };
  }, [tenantId, offlineMode]); // eslint-disable-line react-hooks/exhaustive-deps

  return { alerts, loading, pendingCount, refresh };
}
