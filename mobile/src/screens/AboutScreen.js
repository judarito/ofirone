import { Ionicons } from '@expo/vector-icons';
import { useEffect, useState } from 'react';
import { Image, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useThemeMode } from '../lib/themeMode';
import { getAboutSummary } from '../services/setup.service';
import { getTenantBillingSummary } from '../services/tenantBilling.service';

function formatBillingDate(value) {
  if (!value) return 'Sin fecha registrada';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Fecha inválida';
  return date.toLocaleDateString('es-CO', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
}

function getBillingExpiryLabel(summary) {
  if (!summary) return 'Vence';
  if (summary.status === 'trialing') return 'Fin del trial';
  if (summary.status === 'grace_period') return 'Fin de gracia';
  return 'Vence';
}

function getBillingDaysHint(daysToExpiry) {
  if (!Number.isFinite(daysToExpiry)) return '';
  if (daysToExpiry < 0) return `Venció hace ${Math.abs(daysToExpiry)} día${Math.abs(daysToExpiry) === 1 ? '' : 's'}.`;
  if (daysToExpiry === 0) return 'Vence hoy.';
  if (daysToExpiry === 1) return 'Vence mañana.';
  return `Faltan ${daysToExpiry} días.`;
}

export default function AboutScreen({ tenant, userProfile, offlineMode }) {
  const themeMode = useThemeMode();
  const isLightTheme = themeMode === 'light';
  const [stats, setStats] = useState({
    products: '...',
    sales: '...',
    customers: '...',
    locations: '...',
  });
  const [error, setError] = useState('');
  const [billing, setBilling] = useState(null);
  const [billingError, setBillingError] = useState('');
  const [billingSource, setBillingSource] = useState('');

  useEffect(() => {
    const load = async () => {
      if (!tenant?.tenant_id) return;

      const billingResult = await getTenantBillingSummary(tenant.tenant_id, { offlineMode });
      if (billingResult.success) {
        setBilling(billingResult.data || null);
        setBillingSource(billingResult.source || '');
        setBillingError('');
      } else {
        setBilling(null);
        setBillingSource('');
        setBillingError(billingResult.error || 'No fue posible cargar el plan del tenant.');
      }

      if (offlineMode) return;

      const result = await getAboutSummary(tenant.tenant_id);
      if (!result.success) {
        setError(result.error || 'No fue posible cargar estadisticas');
        return;
      }
      setStats(result.data);
    };
    load();
  }, [tenant?.tenant_id, offlineMode]);

  return (
    <ScrollView contentContainerStyle={[styles.container, isLightTheme && styles.containerLight]}>
      <View style={styles.brandHeader}>
        <Image source={require('../../assets/logo-about.png')} style={styles.brandLogo} resizeMode="contain" />
        <View style={styles.brandTextWrap}>
          <Text style={[styles.title, isLightTheme && styles.titleLight]}>Acerca de OfirOne</Text>
          <Text style={[styles.subtitle, isLightTheme && styles.subtitleLight]}>Sistema de Punto de Venta</Text>
        </View>
      </View>

      <View style={[styles.card, isLightTheme && styles.cardLight]}>
        <View style={styles.sectionHeader}>
          <Ionicons name="hardware-chip-outline" size={15} color={isLightTheme ? '#235ea9' : '#8ec5ff'} />
          <Text style={[styles.sectionTitle, isLightTheme && styles.sectionTitleLight]}>Sistema</Text>
        </View>
        <Text style={[styles.line, isLightTheme && styles.lineLight]}>Version: 1.0.0</Text>
        <Text style={[styles.line, isLightTheme && styles.lineLight]}>Entorno: Mobile</Text>
        <Text style={[styles.line, isLightTheme && styles.lineLight]}>Actualizacion: Marzo 2026</Text>
      </View>

      <View style={[styles.card, isLightTheme && styles.cardLight]}>
        <View style={styles.sectionHeader}>
          <Ionicons name="business-outline" size={15} color={isLightTheme ? '#235ea9' : '#8ec5ff'} />
          <Text style={[styles.sectionTitle, isLightTheme && styles.sectionTitleLight]}>Negocio</Text>
        </View>
        <Text style={[styles.line, isLightTheme && styles.lineLight]}>Empresa: {tenant?.tenant_name || '-'}</Text>
        <Text style={[styles.line, isLightTheme && styles.lineLight]}>Usuario: {userProfile?.full_name || '-'}</Text>
        <Text style={[styles.line, isLightTheme && styles.lineLight]}>Moneda: {tenant?.currency_code || 'COP'}</Text>
      </View>

      <View style={[styles.card, isLightTheme && styles.cardLight]}>
        <View style={styles.sectionHeader}>
          <Ionicons name="card-outline" size={15} color={isLightTheme ? '#235ea9' : '#8ec5ff'} />
          <Text style={[styles.sectionTitle, isLightTheme && styles.sectionTitleLight]}>Plan y Suscripción</Text>
        </View>
        {billing ? (
          <>
            <Text style={[styles.line, isLightTheme && styles.lineLight]}>Plan: {billing.plan_name || billing.plan_code || '-'}</Text>
            <Text style={[styles.line, isLightTheme && styles.lineLight]}>Estado: {billing.status_label || '-'}</Text>
            <Text style={[styles.line, isLightTheme && styles.lineLight]}>
              {getBillingExpiryLabel(billing)}: {formatBillingDate(billing.expiration_date)}
            </Text>
            {getBillingDaysHint(billing.days_to_expiry) ? (
              <Text style={[styles.meta, isLightTheme && styles.metaLight]}>{getBillingDaysHint(billing.days_to_expiry)}</Text>
            ) : null}
            {billing.banner_message ? (
              <Text style={[styles.meta, isLightTheme && styles.metaLight]}>{billing.banner_message}</Text>
            ) : null}
          </>
        ) : (
          <Text style={[styles.line, isLightTheme && styles.lineLight]}>Sin suscripción comercial registrada.</Text>
        )}
        {billingSource && billingSource !== 'default' ? (
          <Text style={[styles.meta, isLightTheme && styles.metaLight]}>Origen billing: {billingSource}</Text>
        ) : null}
        {billingError && !billing ? <Text style={styles.error}>{billingError}</Text> : null}
      </View>

      <View style={[styles.card, isLightTheme && styles.cardLight]}>
        <View style={styles.sectionHeader}>
          <Ionicons name="bar-chart-outline" size={15} color={isLightTheme ? '#235ea9' : '#8ec5ff'} />
          <Text style={[styles.sectionTitle, isLightTheme && styles.sectionTitleLight]}>Estadisticas</Text>
        </View>
        <Text style={[styles.line, isLightTheme && styles.lineLight]}>Productos: {stats.products}</Text>
        <Text style={[styles.line, isLightTheme && styles.lineLight]}>Ventas: {stats.sales}</Text>
        <Text style={[styles.line, isLightTheme && styles.lineLight]}>Clientes: {stats.customers}</Text>
        <Text style={[styles.line, isLightTheme && styles.lineLight]}>Sedes: {stats.locations}</Text>
      </View>

      <View style={[styles.card, isLightTheme && styles.cardLight]}>
        <View style={styles.sectionHeader}>
          <Ionicons name="sparkles-outline" size={15} color={isLightTheme ? '#235ea9' : '#8ec5ff'} />
          <Text style={[styles.sectionTitle, isLightTheme && styles.sectionTitleLight]}>Capacidades</Text>
        </View>
        <Text style={[styles.line, isLightTheme && styles.lineLight]}>- Punto de venta e inventario multi-sede</Text>
        <Text style={[styles.line, isLightTheme && styles.lineLight]}>- Caja, reportes y configuracion por tenant</Text>
        <Text style={[styles.line, isLightTheme && styles.lineLight]}>- Modo offline con sincronizacion diferida</Text>
      </View>

      {offlineMode ? <Text style={[styles.meta, isLightTheme && styles.metaLight]}>Modo offline: estadisticas en tiempo real no disponibles.</Text> : null}
      {error ? <Text style={styles.error}>{error}</Text> : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { backgroundColor: '#060b16', padding: 12 },
  containerLight: { backgroundColor: '#edf2fb' },
  brandHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 8,
  },
  brandLogo: {
    width: 56,
    height: 56,
    marginRight: 10,
  },
  brandTextWrap: {
    flex: 1,
  },
  title: { color: '#f8fafc', fontWeight: '700', fontSize: 22 },
  titleLight: { color: '#0f172a' },
  subtitle: { color: '#94a3b8', marginTop: 2 },
  subtitleLight: { color: '#475569' },
  card: {
    borderWidth: 1,
    borderColor: '#223a5e',
    borderRadius: 14,
    backgroundColor: '#0f182b',
    padding: 12,
    marginBottom: 8,
  },
  cardLight: { borderColor: '#d5e2f4', backgroundColor: '#ffffff' },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 4,
  },
  sectionTitle: { color: '#e2e8f0', fontWeight: '700', marginBottom: 4 },
  sectionTitleLight: { color: '#0f172a' },
  line: { color: '#cbd5e1', marginTop: 2, fontSize: 13 },
  lineLight: { color: '#334155' },
  meta: { color: '#94a3b8', marginTop: 8, fontSize: 12 },
  metaLight: { color: '#475569' },
  error: { color: '#f87171', marginTop: 8, fontSize: 12 },
});
