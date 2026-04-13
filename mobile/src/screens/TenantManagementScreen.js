import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { getTenantBillingSummary } from '../services/tenantBilling.service';

function formatExpiry(summary) {
  if (!summary?.expiration_date) return 'Sin fecha registrada';
  const date = new Date(summary.expiration_date);
  if (Number.isNaN(date.getTime())) return 'Fecha inválida';
  return date.toLocaleDateString('es-CO', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
}

function getPlanLabel(summary) {
  return summary?.plan_name || summary?.status_label || 'Sin plan cargado';
}

export default function TenantManagementScreen({
  tenant,
  offlineMode,
  themeMode = 'dark',
  onOpenScreen,
}) {
  const isLightTheme = themeMode === 'light';
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [source, setSource] = useState('');
  const [billingSummary, setBillingSummary] = useState(null);

  useEffect(() => {
    let active = true;

    const load = async () => {
      if (!tenant?.tenant_id) return;
      setLoading(true);
      setError('');

      const result = await getTenantBillingSummary(tenant.tenant_id, { offlineMode });
      if (!active) return;

      if (result.success) {
        setBillingSummary(result.data || null);
        setSource(result.source || '');
      } else {
        setBillingSummary(null);
        setSource('');
        setError(result.error || 'No fue posible cargar el resumen del tenant.');
      }
      setLoading(false);
    };

    load();

    return () => {
      active = false;
    };
  }, [offlineMode, tenant?.tenant_id]);

  const statItems = useMemo(() => ([
    { label: 'Tenant', value: tenant?.tenant_name || tenant?.name || 'Sin nombre' },
    { label: 'Estado plan', value: billingSummary?.status_label || 'Sin estado' },
    { label: 'Vencimiento', value: formatExpiry(billingSummary) },
  ]), [billingSummary, tenant?.name, tenant?.tenant_name]);

  return (
    <ScrollView contentContainerStyle={[styles.container, isLightTheme && styles.containerLight]}>
      <View style={[styles.heroCard, isLightTheme && styles.heroCardLight]}>
        <Text style={[styles.eyebrow, isLightTheme && styles.eyebrowLight]}>Gestión Empresa</Text>
        <Text style={[styles.title, isLightTheme && styles.titleLight]}>Resumen del tenant</Text>
        <Text style={[styles.subtitle, isLightTheme && styles.subtitleLight]}>
          Mobile ahora tiene una pantalla propia para este acceso. La operación avanzada de tenant management y billing sigue concentrada en web.
        </Text>
      </View>

      <View style={[styles.grid, styles.gridMargin]}>
        {statItems.map((item) => (
          <View key={item.label} style={[styles.statCard, isLightTheme && styles.statCardLight]}>
            <Text style={[styles.statLabel, isLightTheme && styles.statLabelLight]}>{item.label}</Text>
            <Text style={[styles.statValue, isLightTheme && styles.statValueLight]}>{item.value}</Text>
          </View>
        ))}
      </View>

      <View style={[styles.summaryCard, isLightTheme && styles.summaryCardLight]}>
        <View style={styles.summaryHeader}>
          <Text style={[styles.summaryTitle, isLightTheme && styles.summaryTitleLight]}>Suscripción</Text>
          {source ? (
            <Text style={[styles.summaryMeta, isLightTheme && styles.summaryMetaLight]}>
              {source === 'cache' ? 'Caché' : source}
            </Text>
          ) : null}
        </View>

        {loading ? <ActivityIndicator color={isLightTheme ? '#1d4ed8' : '#93c5fd'} /> : null}
        {!loading && error ? (
          <Text style={styles.errorText}>{error}</Text>
        ) : null}
        {!loading && !error ? (
          <>
            <Text style={[styles.summaryBody, isLightTheme && styles.summaryBodyLight]}>
              {billingSummary
                ? `Plan actual: ${getPlanLabel(billingSummary)}. ${billingSummary.days_to_expiry != null ? `Faltan ${billingSummary.days_to_expiry} días.` : 'Sin dato de vigencia.'}`
                : 'No hay resumen de suscripción cargado para este tenant.'}
            </Text>
            <View style={[styles.webOnlyBanner, isLightTheme && styles.webOnlyBannerLight]}>
              <Ionicons name="globe-outline" size={15} color={isLightTheme ? '#92400e' : '#fde68a'} />
              <Text style={[styles.webOnlyText, isLightTheme && styles.webOnlyTextLight]}>
                Facturación superadmin, contabilidad y administración multi-tenant avanzada siguen web-only.
              </Text>
            </View>
          </>
        ) : null}
      </View>

      <View style={[styles.actionsCard, isLightTheme && styles.actionsCardLight]}>
        <Text style={[styles.summaryTitle, isLightTheme && styles.summaryTitleLight]}>Accesos relacionados</Text>
        <View style={styles.actionList}>
          <Pressable
            onPress={() => onOpenScreen?.('TenantConfig')}
            style={[styles.actionRow, isLightTheme && styles.actionRowLight]}
          >
            <Ionicons name="business-outline" size={17} color={isLightTheme ? '#1d4ed8' : '#93c5fd'} />
            <Text style={[styles.actionText, isLightTheme && styles.actionTextLight]}>Configuración de Empresa</Text>
          </Pressable>
          <Pressable
            onPress={() => onOpenScreen?.('Users')}
            style={[styles.actionRow, isLightTheme && styles.actionRowLight]}
          >
            <Ionicons name="people-outline" size={17} color={isLightTheme ? '#1d4ed8' : '#93c5fd'} />
            <Text style={[styles.actionText, isLightTheme && styles.actionTextLight]}>Usuarios</Text>
          </Pressable>
          <Pressable
            onPress={() => onOpenScreen?.('Roles')}
            style={[styles.actionRow, isLightTheme && styles.actionRowLight]}
          >
            <Ionicons name="shield-checkmark-outline" size={17} color={isLightTheme ? '#1d4ed8' : '#93c5fd'} />
            <Text style={[styles.actionText, isLightTheme && styles.actionTextLight]}>Roles</Text>
          </Pressable>
        </View>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    padding: 12,
    backgroundColor: '#060b16',
  },
  containerLight: {
    backgroundColor: '#edf2fb',
  },
  heroCard: {
    borderWidth: 1,
    borderColor: '#223a5e',
    borderRadius: 16,
    backgroundColor: '#0f182b',
    padding: 14,
  },
  heroCardLight: {
    borderColor: '#d5e2f4',
    backgroundColor: '#ffffff',
  },
  eyebrow: {
    color: '#8ec5ff',
    fontSize: 11,
    fontWeight: '700',
    textTransform: 'uppercase',
  },
  eyebrowLight: {
    color: '#235ea9',
  },
  title: {
    color: '#f8fafc',
    fontSize: 22,
    fontWeight: '800',
    marginTop: 4,
  },
  titleLight: {
    color: '#0f172a',
  },
  subtitle: {
    color: '#9fb7dc',
    fontSize: 13,
    lineHeight: 18,
    marginTop: 6,
  },
  subtitleLight: {
    color: '#47638b',
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  gridMargin: {
    marginTop: 10,
  },
  statCard: {
    width: '48.5%',
    borderWidth: 1,
    borderColor: '#223a5e',
    borderRadius: 14,
    backgroundColor: '#0f182b',
    padding: 12,
  },
  statCardLight: {
    borderColor: '#d5e2f4',
    backgroundColor: '#ffffff',
  },
  statLabel: {
    color: '#8fb0d7',
    fontSize: 11,
  },
  statLabelLight: {
    color: '#607b9f',
  },
  statValue: {
    color: '#f8fafc',
    fontSize: 14,
    fontWeight: '800',
    marginTop: 4,
  },
  statValueLight: {
    color: '#0f172a',
  },
  summaryCard: {
    marginTop: 10,
    borderWidth: 1,
    borderColor: '#223a5e',
    borderRadius: 16,
    backgroundColor: '#0f182b',
    padding: 14,
  },
  summaryCardLight: {
    borderColor: '#d5e2f4',
    backgroundColor: '#ffffff',
  },
  summaryHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 8,
    alignItems: 'center',
  },
  summaryTitle: {
    color: '#f8fafc',
    fontSize: 16,
    fontWeight: '800',
  },
  summaryTitleLight: {
    color: '#0f172a',
  },
  summaryMeta: {
    color: '#8fb0d7',
    fontSize: 11,
    fontWeight: '700',
    textTransform: 'uppercase',
  },
  summaryMetaLight: {
    color: '#607b9f',
  },
  summaryBody: {
    color: '#cbd5e1',
    fontSize: 13,
    lineHeight: 19,
    marginTop: 10,
  },
  summaryBodyLight: {
    color: '#334155',
  },
  webOnlyBanner: {
    marginTop: 10,
    borderWidth: 1,
    borderColor: '#92400e',
    backgroundColor: '#3b2a04',
    borderRadius: 12,
    padding: 10,
    flexDirection: 'row',
    gap: 8,
  },
  webOnlyBannerLight: {
    borderColor: '#facc15',
    backgroundColor: '#fef3c7',
  },
  webOnlyText: {
    flex: 1,
    color: '#fde68a',
    fontSize: 12,
    lineHeight: 18,
  },
  webOnlyTextLight: {
    color: '#92400e',
  },
  errorText: {
    color: '#fda4af',
    marginTop: 10,
  },
  actionsCard: {
    marginTop: 10,
    borderWidth: 1,
    borderColor: '#223a5e',
    borderRadius: 16,
    backgroundColor: '#0f182b',
    padding: 14,
  },
  actionsCardLight: {
    borderColor: '#d5e2f4',
    backgroundColor: '#ffffff',
  },
  actionList: {
    marginTop: 10,
    gap: 8,
  },
  actionRow: {
    borderWidth: 1,
    borderColor: '#29456d',
    backgroundColor: '#101d34',
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  actionRowLight: {
    borderColor: '#d8e5f5',
    backgroundColor: '#f8fbff',
  },
  actionText: {
    color: '#dbeafe',
    fontWeight: '700',
    fontSize: 13,
  },
  actionTextLight: {
    color: '#1d4ed8',
  },
});
