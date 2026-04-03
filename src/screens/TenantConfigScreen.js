import { useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import SearchableSelectField from '../components/SearchableSelectField';
import { getTenantConfig, saveTenantConfig } from '../services/setup.service';
import { getTenantBillingSummary } from '../services/tenantBilling.service';
import {
  getActiveResolution,
  getDefaultFeProviderConfig,
  getDefaultInvoiceResolution,
  getProviderConfig,
  saveProviderConfig,
  upsertResolution,
} from '../services/electronicInvoicing.service';

const TABS = [
  { key: 'general', label: 'General' },
  { key: 'ui', label: 'Interfaz' },
  { key: 'ai', label: 'IA' },
  { key: 'accounting', label: 'Contabilidad' },
  { key: 'inventory', label: 'Inventario' },
  { key: 'sales', label: 'Ventas' },
  { key: 'invoicing', label: 'Facturación' },
  { key: 'notifications', label: 'Notificaciones' },
];

const ACCOUNTING_MODE_OPTIONS = [
  { key: 'OFF', label: 'OFF - Desactivado' },
  { key: 'ASYNC', label: 'ASYNC - Cola desacoplada' },
  { key: 'MANUAL', label: 'MANUAL - Registro manual' },
];

const ROUNDING_METHOD_OPTIONS = [
  { key: 'normal', label: 'Normal (Matemático)' },
  { key: 'up', label: 'Hacia arriba' },
  { key: 'down', label: 'Hacia abajo' },
  { key: 'none', label: 'Sin redondeo' },
];

const ROUNDING_MULTIPLE_OPTIONS = [
  { key: 1, label: 'Unidades (1)' },
  { key: 10, label: 'Decenas (10)' },
  { key: 100, label: 'Centenas (100)' },
  { key: 1000, label: 'Miles (1000)' },
];

const PRINT_FORMAT_OPTIONS = [
  { key: 'thermal', label: 'Impresora térmica' },
  { key: 'letter', label: 'Carta (A4)' },
  { key: 'ticket', label: 'Ticket (media carta)' },
];

const PAPER_WIDTH_OPTIONS = [
  { key: 58, label: '58 mm' },
  { key: 80, label: '80 mm' },
];

const FE_AUTH_TYPE_OPTIONS = [
  { key: 'apikey', label: 'API Key (header)' },
  { key: 'bearer', label: 'Bearer token' },
  { key: 'basic', label: 'Basic auth' },
];

const FE_ENVIRONMENT_OPTIONS = [
  { key: 'habilitacion', label: 'Habilitación (pruebas)' },
  { key: 'produccion', label: 'Producción' },
];

const FE_DOCUMENT_TYPE_OPTIONS = [
  { key: 'FE', label: 'Factura Electrónica (FE)' },
  { key: 'FV', label: 'Tiquete POS (FV)' },
  { key: 'NC', label: 'Nota Crédito (NC)' },
  { key: 'ND', label: 'Nota Débito (ND)' },
];

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

function getBillingStatusTone(status, isLightTheme) {
  switch (String(status || '').trim()) {
    case 'active':
      return isLightTheme
        ? { backgroundColor: '#dcfce7', borderColor: '#86efac', color: '#166534' }
        : { backgroundColor: '#052e1a', borderColor: '#166534', color: '#86efac' };
    case 'trialing':
      return isLightTheme
        ? { backgroundColor: '#dbeafe', borderColor: '#93c5fd', color: '#1d4ed8' }
        : { backgroundColor: '#0b2245', borderColor: '#1d4ed8', color: '#93c5fd' };
    case 'past_due':
    case 'grace_period':
    case 'pending_activation':
      return isLightTheme
        ? { backgroundColor: '#fef3c7', borderColor: '#fcd34d', color: '#92400e' }
        : { backgroundColor: '#3b2a04', borderColor: '#92400e', color: '#fcd34d' };
    case 'suspended':
    case 'canceled':
    case 'expired':
      return isLightTheme
        ? { backgroundColor: '#fee2e2', borderColor: '#fca5a5', color: '#b91c1c' }
        : { backgroundColor: '#3d0c12', borderColor: '#b91c1c', color: '#fca5a5' };
    default:
      return isLightTheme
        ? { backgroundColor: '#e2e8f0', borderColor: '#cbd5e1', color: '#334155' }
        : { backgroundColor: '#0f172a', borderColor: '#334155', color: '#cbd5e1' };
  }
}

export default function TenantConfigScreen({ tenant, offlineMode, themeMode = 'dark', onLocalThemeChange }) {
  const isLightTheme = themeMode === 'light';
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [source, setSource] = useState('');
  const [error, setError] = useState('');
  const [billingError, setBillingError] = useState('');
  const [billingSource, setBillingSource] = useState('');
  const [billingSummary, setBillingSummary] = useState(null);
  const [tab, setTab] = useState('general');
  const [tenantForm, setTenantForm] = useState({});
  const [settingsForm, setSettingsForm] = useState({});
  const [feProviderForm, setFeProviderForm] = useState(getDefaultFeProviderConfig);
  const [invoiceResolutionForm, setInvoiceResolutionForm] = useState(getDefaultInvoiceResolution);

  const load = async () => {
    if (!tenant?.tenant_id) return;
    setLoading(true);
    setError('');
    setBillingError('');

    const [result, billingResult] = await Promise.all([
      getTenantConfig(tenant.tenant_id, { offlineMode }),
      getTenantBillingSummary(tenant.tenant_id, { offlineMode }),
    ]);

    if (billingResult.success) {
      setBillingSummary(billingResult.data || null);
      setBillingSource(billingResult.source || '');
    } else {
      setBillingSummary(null);
      setBillingSource('');
      setBillingError(billingResult.error || 'No fue posible cargar la suscripción.');
    }

    if (!result.success) {
      setError(result.error || 'No fue posible cargar configuración.');
      setLoading(false);
      return;
    }

    setTenantForm(result.data?.tenant || {});
    setSettingsForm(result.data?.settings || {});
    setFeProviderForm(getDefaultFeProviderConfig());
    setInvoiceResolutionForm(getDefaultInvoiceResolution());

    if (!offlineMode) {
      const [providerResult, resolutionResult] = await Promise.all([
        getProviderConfig(tenant.tenant_id),
        getActiveResolution(tenant.tenant_id, 'FE'),
      ]);

      if (providerResult.success && providerResult.data) {
        setFeProviderForm(providerResult.data);
      }
      if (resolutionResult.success && resolutionResult.data) {
        setInvoiceResolutionForm(resolutionResult.data);
      }
    }

    setSource(result.source || '');
    setLoading(false);
  };

  useEffect(() => {
    load();
  }, [tenant?.tenant_id, offlineMode]);

  const setTenantField = (key, value) => {
    setTenantForm((prev) => ({ ...prev, [key]: value }));
  };
  const setSettingsField = (key, value) => {
    setSettingsForm((prev) => ({ ...prev, [key]: value }));
  };
  const setFeProviderField = (key, value) => {
    setFeProviderForm((prev) => ({ ...prev, [key]: value }));
  };
  const setInvoiceResolutionField = (key, value) => {
    setInvoiceResolutionForm((prev) => ({ ...prev, [key]: value }));
  };

  const onSave = async () => {
    if (offlineMode) {
      setError('No puedes guardar configuración en modo offline.');
      return;
    }
    if (!String(tenantForm.name || '').trim()) {
      setError('El nombre de la empresa es obligatorio.');
      return;
    }

    setSaving(true);
    setError('');
    const result = await saveTenantConfig(tenant?.tenant_id, {
      tenant: {
        ...tenantForm,
        name: String(tenantForm.name || '').trim(),
      },
      settings: {
        ...settingsForm,
        default_page_size: Number(settingsForm.default_page_size || 20),
        session_timeout_minutes: Number(settingsForm.session_timeout_minutes || 60),
        ai_forecast_days_back: Number(settingsForm.ai_forecast_days_back || 90),
        ai_purchase_suggestion_days: Number(settingsForm.ai_purchase_suggestion_days || 14),
        expiry_alert_days: Number(settingsForm.expiry_alert_days || 30),
        max_discount_without_auth: Number(settingsForm.max_discount_without_auth || 5),
        rounding_multiple: Number(settingsForm.rounding_multiple || 100),
        cash_session_max_hours: Number(settingsForm.cash_session_max_hours || 24),
        pos_allow_manual_sale_datetime: settingsForm.pos_allow_manual_sale_datetime === true,
        pos_max_backdate_hours: Number(settingsForm.pos_max_backdate_hours || 24),
        next_invoice_number: Number(settingsForm.next_invoice_number || 1),
        thermal_paper_width: Number(settingsForm.thermal_paper_width || 80),
      },
    });

    if (!result.success) {
      setError(result.error || 'No fue posible guardar la configuración.');
      setSaving(false);
      return;
    }

    if (settingsForm.electronic_invoicing_enabled === true) {
      const providerResult = await saveProviderConfig(tenant?.tenant_id, feProviderForm);
      if (!providerResult.success) {
        setError(providerResult.error || 'No fue posible guardar la configuración del proveedor FE.');
        setSaving(false);
        return;
      }

      if (String(feProviderForm.base_url || '').trim() && (String(invoiceResolutionForm.resolution_number || '').trim() || String(invoiceResolutionForm.prefix || '').trim())) {
        const resolutionResult = await upsertResolution(tenant?.tenant_id, invoiceResolutionForm);
        if (!resolutionResult.success) {
          setError(resolutionResult.error || 'No fue posible guardar la resolución FE.');
          setSaving(false);
          return;
        }
      }
    }

    setSaving(false);
    await load();
  };

  const yesNoButton = (value, onChange) => (
    <View style={styles.segmentRow}>
      <Pressable
        style={[
          styles.segmentBtn,
          isLightTheme && styles.segmentBtnLight,
          value === true && styles.segmentBtnActive,
        ]}
        onPress={() => onChange(true)}
      >
        <Text
          style={[
            styles.segmentText,
            isLightTheme && styles.segmentTextLight,
            value === true && styles.segmentTextActive,
          ]}
        >
          Sí
        </Text>
      </Pressable>
      <Pressable
        style={[
          styles.segmentBtn,
          isLightTheme && styles.segmentBtnLight,
          value === false && styles.segmentBtnActive,
        ]}
        onPress={() => onChange(false)}
      >
        <Text
          style={[
            styles.segmentText,
            isLightTheme && styles.segmentTextLight,
            value === false && styles.segmentTextActive,
          ]}
        >
          No
        </Text>
      </Pressable>
    </View>
  );

  const selectField = ({ label, placeholder, value, options, onSelect, helper }) => (
    <View style={styles.selectBlock}>
      <SearchableSelectField
        title={label}
        themeMode={themeMode}
        valueLabel={options.find((entry) => String(entry.key) === String(value))?.label || placeholder}
        placeholder={placeholder}
        searchPlaceholder={`Buscar ${label.toLowerCase()}...`}
        options={options.map((entry) => ({
          key: entry.key,
          label: entry.label,
          searchText: `${entry.label} ${entry.key}`,
        }))}
        selectedKey={value}
        onSelect={onSelect}
        allowClear={false}
      />
      {helper ? <Text style={[styles.helperText, isLightTheme && styles.helperTextLight]}>{helper}</Text> : null}
    </View>
  );

  const textField = ({
    label,
    helper,
    multiline = false,
    style,
    ...inputProps
  }) => (
    <View style={styles.fieldBlock}>
      <Text style={[styles.fieldLabel, isLightTheme && styles.fieldLabelLight]}>{label}</Text>
      <TextInput
        {...inputProps}
        multiline={multiline}
        style={[
          styles.input,
          multiline && styles.inputMulti,
          isLightTheme && styles.inputLight,
          style,
        ]}
        placeholderTextColor="#64748b"
      />
      {helper ? <Text style={[styles.helperText, isLightTheme && styles.helperTextLight]}>{helper}</Text> : null}
    </View>
  );

  const billingStatusTone = getBillingStatusTone(billingSummary?.status, isLightTheme);

  return (
    <View style={[styles.container, isLightTheme && styles.containerLight]}>
      <View style={styles.filtersBlock}>
        <SearchableSelectField
          title="Sección"
          themeMode={themeMode}
          valueLabel={TABS.find((entry) => entry.key === tab)?.label || 'General'}
          placeholder="Seleccionar sección"
          searchPlaceholder="Buscar sección..."
          options={TABS.map((entry) => ({ key: entry.key, label: entry.label, searchText: entry.label }))}
          selectedKey={tab}
          onSelect={(nextValue) => setTab(nextValue || 'general')}
          allowClear={false}
        />
      </View>

      <ScrollView>
        <View style={[styles.card, styles.billingCard, isLightTheme && styles.cardLight]}>
          <View style={styles.billingHeader}>
            <View style={styles.billingHeaderText}>
              <Text style={[styles.sectionTitle, isLightTheme && styles.sectionTitleLight]}>Suscripción</Text>
              <Text style={[styles.helperText, isLightTheme && styles.helperTextLight]}>
                Estado comercial vigente del tenant.
              </Text>
            </View>
            {billingSummary ? (
              <View style={[styles.statusPill, { backgroundColor: billingStatusTone.backgroundColor, borderColor: billingStatusTone.borderColor }]}>
                <Text style={[styles.statusPillText, { color: billingStatusTone.color }]}>{billingSummary.status_label}</Text>
              </View>
            ) : null}
          </View>

          {billingSummary ? (
            <>
              <View style={styles.billingStatRow}>
                <Text style={[styles.fieldLabel, isLightTheme && styles.fieldLabelLight]}>Plan actual</Text>
                <Text style={[styles.billingValue, isLightTheme && styles.billingValueLight]}>
                  {billingSummary.plan_name || billingSummary.plan_code || 'Sin nombre'}
                </Text>
              </View>
              <View style={styles.billingStatRow}>
                <Text style={[styles.fieldLabel, isLightTheme && styles.fieldLabelLight]}>{getBillingExpiryLabel(billingSummary)}</Text>
                <Text style={[styles.billingValue, isLightTheme && styles.billingValueLight]}>
                  {formatBillingDate(billingSummary.expiration_date)}
                </Text>
              </View>
              {getBillingDaysHint(billingSummary.days_to_expiry) ? (
                <Text style={[styles.helperText, isLightTheme && styles.helperTextLight]}>
                  {getBillingDaysHint(billingSummary.days_to_expiry)}
                </Text>
              ) : null}
              {billingSummary.banner_message ? (
                <Text style={[styles.noticeText, isLightTheme && styles.noticeTextLight]}>{billingSummary.banner_message}</Text>
              ) : null}
            </>
          ) : (
            <Text style={[styles.helperText, isLightTheme && styles.helperTextLight]}>
              No hay una suscripción comercial registrada para este tenant todavía.
            </Text>
          )}

          {billingSource && billingSource !== 'default' ? (
            <Text style={[styles.meta, isLightTheme && styles.metaLight]}>Origen billing: {billingSource}</Text>
          ) : null}
          {billingError && !billingSummary ? <Text style={styles.error}>{billingError}</Text> : null}
        </View>

        {tab === 'general' ? (
          <View style={[styles.card, isLightTheme && styles.cardLight]}>
            <Text style={[styles.sectionTitle, isLightTheme && styles.sectionTitleLight]}>Información General</Text>
            {textField({
              label: 'Nombre de la empresa',
              value: tenantForm.name || '',
              onChangeText: (v) => setTenantField('name', v),
              placeholder: 'Ej: Comercializadora Ofir SAS',
            })}
            {textField({
              label: 'NIT / identificación fiscal',
              value: tenantForm.tax_id || '',
              onChangeText: (v) => setTenantField('tax_id', v),
              placeholder: 'Ej: 900123456-7',
            })}
            {textField({
              label: 'Moneda',
              value: tenantForm.currency_code || '',
              onChangeText: (v) => setTenantField('currency_code', v),
              placeholder: 'Ej: COP',
            })}
            {textField({
              label: 'Nombre comercial',
              value: settingsForm.business_name || '',
              onChangeText: (v) => setSettingsField('business_name', v),
              placeholder: 'Ej: OfirOne Bogotá',
            })}
            {textField({
              label: 'Teléfono',
              value: settingsForm.business_phone || '',
              onChangeText: (v) => setSettingsField('business_phone', v),
              placeholder: 'Ej: 3001234567',
            })}
            {textField({
              label: 'Dirección',
              value: settingsForm.business_address || '',
              onChangeText: (v) => setSettingsField('business_address', v),
              placeholder: 'Ej: Calle 10 # 20-30',
            })}
            {textField({
              label: 'URL del logo',
              value: settingsForm.logo_url || '',
              onChangeText: (v) => setSettingsField('logo_url', v),
              placeholder: 'https://...',
            })}
            {textField({
              label: 'Pie de recibo',
              value: settingsForm.receipt_footer || '',
              onChangeText: (v) => setSettingsField('receipt_footer', v),
              placeholder: 'Texto final del recibo o factura',
              multiline: true,
            })}
            <Text style={[styles.inlineLabel, isLightTheme && styles.inlineLabelLight]}>Impuesto incluido por defecto</Text>
            {yesNoButton(Boolean(settingsForm.default_tax_included), (v) => setSettingsField('default_tax_included', v))}
          </View>
        ) : null}

        {tab === 'ui' ? (
          <View style={[styles.card, isLightTheme && styles.cardLight]}>
            <Text style={[styles.sectionTitle, isLightTheme && styles.sectionTitleLight]}>Interfaz</Text>
            {textField({
              label: 'Registros por página',
              value: String(settingsForm.default_page_size ?? ''),
              onChangeText: (v) => setSettingsField('default_page_size', v),
              placeholder: 'Ej: 20',
              keyboardType: 'numeric',
            })}
            {textField({
              label: 'Tema configurado',
              value: settingsForm.theme || '',
              onChangeText: (v) => setSettingsField('theme', v),
              placeholder: 'light / dark / auto',
            })}
            <Text style={[styles.inlineLabel, isLightTheme && styles.inlineLabelLight]}>Tema activo cache/local</Text>
            <View style={styles.segmentRow}>
              <Pressable
                style={[styles.segmentBtn, isLightTheme && styles.segmentBtnLight, (themeMode === 'light') && styles.segmentBtnActive]}
                onPress={async () => {
                  setSettingsField('theme', 'light');
                  if (onLocalThemeChange) await onLocalThemeChange('light');
                }}
              >
                <Text style={[styles.segmentText, isLightTheme && styles.segmentTextLight, (themeMode === 'light') && styles.segmentTextActive]}>Claro</Text>
              </Pressable>
              <Pressable
                style={[styles.segmentBtn, isLightTheme && styles.segmentBtnLight, (themeMode !== 'light') && styles.segmentBtnActive]}
                onPress={async () => {
                  setSettingsField('theme', 'dark');
                  if (onLocalThemeChange) await onLocalThemeChange('dark');
                }}
              >
                <Text style={[styles.segmentText, isLightTheme && styles.segmentTextLight, (themeMode !== 'light') && styles.segmentTextActive]}>Oscuro</Text>
              </Pressable>
              <Pressable
                style={[styles.segmentBtn, isLightTheme && styles.segmentBtnLight, (settingsForm.theme === 'auto') && styles.segmentBtnActive]}
                onPress={async () => {
                  setSettingsField('theme', 'auto');
                  if (onLocalThemeChange) await onLocalThemeChange('auto');
                }}
              >
                <Text style={[styles.segmentText, isLightTheme && styles.segmentTextLight, (settingsForm.theme === 'auto') && styles.segmentTextActive]}>Auto</Text>
              </Pressable>
            </View>
            {textField({
              label: 'Formato de fecha',
              value: settingsForm.date_format || '',
              onChangeText: (v) => setSettingsField('date_format', v),
              placeholder: 'Ej: DD/MM/YYYY',
            })}
            {textField({
              label: 'Idioma / región',
              value: settingsForm.locale || '',
              onChangeText: (v) => setSettingsField('locale', v),
              placeholder: 'Ej: es-CO',
            })}
            {textField({
              label: 'Tiempo de sesión (minutos)',
              value: String(settingsForm.session_timeout_minutes ?? ''),
              onChangeText: (v) => setSettingsField('session_timeout_minutes', v),
              placeholder: 'Ej: 60',
              keyboardType: 'numeric',
            })}
          </View>
        ) : null}

        {tab === 'ai' ? (
          <View style={[styles.card, isLightTheme && styles.cardLight]}>
            <Text style={[styles.sectionTitle, isLightTheme && styles.sectionTitleLight]}>Inteligencia IA</Text>
            {textField({
              label: 'Días de historial para pronóstico',
              value: String(settingsForm.ai_forecast_days_back ?? ''),
              onChangeText: (v) => setSettingsField('ai_forecast_days_back', v),
              placeholder: 'Ej: 90',
              keyboardType: 'numeric',
            })}
            {textField({
              label: 'Días de proyección de compras',
              value: String(settingsForm.ai_purchase_suggestion_days ?? ''),
              onChangeText: (v) => setSettingsField('ai_purchase_suggestion_days', v),
              placeholder: 'Ej: 14',
              keyboardType: 'numeric',
            })}
            <Text style={[styles.inlineLabel, isLightTheme && styles.inlineLabelLight]}>Asesor de compras con IA</Text>
            {yesNoButton(Boolean(settingsForm.ai_purchase_advisor_enabled), (v) => setSettingsField('ai_purchase_advisor_enabled', v))}
            <Text style={[styles.inlineLabel, isLightTheme && styles.inlineLabelLight]}>Pronóstico de ventas con IA</Text>
            {yesNoButton(Boolean(settingsForm.ai_sales_forecast_enabled), (v) => setSettingsField('ai_sales_forecast_enabled', v))}
            <Text style={[styles.helperText, isLightTheme && styles.helperTextLight]}>
              La administración de caché IA avanzada sigue concentrada en web. Aquí solo dejamos el control base del comportamiento del tenant.
            </Text>
          </View>
        ) : null}

        {tab === 'accounting' ? (
          <View style={[styles.card, isLightTheme && styles.cardLight]}>
            <Text style={[styles.sectionTitle, isLightTheme && styles.sectionTitleLight]}>Contabilidad</Text>
            <Text style={[styles.noticeText, isLightTheme && styles.noticeTextLight]}>
              Estos parámetros se guardan para el tenant, pero la operación contable mobile sigue desactivada por ahora.
            </Text>
            <Text style={[styles.inlineLabel, isLightTheme && styles.inlineLabelLight]}>Contabilidad habilitada</Text>
            {yesNoButton(Boolean(settingsForm.accounting_enabled), (v) => setSettingsField('accounting_enabled', v))}
            {selectField({
              label: 'Modo de integración contable',
              placeholder: 'Seleccionar modo',
              value: settingsForm.accounting_mode || 'ASYNC',
              options: ACCOUNTING_MODE_OPTIONS,
              onSelect: (nextValue) => setSettingsField('accounting_mode', nextValue || 'ASYNC'),
              helper: 'Se guarda como configuración del tenant, sin activar todavía la operación contable en mobile.',
            })}
            <Text style={[styles.inlineLabel, isLightTheme && styles.inlineLabelLight]}>IA contable</Text>
            {yesNoButton(Boolean(settingsForm.accounting_ai_enabled), (v) => setSettingsField('accounting_ai_enabled', v))}
            <Text style={[styles.inlineLabel, isLightTheme && styles.inlineLabelLight]}>Auto contabilizar ventas</Text>
            {yesNoButton(Boolean(settingsForm.accounting_auto_post_sales), (v) => setSettingsField('accounting_auto_post_sales', v))}
            <Text style={[styles.inlineLabel, isLightTheme && styles.inlineLabelLight]}>Auto contabilizar compras</Text>
            {yesNoButton(Boolean(settingsForm.accounting_auto_post_purchases), (v) => setSettingsField('accounting_auto_post_purchases', v))}
            {textField({
              label: 'País contable',
              value: settingsForm.accounting_country_code || '',
              onChangeText: (v) => setSettingsField('accounting_country_code', v),
              placeholder: 'Ej: CO',
              autoCapitalize: 'characters',
            })}
          </View>
        ) : null}

        {tab === 'inventory' ? (
          <View style={[styles.card, isLightTheme && styles.cardLight]}>
            <Text style={[styles.sectionTitle, isLightTheme && styles.sectionTitleLight]}>Inventario</Text>
            {textField({
              label: 'Días de alerta por vencimiento',
              value: String(settingsForm.expiry_alert_days ?? ''),
              onChangeText: (v) => setSettingsField('expiry_alert_days', v),
              placeholder: 'Ej: 30',
              keyboardType: 'numeric',
            })}
            <Text style={[styles.inlineLabel, isLightTheme && styles.inlineLabelLight]}>Reservar stock en plan separe</Text>
            {yesNoButton(Boolean(settingsForm.reserve_stock_on_layaway), (v) => setSettingsField('reserve_stock_on_layaway', v))}
          </View>
        ) : null}

        {tab === 'sales' ? (
          <View style={[styles.card, isLightTheme && styles.cardLight]}>
            <Text style={[styles.sectionTitle, isLightTheme && styles.sectionTitleLight]}>Ventas y Precios</Text>
            <Text style={[styles.noticeText, isLightTheme && styles.noticeTextLight]}>
              Nota: descuentos y retrofecha de venta en POS deben restringirse a personal de confianza.
            </Text>
            {textField({
              label: 'Descuento máximo cajero (%)',
              value: String(settingsForm.max_discount_without_auth ?? ''),
              onChangeText: (v) => setSettingsField('max_discount_without_auth', v),
              placeholder: 'Ej: 15',
              keyboardType: 'numeric',
            })}
            {selectField({
              label: 'Método de redondeo',
              placeholder: 'Seleccionar método',
              value: settingsForm.rounding_method || 'normal',
              options: ROUNDING_METHOD_OPTIONS,
              onSelect: (nextValue) => setSettingsField('rounding_method', nextValue || 'normal'),
              helper: 'Cómo redondear totales de ventas.',
            })}
            {selectField({
              label: 'Múltiplo de redondeo',
              placeholder: 'Seleccionar múltiplo',
              value: Number(settingsForm.rounding_multiple || 100),
              options: ROUNDING_MULTIPLE_OPTIONS,
              onSelect: (nextValue) => setSettingsField('rounding_multiple', Number(nextValue || 100)),
              helper: 'A qué múltiplo redondear.',
            })}
            {textField({
              label: 'Máximo de horas de sesión de caja',
              value: String(settingsForm.cash_session_max_hours ?? ''),
              onChangeText: (v) => setSettingsField('cash_session_max_hours', v),
              placeholder: 'Ej: 24',
              keyboardType: 'numeric',
            })}
            <Text style={[styles.inlineLabel, isLightTheme && styles.inlineLabelLight]}>Permitir fecha manual en POS</Text>
            {yesNoButton(Boolean(settingsForm.pos_allow_manual_sale_datetime), (v) => setSettingsField('pos_allow_manual_sale_datetime', v))}
            {settingsForm.pos_allow_manual_sale_datetime ? (
              textField({
                label: 'Máximo de retrofecha POS (horas)',
                value: String(settingsForm.pos_max_backdate_hours ?? ''),
                onChangeText: (v) => setSettingsField('pos_max_backdate_hours', v),
                placeholder: 'Ej: 24',
                keyboardType: 'numeric',
              })
            ) : null}
            <Text style={[styles.helperText, isLightTheme && styles.helperTextLight]}>
              Solo administradores y gerentes podrán cambiar la fecha/hora de la venta. La retrofecha no puede exceder el límite configurado ni quedar antes de la apertura de caja.
            </Text>
          </View>
        ) : null}

        {tab === 'invoicing' ? (
          <View style={[styles.card, isLightTheme && styles.cardLight]}>
            <Text style={[styles.sectionTitle, isLightTheme && styles.sectionTitleLight]}>Facturación</Text>
            {textField({
              label: 'Prefijo de factura',
              value: settingsForm.invoice_prefix || '',
              onChangeText: (v) => setSettingsField('invoice_prefix', v),
              placeholder: 'Ej: FAC',
            })}
            {textField({
              label: 'Siguiente número de factura',
              value: String(settingsForm.next_invoice_number ?? ''),
              onChangeText: (v) => setSettingsField('next_invoice_number', v),
              placeholder: 'Ej: 1',
              keyboardType: 'numeric',
            })}
            {selectField({
              label: 'Formato de impresión',
              placeholder: 'Seleccionar formato',
              value: settingsForm.print_format || 'thermal',
              options: PRINT_FORMAT_OPTIONS,
              onSelect: (nextValue) => setSettingsField('print_format', nextValue || 'thermal'),
              helper: 'Tipo de impresora o salida POS.',
            })}
            {selectField({
              label: 'Ancho papel térmico',
              placeholder: 'Seleccionar ancho',
              value: Number(settingsForm.thermal_paper_width || 80),
              options: PAPER_WIDTH_OPTIONS,
              onSelect: (nextValue) => setSettingsField('thermal_paper_width', Number(nextValue || 80)),
              helper: 'Ancho del rollo para impresión térmica.',
            })}
            <Text style={[styles.inlineLabel, isLightTheme && styles.inlineLabelLight]}>Facturación electrónica habilitada</Text>
            {yesNoButton(Boolean(settingsForm.electronic_invoicing_enabled), (v) => setSettingsField('electronic_invoicing_enabled', v))}

            <Text style={[styles.sectionTitle, isLightTheme && styles.sectionTitleLight]}>Datos Fiscales Emisor</Text>
            {textField({
              label: 'DV',
              value: tenantForm.dv || '',
              onChangeText: (v) => setTenantField('dv', v),
              placeholder: 'Dígito de verificación',
            })}
            {textField({
              label: 'Nombre comercial',
              value: tenantForm.trade_name || '',
              onChangeText: (v) => setTenantField('trade_name', v),
              placeholder: 'Nombre comercial del emisor',
            })}
            {textField({
              label: 'Régimen DIAN',
              value: tenantForm.tax_regime || '',
              onChangeText: (v) => setTenantField('tax_regime', v),
              placeholder: 'Ej: 48, 49, O-13, ZZ',
            })}
            {textField({
              label: 'Código CIIU',
              value: tenantForm.ciiu_code || '',
              onChangeText: (v) => setTenantField('ciiu_code', v),
              placeholder: 'Actividad económica',
            })}
            {textField({
              label: 'Email fiscal',
              value: tenantForm.fiscal_email || '',
              onChangeText: (v) => setTenantField('fiscal_email', v),
              placeholder: 'correo@empresa.com',
              autoCapitalize: 'none',
            })}
            {textField({
              label: 'Teléfono fiscal',
              value: tenantForm.fiscal_phone || '',
              onChangeText: (v) => setTenantField('fiscal_phone', v),
              placeholder: 'Ej: 3001234567',
            })}
            <Text style={[styles.inlineLabel, isLightTheme && styles.inlineLabelLight]}>Responsable IVA</Text>
            {yesNoButton(Boolean(tenantForm.is_responsible_for_iva), (v) => setTenantField('is_responsible_for_iva', v))}
            <Text style={[styles.inlineLabel, isLightTheme && styles.inlineLabelLight]}>Obligado a contabilidad</Text>
            {yesNoButton(Boolean(tenantForm.obligated_accounting), (v) => setTenantField('obligated_accounting', v))}
            {textField({
              label: 'Dirección fiscal',
              value: tenantForm.address || '',
              onChangeText: (v) => setTenantField('address', v),
              placeholder: 'Ej: Calle 68 # 95-30',
            })}
            {textField({
              label: 'Ciudad',
              value: tenantForm.city || '',
              onChangeText: (v) => setTenantField('city', v),
              placeholder: 'Ej: Bogotá',
            })}
            {textField({
              label: 'Departamento',
              value: tenantForm.department || '',
              onChangeText: (v) => setTenantField('department', v),
              placeholder: 'Ej: Cundinamarca',
            })}
            {textField({
              label: 'País',
              value: tenantForm.country_code || '',
              onChangeText: (v) => setTenantField('country_code', v),
              placeholder: 'Ej: CO',
              autoCapitalize: 'characters',
            })}
            {textField({
              label: 'Código postal',
              value: tenantForm.postal_code || '',
              onChangeText: (v) => setTenantField('postal_code', v),
              placeholder: 'Código postal',
            })}
            {textField({
              label: 'Código DANE ciudad',
              value: tenantForm.city_code || '',
              onChangeText: (v) => setTenantField('city_code', v),
              placeholder: 'Ej: 11001',
            })}

            <Text style={[styles.sectionTitle, isLightTheme && styles.sectionTitleLight]}>Proveedor Tecnológico FE</Text>
            <Text style={[styles.noticeText, isLightTheme && styles.noticeTextLight]}>
              Esta configuración queda guardada para web/backend. La operación avanzada de FE todavía no se activa desde mobile.
            </Text>
            {textField({
              label: 'Nombre del proveedor',
              value: feProviderForm.provider_name || '',
              onChangeText: (v) => setFeProviderField('provider_name', v),
              placeholder: 'Ej: Gosocket',
            })}
            {textField({
              label: 'URL base API',
              value: feProviderForm.base_url || '',
              onChangeText: (v) => setFeProviderField('base_url', v),
              placeholder: 'https://api.proveedor.co/v1',
              autoCapitalize: 'none',
            })}
            {selectField({
              label: 'Tipo de autenticación FE',
              placeholder: 'Seleccionar autenticación',
              value: feProviderForm.auth_type || 'apikey',
              options: FE_AUTH_TYPE_OPTIONS,
              onSelect: (nextValue) => setFeProviderField('auth_type', nextValue || 'apikey'),
            })}
            {feProviderForm.auth_type === 'apikey' ? (
              textField({
                label: 'Header de autenticación',
                value: feProviderForm.auth_header || '',
                onChangeText: (v) => setFeProviderField('auth_header', v),
                placeholder: 'Ej: X-API-Key',
                autoCapitalize: 'none',
              })
            ) : null}
            {textField({
              label: feProviderForm.auth_type === 'basic' ? 'Usuario:Contraseña' : 'API Key / Token',
              value: feProviderForm.api_key || '',
              onChangeText: (v) => setFeProviderField('api_key', v),
              placeholder: feProviderForm.auth_type === 'basic' ? 'usuario:clave' : 'Credencial del proveedor',
              secureTextEntry: true,
            })}
            {textField({
              label: 'Software ID (DIAN)',
              value: feProviderForm.software_id || '',
              onChangeText: (v) => setFeProviderField('software_id', v),
              placeholder: 'ID del software',
            })}
            {textField({
              label: 'Software PIN (DIAN)',
              value: feProviderForm.software_pin || '',
              onChangeText: (v) => setFeProviderField('software_pin', v),
              placeholder: 'PIN del software',
              secureTextEntry: true,
            })}
            {selectField({
              label: 'Ambiente FE',
              placeholder: 'Seleccionar ambiente',
              value: feProviderForm.environment || 'habilitacion',
              options: FE_ENVIRONMENT_OPTIONS,
              onSelect: (nextValue) => setFeProviderField('environment', nextValue || 'habilitacion'),
            })}
            {feProviderForm.environment === 'habilitacion' ? (
              textField({
                label: 'Test Set ID',
                value: feProviderForm.test_set_id || '',
                onChangeText: (v) => setFeProviderField('test_set_id', v),
                placeholder: 'Identificador de pruebas DIAN',
              })
            ) : null}
            {textField({
              label: 'Timeout (segundos)',
              value: String(feProviderForm.timeout_seconds ?? ''),
              onChangeText: (v) => setFeProviderField('timeout_seconds', v),
              placeholder: 'Ej: 30',
              keyboardType: 'numeric',
            })}

            <Text style={[styles.sectionTitle, isLightTheme && styles.sectionTitleLight]}>Resolución DIAN Activa</Text>
            {selectField({
              label: 'Tipo de documento FE',
              placeholder: 'Seleccionar documento',
              value: invoiceResolutionForm.document_type || 'FE',
              options: FE_DOCUMENT_TYPE_OPTIONS,
              onSelect: (nextValue) => setInvoiceResolutionField('document_type', nextValue || 'FE'),
            })}
            {textField({
              label: 'Prefijo autorizado',
              value: invoiceResolutionForm.prefix || '',
              onChangeText: (v) => setInvoiceResolutionField('prefix', v),
              placeholder: 'Ej: FE',
            })}
            {textField({
              label: 'Desde #',
              value: String(invoiceResolutionForm.from_number ?? ''),
              onChangeText: (v) => setInvoiceResolutionField('from_number', v),
              placeholder: 'Ej: 1',
              keyboardType: 'numeric',
            })}
            {textField({
              label: 'Hasta #',
              value: String(invoiceResolutionForm.to_number ?? ''),
              onChangeText: (v) => setInvoiceResolutionField('to_number', v),
              placeholder: 'Ej: 1000',
              keyboardType: 'numeric',
            })}
            {textField({
              label: 'Último consecutivo usado',
              value: String(invoiceResolutionForm.current_number ?? ''),
              onChangeText: (v) => setInvoiceResolutionField('current_number', v),
              placeholder: 'Ej: 0',
              keyboardType: 'numeric',
            })}
            {textField({
              label: 'Número de resolución DIAN',
              value: invoiceResolutionForm.resolution_number || '',
              onChangeText: (v) => setInvoiceResolutionField('resolution_number', v),
              placeholder: 'Número oficial',
            })}
            {textField({
              label: 'Fecha de resolución',
              value: invoiceResolutionForm.resolution_date || '',
              onChangeText: (v) => setInvoiceResolutionField('resolution_date', v),
              placeholder: 'YYYY-MM-DD',
              autoCapitalize: 'none',
            })}
            {textField({
              label: 'Vigencia desde',
              value: invoiceResolutionForm.valid_from || '',
              onChangeText: (v) => setInvoiceResolutionField('valid_from', v),
              placeholder: 'YYYY-MM-DD',
              autoCapitalize: 'none',
            })}
            {textField({
              label: 'Vigencia hasta',
              value: invoiceResolutionForm.valid_to || '',
              onChangeText: (v) => setInvoiceResolutionField('valid_to', v),
              placeholder: 'YYYY-MM-DD',
              autoCapitalize: 'none',
            })}
            {textField({
              label: 'Clave técnica DIAN',
              value: invoiceResolutionForm.technical_key || '',
              onChangeText: (v) => setInvoiceResolutionField('technical_key', v),
              placeholder: 'Clave técnica entregada por DIAN',
              multiline: true,
            })}
          </View>
        ) : null}

        {tab === 'notifications' ? (
          <View style={[styles.card, isLightTheme && styles.cardLight]}>
            <Text style={[styles.sectionTitle, isLightTheme && styles.sectionTitleLight]}>Notificaciones</Text>
            <Text style={[styles.inlineLabel, isLightTheme && styles.inlineLabelLight]}>Alertas por email</Text>
            {yesNoButton(Boolean(settingsForm.email_alerts_enabled), (v) => setSettingsField('email_alerts_enabled', v))}
            {textField({
              label: 'Email para alertas',
              value: settingsForm.alert_email || '',
              onChangeText: (v) => setSettingsField('alert_email', v),
              placeholder: 'correo@empresa.com',
              autoCapitalize: 'none',
            })}
            <Text style={[styles.inlineLabel, isLightTheme && styles.inlineLabelLight]}>Notificar stock bajo</Text>
            {yesNoButton(Boolean(settingsForm.notify_low_stock), (v) => setSettingsField('notify_low_stock', v))}
            <Text style={[styles.inlineLabel, isLightTheme && styles.inlineLabelLight]}>Notificar productos por vencer</Text>
            {yesNoButton(Boolean(settingsForm.notify_expiring_products), (v) => setSettingsField('notify_expiring_products', v))}
          </View>
        ) : null}
      </ScrollView>

      {source ? <Text style={[styles.meta, isLightTheme && styles.metaLight]}>Origen: {source}</Text> : null}
      {loading ? <Text style={[styles.meta, isLightTheme && styles.metaLight]}>Cargando...</Text> : null}
      {error ? <Text style={styles.error}>{error}</Text> : null}

      <Pressable style={[styles.primaryBtn, isLightTheme && styles.primaryBtnLight]} onPress={onSave} disabled={saving || loading}>
        <Text style={styles.primaryBtnText}>{saving ? 'Guardando...' : 'Guardar configuración'}</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#060b16', padding: 12 },
  containerLight: { backgroundColor: '#edf2fb' },
  filtersBlock: { marginBottom: 8 },
  selectBlock: { marginTop: 8 },
  fieldBlock: { marginTop: 8 },
  filtersScroll: { maxHeight: 44, marginBottom: 8 },
  chipsRow: { flexDirection: 'row', gap: 6 },
  filterChip: {
    borderWidth: 1,
    borderColor: '#334155',
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 6,
    backgroundColor: '#0b1220',
  },
  filterChipActive: { borderColor: '#235ea9', backgroundColor: '#235ea9' },
  filterChipText: { color: '#cbd5e1', fontSize: 12, fontWeight: '600' },
  filterChipLight: { borderColor: '#cbd5e1', backgroundColor: '#ffffff' },
  filterChipTextLight: { color: '#334155' },
  filterChipTextActive: { color: '#eff6ff' },
  card: {
    borderWidth: 1,
    borderColor: '#1f2937',
    borderRadius: 12,
    backgroundColor: '#111827',
    padding: 12,
    marginBottom: 8,
  },
  cardLight: {
    borderColor: '#dbe4ef',
    backgroundColor: '#ffffff',
  },
  billingCard: {
    marginBottom: 8,
  },
  billingHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: 10,
    marginBottom: 8,
  },
  billingHeaderText: {
    flex: 1,
  },
  billingStatRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 12,
    marginTop: 6,
  },
  billingValue: {
    flex: 1,
    color: '#f8fafc',
    fontSize: 13,
    fontWeight: '700',
    textAlign: 'right',
  },
  billingValueLight: {
    color: '#0f172a',
  },
  statusPill: {
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  statusPillText: {
    fontSize: 12,
    fontWeight: '700',
  },
  sectionTitle: { color: '#f8fafc', fontSize: 15, fontWeight: '700', marginBottom: 6, marginTop: 4 },
  sectionTitleLight: { color: '#0f172a' },
  fieldLabel: { color: '#e2e8f0', fontSize: 12, fontWeight: '700', marginBottom: 4 },
  fieldLabelLight: { color: '#334155' },
  inlineLabel: { color: '#cbd5e1', fontSize: 12, marginTop: 8, marginBottom: 4 },
  inlineLabelLight: { color: '#475569' },
  helperText: { color: '#94a3b8', fontSize: 12, lineHeight: 18, marginTop: 2 },
  helperTextLight: { color: '#64748b' },
  noticeText: {
    color: '#93c5fd',
    fontSize: 12,
    lineHeight: 18,
    marginTop: 2,
    marginBottom: 6,
  },
  noticeTextLight: {
    color: '#235ea9',
  },
  input: {
    minHeight: 42,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#334155',
    paddingHorizontal: 10,
    color: '#f8fafc',
    marginTop: 8,
    backgroundColor: '#0f172a',
  },
  inputLight: {
    borderColor: '#cbd5e1',
    color: '#0f172a',
    backgroundColor: '#ffffff',
  },
  inputMulti: { minHeight: 84, textAlignVertical: 'top', paddingTop: 10 },
  segmentRow: { flexDirection: 'row', gap: 8 },
  segmentBtn: {
    flex: 1,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#334155',
    backgroundColor: '#111827',
    paddingVertical: 8,
    alignItems: 'center',
  },
  segmentBtnLight: {
    borderColor: '#cbd5e1',
    backgroundColor: '#ffffff',
  },
  segmentBtnActive: { borderColor: '#235ea9', backgroundColor: '#235ea9' },
  segmentText: { color: '#cbd5e1', fontWeight: '700', fontSize: 12 },
  segmentTextLight: { color: '#334155' },
  segmentTextActive: { color: '#eff6ff' },
  meta: { color: '#94a3b8', marginTop: 8, fontSize: 12 },
  metaLight: { color: '#475569' },
  error: { color: '#f87171', marginTop: 8, fontSize: 13 },
  primaryBtn: {
    backgroundColor: '#57d65a',
    borderRadius: 10,
    paddingVertical: 11,
    alignItems: 'center',
  },
  primaryBtnLight: { backgroundColor: '#57d65a' },
  primaryBtnText: { color: '#062915', fontWeight: '700' },
});
