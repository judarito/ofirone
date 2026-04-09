import { useState, useEffect, useCallback } from 'react';
import {
  getUnreadNotificationsCount,
  listMyNotifications,
  markAllNotificationsRead,
  markNotificationRead,
  subscribeMyNotifications,
  unsubscribeNotifications,
} from '../services/notifications.service';

/**
 * Gestiona el estado y las suscripciones realtime de notificaciones in-app.
 */
export function useNotifications({ session, offlineMode, tenant, userProfile }) {
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [notifications, setNotifications] = useState([]);
  const [unreadNotifications, setUnreadNotifications] = useState(0);
  const [loadingNotifications, setLoadingNotifications] = useState(false);

  const refreshNotifications = async () => {
    if (!session || offlineMode) return;
    const [listResult, unreadResult] = await Promise.all([
      listMyNotifications({ limit: 40, offset: 0, onlyUnread: false }),
      getUnreadNotificationsCount(),
    ]);
    if (listResult.success) setNotifications(listResult.data || []);
    if (unreadResult.success) setUnreadNotifications(Number(unreadResult.data || 0));
  };

  const handleOpenNotifications = async () => {
    setNotificationsOpen(true);
    setLoadingNotifications(true);
    try {
      await refreshNotifications();
    } finally {
      setLoadingNotifications(false);
    }
  };

  const handleMarkNotificationRead = async (notificationId) => {
    if (!notificationId) return;
    const result = await markNotificationRead(notificationId);
    if (!result.success) return;
    setNotifications((prev) =>
      prev.map((item) =>
        item.notification_id === notificationId
          ? { ...item, is_read: true, read_at: item.read_at || new Date().toISOString() }
          : item,
      ),
    );
    setUnreadNotifications((prev) => Math.max(0, prev - 1));
  };

  const handleMarkAllNotificationsRead = async () => {
    const result = await markAllNotificationsRead();
    if (!result.success) return;
    const nowIso = new Date().toISOString();
    setNotifications((prev) =>
      prev.map((item) => ({ ...item, is_read: true, read_at: item.read_at || nowIso })),
    );
    setUnreadNotifications(0);
  };

  useEffect(() => {
    if (!session || offlineMode || !tenant?.tenant_id || !userProfile?.user_id) return undefined;
    let active = true;

    refreshNotifications();

    const channel = subscribeMyNotifications({
      tenantId: tenant.tenant_id,
      userId: userProfile.user_id,
      onInsert: (row) => {
        if (!active) return;
        setNotifications((prev) =>
          [row, ...prev.filter((x) => x.notification_id !== row.notification_id)].slice(0, 80),
        );
        if (!row?.is_read) setUnreadNotifications((prev) => prev + 1);
      },
      onUpdate: (nextRow) => {
        if (!active) return;
        setNotifications((prev) => {
          const prevRow = prev.find((x) => x.notification_id === nextRow.notification_id);
          if (prevRow) {
            if (!prevRow.is_read && nextRow.is_read) {
              setUnreadNotifications((count) => Math.max(0, count - 1));
            } else if (prevRow.is_read && !nextRow.is_read) {
              setUnreadNotifications((count) => count + 1);
            }
          }
          return prev.map((x) =>
            x.notification_id === nextRow.notification_id ? { ...x, ...nextRow } : x,
          );
        });
      },
    });

    return () => {
      active = false;
      unsubscribeNotifications(channel);
    };
  }, [session, offlineMode, tenant?.tenant_id, userProfile?.user_id]); // eslint-disable-line react-hooks/exhaustive-deps

  const reset = useCallback(() => {
    setNotificationsOpen(false);
    setNotifications([]);
    setUnreadNotifications(0);
  }, []);

  return {
    notificationsOpen,
    setNotificationsOpen,
    notifications,
    unreadNotifications,
    loadingNotifications,
    refreshNotifications,
    handleOpenNotifications,
    handleMarkNotificationRead,
    handleMarkAllNotificationsRead,
    reset,
  };
}
