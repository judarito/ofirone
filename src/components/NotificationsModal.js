import React from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { APP_TEXT, COMMON_TEXT } from '../constants/uiText';

/**
 * Modal de notificaciones in-app con lista, marcar leído y marcar todos.
 */
export function NotificationsModal({
  visible,
  isLightTheme,
  notifications,
  loadingNotifications,
  onClose,
  onMarkRead,
  onMarkAllRead,
  formatDateTime,
}) {
  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
    >
      <View style={styles.menuOverlay}>
        <Pressable style={styles.menuBackdrop} onPress={onClose} />
        <View
          style={[styles.notificationsModal, isLightTheme ? styles.notificationsModalLight : null]}
        >
          <View style={styles.notificationsHeader}>
            <Text
              style={[
                styles.notificationsTitle,
                isLightTheme ? styles.notificationsTitleLight : null,
              ]}
            >
              {APP_TEXT.notifications}
            </Text>
            <View style={styles.notificationsHeaderActions}>
              <Pressable onPress={onMarkAllRead} style={styles.notificationsMarkAllBtn}>
                <Text style={styles.notificationsMarkAllText}>{APP_TEXT.markAll}</Text>
              </Pressable>
              <Pressable
                onPress={onClose}
                style={[
                  styles.notificationsCloseBtn,
                  isLightTheme ? styles.notificationsCloseBtnLight : null,
                ]}
              >
                <Text
                  style={[
                    styles.notificationsCloseText,
                    isLightTheme ? styles.notificationsCloseTextLight : null,
                  ]}
                >
                  {COMMON_TEXT.close}
                </Text>
              </Pressable>
            </View>
          </View>

          <ScrollView contentContainerStyle={styles.notificationsList}>
            {loadingNotifications ? (
              <Text
                style={[
                  styles.notificationsEmpty,
                  isLightTheme ? styles.notificationsEmptyLight : null,
                ]}
              >
                {COMMON_TEXT.loading}
              </Text>
            ) : notifications.length === 0 ? (
              <Text
                style={[
                  styles.notificationsEmpty,
                  isLightTheme ? styles.notificationsEmptyLight : null,
                ]}
              >
                {APP_TEXT.noNotifications}
              </Text>
            ) : (
              notifications.map((item) => (
                <Pressable
                  key={item.notification_id}
                  onPress={() => onMarkRead(item.notification_id)}
                  style={[
                    styles.notificationItem,
                    isLightTheme ? styles.notificationItemLight : null,
                    !item.is_read ? styles.notificationItemUnread : null,
                  ]}
                >
                  <View style={styles.notificationTopRow}>
                    <Text
                      style={[
                        styles.notificationSeverity,
                        isLightTheme ? styles.notificationSeverityLight : null,
                      ]}
                    >
                      {item.severity}
                    </Text>
                    <Text
                      style={[
                        styles.notificationDate,
                        isLightTheme ? styles.notificationDateLight : null,
                      ]}
                    >
                      {formatDateTime(item.created_at)}
                    </Text>
                  </View>
                  <Text
                    style={[
                      styles.notificationTitle,
                      isLightTheme ? styles.notificationTitleLight : null,
                    ]}
                  >
                    {item.title}
                  </Text>
                  <Text
                    style={[
                      styles.notificationMessage,
                      isLightTheme ? styles.notificationMessageLight : null,
                    ]}
                  >
                    {item.message}
                  </Text>
                </Pressable>
              ))
            )}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  menuOverlay: {
    flex: 1,
    flexDirection: 'row',
  },
  menuBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(2, 6, 23, 0.5)',
  },
  notificationsModal: {
    width: '92%',
    maxHeight: '78%',
    backgroundColor: '#0f172a',
    borderColor: '#334155',
    borderWidth: 1,
    borderRadius: 14,
    alignSelf: 'center',
    marginTop: 80,
    paddingBottom: 12,
  },
  notificationsModalLight: {
    backgroundColor: '#f8fafc',
    borderColor: '#cbd5e1',
  },
  notificationsHeader: {
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#334155',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  notificationsHeaderActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  notificationsTitle: {
    color: '#e2e8f0',
    fontSize: 15,
    fontWeight: '700',
  },
  notificationsTitleLight: {
    color: '#0f172a',
  },
  notificationsMarkAllBtn: {
    borderWidth: 1,
    borderColor: '#1d4ed8',
    borderRadius: 8,
    paddingVertical: 5,
    paddingHorizontal: 8,
  },
  notificationsMarkAllText: {
    color: '#93c5fd',
    fontSize: 12,
    fontWeight: '700',
  },
  notificationsCloseBtn: {
    borderWidth: 1,
    borderColor: '#475569',
    borderRadius: 8,
    paddingVertical: 5,
    paddingHorizontal: 8,
    backgroundColor: '#1e293b',
  },
  notificationsCloseBtnLight: {
    borderColor: '#cbd5e1',
    backgroundColor: '#ffffff',
  },
  notificationsCloseText: {
    color: '#e2e8f0',
    fontSize: 12,
    fontWeight: '700',
  },
  notificationsCloseTextLight: {
    color: '#334155',
  },
  notificationsList: {
    paddingHorizontal: 12,
    paddingVertical: 10,
    gap: 8,
  },
  notificationsEmpty: {
    color: '#94a3b8',
    textAlign: 'center',
    paddingVertical: 16,
  },
  notificationsEmptyLight: {
    color: '#475569',
  },
  notificationItem: {
    borderWidth: 1,
    borderColor: '#334155',
    borderRadius: 10,
    backgroundColor: '#111827',
    padding: 10,
    gap: 4,
  },
  notificationItemLight: {
    borderColor: '#cbd5e1',
    backgroundColor: '#ffffff',
  },
  notificationItemUnread: {
    borderColor: '#2563eb',
  },
  notificationTopRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  notificationSeverity: {
    color: '#93c5fd',
    fontSize: 11,
    fontWeight: '700',
  },
  notificationSeverityLight: {
    color: '#1d4ed8',
  },
  notificationDate: {
    color: '#94a3b8',
    fontSize: 11,
  },
  notificationDateLight: {
    color: '#64748b',
  },
  notificationTitle: {
    color: '#e2e8f0',
    fontWeight: '700',
    fontSize: 13,
  },
  notificationTitleLight: {
    color: '#0f172a',
  },
  notificationMessage: {
    color: '#cbd5e1',
    fontSize: 12,
    lineHeight: 16,
  },
  notificationMessageLight: {
    color: '#334155',
  },
});
