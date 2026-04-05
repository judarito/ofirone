import React from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { APP_TEXT, COMMON_TEXT } from '../constants/uiText';

const SEVERITY_LABELS = {
  INFO: 'Informativa',
  WARNING: 'Atencion',
  CRITICAL: 'Critica',
  SUCCESS: 'Completada',
};

function normalizeSearchText(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

function collapseSpaces(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function parsePayload(payload) {
  if (payload && typeof payload === 'object' && !Array.isArray(payload)) return payload;
  if (typeof payload !== 'string') return {};
  try {
    const parsed = JSON.parse(payload);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch (_error) {
    return {};
  }
}

function cleanNotificationTitle(value) {
  return collapseSpaces(String(value || '').replace(/^\[[^\]]+\]\s*/g, ''));
}

function isGenericMessage(value) {
  const normalized = normalizeSearchText(value);
  return (
    !normalized ||
    normalized === 'se detecto una alerta del sistema' ||
    normalized === 'system alert detected' ||
    normalized === 'sin detalles adicionales' ||
    normalized === 'no additional details'
  );
}

function inferTopic({ title, message, eventType, payload }) {
  const haystack = normalizeSearchText(
    [
      title,
      message,
      eventType,
      payload?.event_type,
      payload?.category,
      payload?.module,
      payload?.entity_type,
    ]
      .filter(Boolean)
      .join(' '),
  );

  if (
    haystack.includes('receivable') ||
    haystack.includes('cartera') ||
    haystack.includes('cobranza') ||
    haystack.includes('saldo')
  ) {
    return 'receivable';
  }
  if (
    haystack.includes('expiration') ||
    haystack.includes('expiry') ||
    haystack.includes('expira') ||
    haystack.includes('vence') ||
    haystack.includes('venc')
  ) {
    return 'expiration';
  }
  if (
    haystack.includes('stock') ||
    haystack.includes('inventory') ||
    haystack.includes('quiebre') ||
    haystack.includes('agotado')
  ) {
    return 'stock';
  }
  if (
    haystack.includes('payable') ||
    haystack.includes('proveedor') ||
    haystack.includes('compra') ||
    haystack.includes('purchase')
  ) {
    return 'purchase';
  }
  if (haystack.includes('cash') || haystack.includes('caja')) {
    return 'cash';
  }
  if (haystack.includes('sale') || haystack.includes('venta')) {
    return 'sale';
  }
  return 'system';
}

function getEntityLabel(payload, rawMessage) {
  const payloadEntity = collapseSpaces(
    payload?.entity_name ||
      payload?.product_name ||
      payload?.variant_name ||
      payload?.customer_name ||
      payload?.client_name ||
      payload?.supplier_name ||
      payload?.location_name ||
      payload?.cash_register_name ||
      '',
  );
  if (payloadEntity) return payloadEntity;

  const cleanedMessage = collapseSpaces(rawMessage);
  if (!cleanedMessage || isGenericMessage(cleanedMessage)) return '';
  if (cleanedMessage.length <= 70 && !/[.!?]/.test(cleanedMessage)) return cleanedMessage;
  return '';
}

function isEntityOnlyMessage(rawMessage, entityLabel) {
  return Boolean(entityLabel) && normalizeSearchText(rawMessage) === normalizeSearchText(entityLabel);
}

function buildFallbackMessage(rawMessage, fallbackMessage, entityLabel = '') {
  if (isEntityOnlyMessage(rawMessage, entityLabel)) return fallbackMessage;
  if (!isGenericMessage(rawMessage)) return collapseSpaces(rawMessage);
  return fallbackMessage;
}

function formatNotificationCopy(item) {
  const rawTitle = cleanNotificationTitle(item?.title);
  const rawMessage = collapseSpaces(item?.message);
  const payload = parsePayload(item?.payload);
  const topic = inferTopic({
    title: rawTitle,
    message: rawMessage,
    eventType: item?.event_type,
    payload,
  });
  const entityLabel = getEntityLabel(payload, rawMessage);
  const severityLabel = SEVERITY_LABELS[String(item?.severity || '').toUpperCase()] || 'Notificacion';

  if (topic === 'receivable') {
    return {
      severityLabel,
      title: entityLabel ? `Cartera por revisar: ${entityLabel}` : 'Cartera por revisar',
      message: buildFallbackMessage(
        rawMessage,
        entityLabel
          ? `${entityLabel} tiene cartera pendiente. Revisa saldo, vencimiento y gestion de cobro.`
          : 'Hay cuentas por cobrar que requieren seguimiento.',
        entityLabel,
      ),
    };
  }

  if (topic === 'expiration') {
    return {
      severityLabel,
      title: entityLabel ? `Vencimiento por revisar: ${entityLabel}` : 'Productos por vencer',
      message: buildFallbackMessage(
        rawMessage,
        entityLabel
          ? `${entityLabel} tiene lotes vencidos o proximos a vencer. Revisa fechas y rotacion.`
          : 'Hay productos con vencimiento cercano que requieren atencion.',
        entityLabel,
      ),
    };
  }

  if (topic === 'stock') {
    return {
      severityLabel,
      title: entityLabel ? `Stock por revisar: ${entityLabel}` : 'Stock por revisar',
      message: buildFallbackMessage(
        rawMessage,
        entityLabel
          ? `${entityLabel} presenta riesgo de stock bajo o agotado.`
          : 'Se detecto una novedad de inventario que requiere revision.',
        entityLabel,
      ),
    };
  }

  if (topic === 'purchase') {
    return {
      severityLabel,
      title: entityLabel ? `Compra por revisar: ${entityLabel}` : 'Compra por revisar',
      message: buildFallbackMessage(
        rawMessage,
        entityLabel
          ? `Revisa la compra o el compromiso asociado a ${entityLabel}.`
          : 'Hay una novedad de compras o pagos a proveedores que requiere revision.',
        entityLabel,
      ),
    };
  }

  if (topic === 'cash') {
    return {
      severityLabel,
      title: entityLabel ? `Caja por revisar: ${entityLabel}` : 'Caja por revisar',
      message: buildFallbackMessage(
        rawMessage,
        entityLabel
          ? `Revisa el movimiento o la alerta asociada a ${entityLabel}.`
          : 'Se detecto una novedad de caja que requiere revision.',
        entityLabel,
      ),
    };
  }

  if (topic === 'sale') {
    return {
      severityLabel,
      title: entityLabel ? `Venta por revisar: ${entityLabel}` : 'Venta por revisar',
      message: buildFallbackMessage(
        rawMessage,
        entityLabel
          ? `Revisa la novedad asociada a ${entityLabel}.`
          : 'Se detecto una novedad en ventas que requiere revision.',
        entityLabel,
      ),
    };
  }

  return {
    severityLabel,
    title: rawTitle || 'Notificacion del sistema',
    message: buildFallbackMessage(rawMessage, 'Se detecto una novedad del sistema que requiere revision.'),
  };
}

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
              notifications.map((item) => {
                const formatted = formatNotificationCopy(item);
                return (
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
                        {formatted.severityLabel}
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
                      {formatted.title}
                    </Text>
                    <Text
                      style={[
                        styles.notificationMessage,
                        isLightTheme ? styles.notificationMessageLight : null,
                      ]}
                    >
                      {formatted.message}
                    </Text>
                  </Pressable>
                );
              })
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
