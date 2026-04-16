import { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import ListHeaderActionButton from '../components/ListHeaderActionButton';
import PaginatedList from '../components/PaginatedList';
import SearchableSelectField from '../components/SearchableSelectField';
import { usePaginatedList } from '../hooks/usePaginatedList';
import {
  getCashSessionAgeHours,
  isCashSessionExpired,
  resolveCashSessionMaxHours,
  validateCashSessionForOperation,
} from '../lib/cashSession';
import { useAndroidBottomInset } from '../lib/useAndroidBottomInset';
import { useThemeMode } from '../lib/themeMode';
import {
  addLayawayPayment,
  cancelLayaway,
  completeLayaway,
  createLayaway,
  getLayawayContracts,
  getLayawayDetail,
} from '../services/layaway.service';
import {
  getCurrentUserOpenSession,
  getPaymentMethodsForDropdown,
  getTaxInfoForVariant,
  searchCustomers,
  searchVariants,
} from '../services/pos.service';
import { listLocationsConfig } from '../services/setup.service';
import {
  LAYAWAY_STATUS,
  calculateLayawayDraftLine,
  createLayawayInstallmentDraft,
  getLayawayDueState,
  getLayawayStatusLabel,
  sanitizeLayawayInstallments,
  summarizeLayawayDraftItems,
  summarizeLayawayInstallments,
} from '../../../shared/utils/layawayContract';

const STATUS_FILTERS = ['', LAYAWAY_STATUS.ACTIVE, LAYAWAY_STATUS.COMPLETED, LAYAWAY_STATUS.CANCELLED, LAYAWAY_STATUS.EXPIRED];
const STATUS_FILTER_LABELS = {
  [LAYAWAY_STATUS.ACTIVE]: 'Activos',
  [LAYAWAY_STATUS.COMPLETED]: 'Completados',
  [LAYAWAY_STATUS.CANCELLED]: 'Cancelados',
  [LAYAWAY_STATUS.EXPIRED]: 'Vencidos',
};
const STATUS_FILTER_OPTIONS = STATUS_FILTERS.filter(Boolean).map((value) => ({
  key: value,
  label: STATUS_FILTER_LABELS[value] || value,
}));

function formatDateLabel(value) {
  if (!value) return 'Sin fecha';
  const raw = String(value);
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    const [year, month, day] = raw.split('-');
    return `${day}/${month}/${year}`;
  }
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return raw;
  return parsed.toLocaleDateString();
}

function normalizeAmountInput(value) {
  const normalized = String(value ?? '').replace(/\s+/g, '').replace(',', '.');
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : 0;
}

function buildCustomerOption(customer) {
  return {
    key: customer.customer_id,
    label: customer.full_name || 'Cliente sin nombre',
    searchText: `${customer.full_name || ''} ${customer.document || ''} ${customer.phone || ''}`.trim(),
    raw: customer,
  };
}

function buildLocationOption(location) {
  return {
    key: location.location_id,
    label: location.name || 'Sede sin nombre',
    searchText: `${location.name || ''} ${location.address || ''}`.trim(),
    raw: location,
  };
}

function buildPaymentMethodOption(method) {
  return {
    key: method.code,
    label: method.name || method.code || 'Metodo',
    searchText: `${method.name || ''} ${method.code || ''}`.trim(),
    raw: method,
  };
}

function buildVariantOption(variant) {
  const available = Number.isFinite(Number(variant.stock_available))
    ? Number(variant.stock_available)
    : Number(variant._stock || 0);

  return {
    key: variant.variant_id,
    label: `${variant.product?.name || ''}${variant.variant_name ? ` - ${variant.variant_name}` : ''} (${variant.sku || 'SIN SKU'})`,
    searchText: `${variant.product?.name || ''} ${variant.variant_name || ''} ${variant.sku || ''}`.trim(),
    raw: {
      ...variant,
      stock_available: available,
    },
  };
}

function createDraftLineFromVariant(variant, taxResult) {
  return calculateLayawayDraftLine({
    line_id: `layaway-line-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
    variant_id: variant.variant_id,
    sku: variant.sku,
    product_name: variant.product?.name || '',
    variant_name: variant.variant_name || '',
    stock_available: Number(variant.stock_available || 0),
    qty: 1,
    unit_price: Number(variant.price || 0),
    price_includes_tax: Boolean(variant.price_includes_tax),
    discount: 0,
    discount_type: 'AMOUNT',
  }, taxResult);
}

function createLayawayForm(defaultLocationId = '', defaultPaymentMethodCode = '') {
  return {
    customer_id: '',
    location_id: defaultLocationId || '',
    due_date: '',
    note: '',
    items: [],
    initial_payment: {
      payment_method_code: defaultPaymentMethodCode || '',
      amount: '',
      reference: '',
    },
    installments: [],
  };
}

export default function LayawayScreen({
  tenant,
  userProfile,
  tenantSettings,
  formatMoney,
  offlineMode,
  pageSize = 20,
}) {
  const themeMode = useThemeMode();
  const isLightTheme = themeMode === 'light';
  const androidBottomInset = useAndroidBottomInset();
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [detail, setDetail] = useState(null);
  const [payAmount, setPayAmount] = useState('');
  const [payMethodCode, setPayMethodCode] = useState('CASH');
  const [payRef, setPayRef] = useState('');
  const [paymentMethods, setPaymentMethods] = useState([]);
  const [locationOptions, setLocationOptions] = useState([]);
  const [customerOptions, setCustomerOptions] = useState([]);
  const [variantOptions, setVariantOptions] = useState([]);
  const [currentSession, setCurrentSession] = useState(null);
  const [busyAction, setBusyAction] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState('');
  const [searchingCustomers, setSearchingCustomers] = useState(false);
  const [searchingVariants, setSearchingVariants] = useState(false);
  const [createForm, setCreateForm] = useState(() => createLayawayForm());
  const cashSessionMaxHours = resolveCashSessionMaxHours(tenantSettings, 24);
  const sessionAgeHours = getCashSessionAgeHours(currentSession);
  const sessionExpired = isCashSessionExpired(currentSession, cashSessionMaxHours);

  const {
    items: contracts,
    page,
    totalPages,
    loading,
    error,
    cacheInfo,
    refreshing,
    reload,
    setError,
    filters,
    updateFilters,
    changePage,
    loadPage,
  } = usePaginatedList({
    tenantId: tenant?.tenant_id,
    pageSize,
    offlineMode,
    cacheNamespace: 'layaway-contracts',
    initialFilters: { status: '' },
    fetchPage: async ({ tenantId, page: nextPage, pageSize: nextPageSize, filters: nextFilters }) =>
      getLayawayContracts(tenantId, nextPage, nextPageSize, nextFilters?.status || null),
  });

  const paymentMethodOptions = useMemo(
    () => paymentMethods.map(buildPaymentMethodOption),
    [paymentMethods],
  );
  const contractTotals = useMemo(
    () => summarizeLayawayDraftItems(createForm.items),
    [createForm.items],
  );
  const installmentsSummary = useMemo(
    () => summarizeLayawayInstallments(createForm.installments),
    [createForm.installments],
  );
  const initialPaymentAmount = normalizeAmountInput(createForm.initial_payment.amount);
  const selectedLocationOption = useMemo(
    () => locationOptions.find((item) => String(item.key) === String(createForm.location_id)) || null,
    [createForm.location_id, locationOptions],
  );

  const mergeOptions = (previousOptions, newOptions) => {
    const merged = new Map();
    [...previousOptions, ...newOptions].forEach((item) => {
      if (!item?.key) return;
      merged.set(String(item.key), item);
    });
    return Array.from(merged.values());
  };

  const resetCreateForm = (overrideLocationId = '', overridePaymentMethodCode = '') => {
    setCreateError('');
    setCustomerOptions([]);
    setVariantOptions([]);
    setCreateForm(createLayawayForm(
      overrideLocationId || locationOptions[0]?.key || '',
      overridePaymentMethodCode || paymentMethodOptions[0]?.key || '',
    ));
  };

  const openDetail = async (layawayId) => {
    setLoadingDetail(true);
    const result = await getLayawayDetail(tenant?.tenant_id, layawayId);
    if (!result.success) {
      setError(result.error || 'No fue posible cargar detalle');
      setLoadingDetail(false);
      return;
    }
    setDetail(result.data);
    setLoadingDetail(false);
  };

  useEffect(() => {
    let active = true;

    const loadCatalogs = async () => {
      if (!tenant?.tenant_id || !userProfile?.user_id) return;

      const [methodsResult, sessionResult, locationsResult] = await Promise.all([
        getPaymentMethodsForDropdown(tenant.tenant_id, { offlineMode }),
        getCurrentUserOpenSession(tenant.tenant_id, userProfile.user_id, { offlineMode }),
        listLocationsConfig({ tenantId: tenant.tenant_id, limit: 100 }),
      ]);

      if (!active) return;

      if (methodsResult.success) {
        const list = Array.isArray(methodsResult.data) ? methodsResult.data : [];
        setPaymentMethods(list);
        if (!createForm.initial_payment.payment_method_code) {
          setCreateForm((prev) => ({
            ...prev,
            initial_payment: {
              ...prev.initial_payment,
              payment_method_code: list[0]?.code || '',
            },
          }));
        }
        const currentExists = list.some((item) => item.code === payMethodCode);
        if (!currentExists) {
          setPayMethodCode(list[0]?.code || 'CASH');
        }
      }

      if (sessionResult.success) {
        setCurrentSession(sessionResult.data || null);
      }

      if (locationsResult.success) {
        const options = (locationsResult.data || []).map(buildLocationOption);
        setLocationOptions(options);
        setCreateForm((prev) => ({
          ...prev,
          location_id: prev.location_id || options[0]?.key || '',
        }));
      }
    };

    loadCatalogs();

    return () => {
      active = false;
    };
  }, [tenant?.tenant_id, userProfile?.user_id, offlineMode]);

  useEffect(() => {
    if (!createOpen) return;
    setCreateError('');
  }, [createOpen]);

  const refreshDetail = async () => {
    if (!detail?.layaway_id) return;
    const refreshed = await getLayawayDetail(tenant?.tenant_id, detail.layaway_id);
    if (refreshed.success) setDetail(refreshed.data);
  };

  const loadCustomerOptions = async (query) => {
    if (!tenant?.tenant_id || !query || query.trim().length < 2) {
      return;
    }

    setSearchingCustomers(true);
    const result = await searchCustomers(tenant.tenant_id, query.trim(), 20);
    if (result.success) {
      setCustomerOptions((previous) => mergeOptions(previous, (result.data || []).map(buildCustomerOption)));
    }
    setSearchingCustomers(false);
  };

  const loadVariantOptions = async (query) => {
    if (!tenant?.tenant_id || !createForm.location_id || !query || query.trim().length < 2) {
      return;
    }

    setSearchingVariants(true);
    const result = await searchVariants(tenant.tenant_id, query.trim(), 20, createForm.location_id);
    if (result.success) {
      setVariantOptions((result.data || []).map(buildVariantOption));
    } else {
      setVariantOptions([]);
    }
    setSearchingVariants(false);
  };

  const handleSelectCustomer = (customerId) => {
    setCreateForm((prev) => ({
      ...prev,
      customer_id: customerId || '',
    }));
  };

  const handleSelectLocation = (locationId) => {
    setCreateForm((prev) => ({
      ...prev,
      location_id: locationId || '',
      items: [],
    }));
    setVariantOptions([]);
  };

  const handleAddVariant = async (variantId) => {
    if (!variantId || !tenant?.tenant_id) return;
    const selectedOption = variantOptions.find((item) => String(item.key) === String(variantId));
    const variant = selectedOption?.raw;
    if (!variant) return;

    if (createForm.items.some((item) => String(item.variant_id) === String(variant.variant_id))) {
      setCreateError('Ese producto ya esta agregado al contrato.');
      return;
    }

    const taxResult = await getTaxInfoForVariant(tenant.tenant_id, variant.variant_id);
    const nextLine = createDraftLineFromVariant(variant, taxResult);

    setCreateForm((prev) => ({
      ...prev,
      items: [...prev.items, nextLine],
    }));
    setVariantOptions([]);
  };

  const updateDraftItem = (lineId, updates = {}) => {
    setCreateForm((prev) => ({
      ...prev,
      items: prev.items.map((item) => (
        item.line_id === lineId
          ? calculateLayawayDraftLine({ ...item, ...updates })
          : item
      )),
    }));
  };

  const removeDraftItem = (lineId) => {
    setCreateForm((prev) => ({
      ...prev,
      items: prev.items.filter((item) => item.line_id !== lineId),
    }));
  };

  const addInstallmentDraft = () => {
    setCreateForm((prev) => ({
      ...prev,
      installments: [...prev.installments, createLayawayInstallmentDraft()],
    }));
  };

  const updateInstallmentDraft = (installmentId, field, value) => {
    setCreateForm((prev) => ({
      ...prev,
      installments: prev.installments.map((item) => (
        item.installment_id === installmentId
          ? { ...item, [field]: value }
          : item
      )),
    }));
  };

  const removeInstallmentDraft = (installmentId) => {
    setCreateForm((prev) => ({
      ...prev,
      installments: prev.installments.filter((item) => item.installment_id !== installmentId),
    }));
  };

  const openCreate = () => {
    if (offlineMode) {
      setError('Plan separe no permite crear contratos en modo offline.');
      return;
    }
    resetCreateForm(createForm.location_id || locationOptions[0]?.key || '', paymentMethodOptions[0]?.key || '');
    setCreateOpen(true);
  };

  const handleCreateContract = async () => {
    if (offlineMode) {
      setCreateError('Plan separe no permite crear contratos en modo offline.');
      return;
    }

    if (!tenant?.tenant_id || !userProfile?.user_id) {
      setCreateError('No se pudo resolver tenant o usuario para crear el contrato.');
      return;
    }

    if (!createForm.customer_id || !createForm.location_id) {
      setCreateError('Selecciona cliente y sede para crear el contrato.');
      return;
    }

    if (!createForm.items.length) {
      setCreateError('Agrega al menos un producto al contrato.');
      return;
    }

    if (initialPaymentAmount > 0) {
      const sessionValidation = validateCashSessionForOperation(
        currentSession,
        cashSessionMaxHours,
        { missingMessage: 'Debes abrir una caja antes de registrar abonos de plan separe.' },
      );
      if (!sessionValidation.valid) {
        setCreateError(sessionValidation.message);
        return;
      }
      if (!createForm.initial_payment.payment_method_code) {
        setCreateError('Selecciona un metodo de pago para el abono inicial.');
        return;
      }
    }

    const installments = sanitizeLayawayInstallments(createForm.installments);
    const payload = {
      location_id: createForm.location_id,
      customer_id: createForm.customer_id,
      created_by: userProfile.user_id,
      due_date: createForm.due_date || null,
      note: createForm.note || null,
      items: createForm.items.map((item) => ({
        variant_id: item.variant_id,
        qty: Number(item.qty || item.quantity || 0),
        unit_price: Number(item.unit_price || 0),
        discount: Number(item.discount || 0),
        discount_type: item.discount_type || 'AMOUNT',
      })),
      initial_payment: initialPaymentAmount > 0
        ? {
            payment_method_code: createForm.initial_payment.payment_method_code,
            amount: initialPaymentAmount,
            reference: createForm.initial_payment.reference || null,
            cash_session_id: currentSession?.cash_session_id || null,
          }
        : null,
      installments: installments.length > 0 ? installments : null,
    };

    setCreating(true);
    setCreateError('');
    const result = await createLayaway(tenant.tenant_id, payload);
    setCreating(false);

    if (!result.success) {
      setCreateError(result.error || 'No fue posible crear el contrato.');
      return;
    }

    setCreateOpen(false);
    await loadPage(1, filters);
    if (result.data) {
      await openDetail(result.data);
    }
  };

  const handleAddPayment = async () => {
    if (offlineMode) {
      setError('Plan separe no permite pagos en modo offline.');
      return;
    }

    const amount = Number(payAmount || 0);
    if (!detail?.layaway_id || !amount || amount <= 0 || !userProfile?.user_id) {
      setError('Verifica monto y usuario para registrar el abono.');
      return;
    }
    const sessionValidation = validateCashSessionForOperation(
      currentSession,
      cashSessionMaxHours,
      { missingMessage: 'Debes abrir una caja antes de registrar abonos de plan separe.' },
    );
    if (!sessionValidation.valid) {
      setError(sessionValidation.message);
      return;
    }

    setBusyAction(true);
    const result = await addLayawayPayment(tenant.tenant_id, detail.layaway_id, {
      payment_method_code: payMethodCode || 'CASH',
      amount,
      paid_by: userProfile.user_id,
      reference: payRef || null,
      cash_session_id: currentSession.cash_session_id,
    });

    if (!result.success) {
      setError(result.error || 'No fue posible registrar abono.');
    } else {
      setPayAmount('');
      setPayRef('');
      await refreshDetail();
      await loadPage(page, filters);
    }
    setBusyAction(false);
  };

  const handleComplete = async () => {
    if (!detail?.layaway_id || !userProfile?.user_id) return;
    setBusyAction(true);
    const result = await completeLayaway(tenant.tenant_id, detail.layaway_id, userProfile.user_id, null);
    if (!result.success) {
      setError(result.error || 'No fue posible completar contrato.');
    } else {
      await refreshDetail();
      await loadPage(page, filters);
    }
    setBusyAction(false);
  };

  const handleCancel = async (status = LAYAWAY_STATUS.CANCELLED) => {
    if (!detail?.layaway_id || !userProfile?.user_id) return;
    setBusyAction(true);
    const result = await cancelLayaway(
      tenant.tenant_id,
      detail.layaway_id,
      userProfile.user_id,
      status,
      null,
    );
    if (!result.success) {
      setError(result.error || 'No fue posible actualizar contrato.');
    } else {
      await refreshDetail();
      await loadPage(page, filters);
    }
    setBusyAction(false);
  };

  return (
    <View style={[styles.container, isLightTheme && styles.containerLight]}>
      <View style={styles.filtersBlock}>
        <SearchableSelectField
          title="Estado"
          themeMode={themeMode}
          valueLabel="Todos"
          clearLabel="Todos"
          placeholder="Todos"
          searchPlaceholder="Buscar estado..."
          options={STATUS_FILTER_OPTIONS}
          selectedKey={filters?.status || ''}
          onSelect={(nextValue) => updateFilters({ status: nextValue || '' })}
        />
      </View>

      <PaginatedList
        themeMode={themeMode}
        title="Plan Separe"
        loading={loading}
        refreshing={refreshing}
        onRefresh={reload}
        error={error}
        items={contracts}
        emptyText="No hay contratos para este filtro."
        page={page}
        totalPages={totalPages}
        onPrev={() => changePage(page - 1)}
        onNext={() => changePage(page + 1)}
        headerRight={(
          <ListHeaderActionButton
            label="Nuevo contrato"
            onPress={openCreate}
            themeMode={themeMode}
            disabled={offlineMode}
          />
        )}
        footerMeta={
          cacheInfo?.source === 'cache' && cacheInfo?.cachedAt
            ? `Cache offline: ${new Date(cacheInfo.cachedAt).toLocaleString()}`
            : null
        }
        renderItem={(item) => {
          const dueState = getLayawayDueState(item);
          return (
            <Pressable key={item.layaway_id} style={[styles.card, isLightTheme && styles.cardLight]} onPress={() => openDetail(item.layaway_id)}>
              <View style={styles.cardTopRow}>
                <Text style={[styles.saleNumber, isLightTheme && styles.saleNumberLight]}>{item.contract_number || item.layaway_id?.slice(0, 8)}</Text>
                <Text style={styles.status}>{getLayawayStatusLabel(item.status)}</Text>
              </View>
              <Text style={[styles.metaLine, isLightTheme && styles.metaLineLight]}>Cliente: {item.customer_name || 'Sin cliente'}</Text>
              <Text style={[styles.metaLine, isLightTheme && styles.metaLineLight]}>
                Vence: {item.due_date ? formatDateLabel(item.due_date) : 'Sin fecha'}
              </Text>
              {dueState.isOverdue ? (
                <Text style={styles.warningText}>Contrato vencido pendiente de pago.</Text>
              ) : null}
              <Text style={[styles.metaLine, isLightTheme && styles.metaLineLight]}>Saldo: {formatMoney(item.balance || 0)}</Text>
              <Text style={styles.total}>{formatMoney(item.total || 0)}</Text>
            </Pressable>
          );
        }}
      />

      <View style={[styles.sessionBox, isLightTheme && styles.sessionBoxLight]}>
        <Text style={[styles.sessionText, isLightTheme && styles.sessionTextLight]}>
          {currentSession?.cash_register?.name
            ? `Caja activa: ${currentSession.cash_register.name}`
            : 'Sin caja abierta para registrar abonos.'}
        </Text>
        {currentSession?.cash_session_id ? (
          <Text style={sessionExpired ? styles.sessionWarn : styles.sessionOk}>
            {sessionExpired
              ? `Sesion vencida (${sessionAgeHours}h). Cierra y abre una nueva.`
              : `Sesion vigente (${sessionAgeHours}h / max. ${cashSessionMaxHours}h)`}
          </Text>
        ) : null}
      </View>

      <Modal visible={createOpen} transparent animationType="slide" onRequestClose={() => setCreateOpen(false)}>
        <View style={styles.modalOverlay}>
          <KeyboardAvoidingView style={styles.modalAvoider} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
            <View style={[styles.modalBody, isLightTheme && styles.modalBodyLight, { paddingBottom: 14 + Math.max(androidBottomInset, 8) }]}>
              <ScrollView contentContainerStyle={{ paddingBottom: 16 + androidBottomInset }}>
                <Text style={[styles.modalTitle, isLightTheme && styles.modalTitleLight]}>Nuevo contrato</Text>

                {createError ? <Text style={styles.errorText}>{createError}</Text> : null}

                <SearchableSelectField
                  title="Cliente"
                  themeMode={themeMode}
                  valueLabel="Seleccionar cliente"
                  placeholder="Seleccionar cliente"
                  searchPlaceholder="Buscar cliente..."
                  options={customerOptions}
                  selectedKey={createForm.customer_id}
                  onSelect={handleSelectCustomer}
                  onSearchQueryChange={loadCustomerOptions}
                  loadingOptions={searchingCustomers}
                  allowClear={false}
                />

                <SearchableSelectField
                  title="Sede"
                  themeMode={themeMode}
                  valueLabel={selectedLocationOption?.label || 'Seleccionar sede'}
                  placeholder="Seleccionar sede"
                  searchPlaceholder="Buscar sede..."
                  options={locationOptions}
                  selectedKey={createForm.location_id}
                  onSelect={handleSelectLocation}
                  allowClear={false}
                />

                <Text style={[styles.fieldLabel, isLightTheme && styles.fieldLabelLight]}>Fecha limite</Text>
                <TextInput
                  style={[styles.input, isLightTheme && styles.inputLight]}
                  value={createForm.due_date}
                  onChangeText={(value) => setCreateForm((prev) => ({ ...prev, due_date: value }))}
                  placeholder="YYYY-MM-DD"
                  placeholderTextColor="#64748b"
                />

                <Text style={[styles.fieldLabel, isLightTheme && styles.fieldLabelLight]}>Nota</Text>
                <TextInput
                  style={[styles.input, styles.multilineInput, isLightTheme && styles.inputLight]}
                  value={createForm.note}
                  onChangeText={(value) => setCreateForm((prev) => ({ ...prev, note: value }))}
                  placeholder="Nota opcional"
                  placeholderTextColor="#64748b"
                  multiline
                />

                <SearchableSelectField
                  title="Agregar producto"
                  themeMode={themeMode}
                  valueLabel="Buscar producto"
                  placeholder="Buscar producto"
                  searchPlaceholder={createForm.location_id ? 'Buscar producto...' : 'Selecciona sede primero'}
                  options={variantOptions}
                  selectedKey={null}
                  onSelect={handleAddVariant}
                  onSearchQueryChange={loadVariantOptions}
                  loadingOptions={searchingVariants}
                  allowClear={false}
                  disabled={!createForm.location_id}
                />

                {createForm.items.map((item) => (
                  <View key={item.line_id} style={[styles.lineCard, isLightTheme && styles.lineCardLight]}>
                    <View style={styles.lineHeader}>
                      <View style={{ flex: 1 }}>
                        <Text style={[styles.lineTitle, isLightTheme && styles.lineTitleLight]} numberOfLines={2}>
                          {item.product_name || item.variant_name || item.sku}
                        </Text>
                        <Text style={[styles.lineMeta, isLightTheme && styles.lineMetaLight]}>
                          SKU: {item.sku || 'SIN SKU'} · Disp: {Number(item.stock_available || 0)}
                        </Text>
                      </View>
                      <Pressable onPress={() => removeDraftItem(item.line_id)} style={styles.iconBtn}>
                        <Ionicons name="trash-outline" size={18} color="#fca5a5" />
                      </Pressable>
                    </View>

                    <View style={styles.rowTwo}>
                      <View style={styles.rowHalf}>
                        <Text style={[styles.fieldLabel, isLightTheme && styles.fieldLabelLight]}>Cantidad</Text>
                        <TextInput
                          style={[styles.input, isLightTheme && styles.inputLight]}
                          value={String(item.qty)}
                          onChangeText={(value) => updateDraftItem(item.line_id, { qty: normalizeAmountInput(value) || 0 })}
                          keyboardType="numeric"
                          placeholder="1"
                          placeholderTextColor="#64748b"
                        />
                      </View>
                      <View style={styles.rowHalf}>
                        <Text style={[styles.fieldLabel, isLightTheme && styles.fieldLabelLight]}>Precio</Text>
                        <TextInput
                          style={[styles.input, isLightTheme && styles.inputLight]}
                          value={String(item.unit_price)}
                          onChangeText={(value) => updateDraftItem(item.line_id, { unit_price: normalizeAmountInput(value) || 0 })}
                          keyboardType="numeric"
                          placeholder="0"
                          placeholderTextColor="#64748b"
                        />
                      </View>
                    </View>

                    <View style={styles.rowTwo}>
                      <View style={styles.rowHalf}>
                        <Text style={[styles.fieldLabel, isLightTheme && styles.fieldLabelLight]}>Descuento</Text>
                        <TextInput
                          style={[styles.input, isLightTheme && styles.inputLight]}
                          value={String(item.discount || 0)}
                          onChangeText={(value) => updateDraftItem(item.line_id, { discount: normalizeAmountInput(value) || 0 })}
                          keyboardType="numeric"
                          placeholder="0"
                          placeholderTextColor="#64748b"
                        />
                      </View>
                      <View style={styles.rowHalf}>
                        <Text style={[styles.fieldLabel, isLightTheme && styles.fieldLabelLight]}>Tipo</Text>
                        <View style={styles.toggleRow}>
                          <Pressable
                            style={[styles.toggleBtn, item.discount_type === 'AMOUNT' && styles.toggleBtnActive]}
                            onPress={() => updateDraftItem(item.line_id, { discount_type: 'AMOUNT' })}
                          >
                            <Text style={styles.toggleBtnText}>$</Text>
                          </Pressable>
                          <Pressable
                            style={[styles.toggleBtn, item.discount_type === 'PERCENT' && styles.toggleBtnActive]}
                            onPress={() => updateDraftItem(item.line_id, { discount_type: 'PERCENT' })}
                          >
                            <Text style={styles.toggleBtnText}>%</Text>
                          </Pressable>
                        </View>
                      </View>
                    </View>

                    <Text style={[styles.lineMeta, isLightTheme && styles.lineMetaLight]}>
                      Base: {formatMoney(item.base_amount || 0)} · IVA: {formatMoney(item.tax_amount || 0)} · Total: {formatMoney(item.total || 0)}
                    </Text>
                  </View>
                ))}

                {createForm.items.length === 0 ? (
                  <Text style={[styles.emptyText, isLightTheme && styles.emptyTextLight]}>
                    Agrega productos para crear el contrato.
                  </Text>
                ) : null}

                <View style={[styles.summaryCard, isLightTheme && styles.summaryCardLight]}>
                  <Text style={[styles.summaryText, isLightTheme && styles.summaryTextLight]}>Subtotal: {formatMoney(contractTotals.subtotal)}</Text>
                  <Text style={[styles.summaryText, isLightTheme && styles.summaryTextLight]}>Descuento: {formatMoney(contractTotals.discount)}</Text>
                  <Text style={[styles.summaryText, isLightTheme && styles.summaryTextLight]}>Impuestos: {formatMoney(contractTotals.tax)}</Text>
                  <Text style={styles.summaryTotal}>Total: {formatMoney(contractTotals.total)}</Text>
                </View>

                <Text style={[styles.sectionTitle, isLightTheme && styles.sectionTitleLight]}>Abono inicial</Text>
                <SearchableSelectField
                  title="Metodo de pago"
                  themeMode={themeMode}
                  valueLabel="Seleccionar metodo"
                  placeholder="Seleccionar metodo"
                  searchPlaceholder="Buscar metodo..."
                  options={paymentMethodOptions}
                  selectedKey={createForm.initial_payment.payment_method_code}
                  onSelect={(value) => setCreateForm((prev) => ({
                    ...prev,
                    initial_payment: { ...prev.initial_payment, payment_method_code: value || '' },
                  }))}
                />
                <View style={styles.rowTwo}>
                  <View style={styles.rowHalf}>
                    <Text style={[styles.fieldLabel, isLightTheme && styles.fieldLabelLight]}>Monto</Text>
                    <TextInput
                      style={[styles.input, isLightTheme && styles.inputLight]}
                      value={createForm.initial_payment.amount}
                      onChangeText={(value) => setCreateForm((prev) => ({
                        ...prev,
                        initial_payment: { ...prev.initial_payment, amount: value },
                      }))}
                      keyboardType="numeric"
                      placeholder="0"
                      placeholderTextColor="#64748b"
                    />
                  </View>
                  <View style={styles.rowHalf}>
                    <Text style={[styles.fieldLabel, isLightTheme && styles.fieldLabelLight]}>Referencia</Text>
                    <TextInput
                      style={[styles.input, isLightTheme && styles.inputLight]}
                      value={createForm.initial_payment.reference}
                      onChangeText={(value) => setCreateForm((prev) => ({
                        ...prev,
                        initial_payment: { ...prev.initial_payment, reference: value },
                      }))}
                      placeholder="Opcional"
                      placeholderTextColor="#64748b"
                    />
                  </View>
                </View>

                <View style={styles.sectionRow}>
                  <Text style={[styles.sectionTitle, isLightTheme && styles.sectionTitleLight]}>Cuotas pactadas</Text>
                  <Pressable onPress={addInstallmentDraft} style={styles.inlineAddBtn}>
                    <Ionicons name="add-circle-outline" size={18} color="#93c5fd" />
                    <Text style={styles.inlineAddBtnText}>Agregar</Text>
                  </Pressable>
                </View>

                {createForm.installments.map((installment) => (
                  <View key={installment.installment_id} style={[styles.lineCard, isLightTheme && styles.lineCardLight]}>
                    <View style={styles.lineHeader}>
                      <Text style={[styles.lineTitle, isLightTheme && styles.lineTitleLight]}>Cuota</Text>
                      <Pressable onPress={() => removeInstallmentDraft(installment.installment_id)} style={styles.iconBtn}>
                        <Ionicons name="trash-outline" size={18} color="#fca5a5" />
                      </Pressable>
                    </View>
                    <View style={styles.rowTwo}>
                      <View style={styles.rowHalf}>
                        <Text style={[styles.fieldLabel, isLightTheme && styles.fieldLabelLight]}>Fecha</Text>
                        <TextInput
                          style={[styles.input, isLightTheme && styles.inputLight]}
                          value={installment.due_date}
                          onChangeText={(value) => updateInstallmentDraft(installment.installment_id, 'due_date', value)}
                          placeholder="YYYY-MM-DD"
                          placeholderTextColor="#64748b"
                        />
                      </View>
                      <View style={styles.rowHalf}>
                        <Text style={[styles.fieldLabel, isLightTheme && styles.fieldLabelLight]}>Monto</Text>
                        <TextInput
                          style={[styles.input, isLightTheme && styles.inputLight]}
                          value={String(installment.amount || '')}
                          onChangeText={(value) => updateInstallmentDraft(installment.installment_id, 'amount', value)}
                          keyboardType="numeric"
                          placeholder="0"
                          placeholderTextColor="#64748b"
                        />
                      </View>
                    </View>
                  </View>
                ))}

                {installmentsSummary.count > 0 ? (
                  <Text style={[styles.lineMeta, isLightTheme && styles.lineMetaLight]}>
                    {installmentsSummary.count} cuota(s) · Total pactado {formatMoney(installmentsSummary.totalAmount)}
                  </Text>
                ) : null}
              </ScrollView>

              <View style={styles.footerActions}>
                <Pressable onPress={() => setCreateOpen(false)} style={styles.secondaryBtn}>
                  <View style={styles.btnContentRow}>
                    <Ionicons name="close-outline" size={16} color="#dbeafe" />
                    <Text style={styles.secondaryBtnText}>Cancelar</Text>
                  </View>
                </Pressable>
                <Pressable onPress={handleCreateContract} style={styles.primaryBtn} disabled={creating}>
                  <View style={styles.btnContentRow}>
                    <Ionicons name={creating ? 'hourglass-outline' : 'save-outline'} size={16} color="#ecfdf5" />
                    <Text style={styles.primaryBtnText}>{creating ? 'Creando...' : 'Crear contrato'}</Text>
                  </View>
                </Pressable>
              </View>
            </View>
          </KeyboardAvoidingView>
        </View>
      </Modal>

      <Modal visible={Boolean(detail) || loadingDetail} transparent animationType="slide" onRequestClose={() => setDetail(null)}>
        <View style={styles.modalOverlay}>
          <KeyboardAvoidingView style={styles.modalAvoider} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
            <View style={[styles.modalBody, isLightTheme && styles.modalBodyLight, { paddingBottom: 14 + Math.max(androidBottomInset, 8) }]}>
              {loadingDetail ? (
                <ActivityIndicator color="#4ade80" />
              ) : (
                <ScrollView contentContainerStyle={{ paddingBottom: 12 + androidBottomInset }}>
                  <Text style={[styles.modalTitle, isLightTheme && styles.modalTitleLight]}>Contrato</Text>
                  <Text style={[styles.metaLine, isLightTheme && styles.metaLineLight]}>{detail?.contract_number || detail?.layaway_id}</Text>
                  <Text style={[styles.metaLine, isLightTheme && styles.metaLineLight]}>Cliente: {detail?.customer?.full_name || '-'}</Text>
                  <Text style={[styles.metaLine, isLightTheme && styles.metaLineLight]}>Estado: {getLayawayStatusLabel(detail?.status)}</Text>
                  <Text style={[styles.metaLine, isLightTheme && styles.metaLineLight]}>
                    Vence: {detail?.due_date ? formatDateLabel(detail.due_date) : 'Sin fecha'}
                  </Text>
                  <Text style={[styles.metaLine, isLightTheme && styles.metaLineLight]}>Total: {formatMoney(detail?.total || 0)}</Text>
                  <Text style={[styles.metaLine, isLightTheme && styles.metaLineLight]}>Pagado: {formatMoney(detail?.paid_total || 0)}</Text>
                  <Text style={[styles.metaLine, isLightTheme && styles.metaLineLight]}>Saldo: {formatMoney(detail?.balance || 0)}</Text>

                  <Text style={styles.groupTitle}>Items</Text>
                  {(detail?.items || []).map((line) => (
                    <View key={line.layaway_item_id} style={styles.detailRow}>
                      <Text style={[styles.metaLine, isLightTheme && styles.metaLineLight]}>
                        {line.variant?.product?.name || line.variant?.variant_name || '-'}
                      </Text>
                      <Text style={[styles.metaLine, isLightTheme && styles.metaLineLight]}>
                        x {line.quantity} · {formatMoney(line.line_total || 0)}
                      </Text>
                    </View>
                  ))}

                  <Text style={styles.groupTitle}>Cuotas</Text>
                  {(detail?.installments || []).length > 0 ? (
                    (detail?.installments || []).map((installment) => (
                      <View key={installment.layaway_installment_id || installment.due_date} style={styles.detailRow}>
                        <Text style={[styles.metaLine, isLightTheme && styles.metaLineLight]}>{formatDateLabel(installment.due_date)}</Text>
                        <Text style={[styles.metaLine, isLightTheme && styles.metaLineLight]}>
                          {formatMoney(installment.amount || 0)} · {installment.status || 'PENDING'}
                        </Text>
                      </View>
                    ))
                  ) : (
                    <Text style={[styles.metaLine, isLightTheme && styles.metaLineLight]}>Sin cuotas registradas.</Text>
                  )}

                  <Text style={styles.groupTitle}>Abonos</Text>
                  {(detail?.payments || []).map((payment) => (
                    <View key={payment.layaway_payment_id} style={styles.detailRow}>
                      <Text style={[styles.metaLine, isLightTheme && styles.metaLineLight]}>
                        {payment.payment_method_name || payment.payment_method_code || 'Pago'}
                      </Text>
                      <Text style={[styles.metaLine, isLightTheme && styles.metaLineLight]}>{formatMoney(payment.amount || 0)}</Text>
                    </View>
                  ))}

                  {detail?.status === LAYAWAY_STATUS.ACTIVE ? (
                    <View style={[styles.actionBox, isLightTheme && styles.actionBoxLight]}>
                      <Text style={styles.groupTitle}>Registrar abono</Text>
                      <TextInput
                        style={[styles.input, isLightTheme && styles.inputLight]}
                        value={payAmount}
                        onChangeText={setPayAmount}
                        placeholder="Monto"
                        placeholderTextColor="#64748b"
                        keyboardType="numeric"
                      />
                      <SearchableSelectField
                        title="Metodo de pago"
                        themeMode={themeMode}
                        valueLabel={paymentMethodOptions.find((item) => item.key === payMethodCode)?.label || 'Seleccionar metodo'}
                        placeholder="Seleccionar metodo"
                        searchPlaceholder="Buscar metodo..."
                        options={paymentMethodOptions}
                        selectedKey={payMethodCode}
                        onSelect={(value) => setPayMethodCode(value || '')}
                      />
                      <TextInput
                        style={[styles.input, isLightTheme && styles.inputLight]}
                        value={payRef}
                        onChangeText={setPayRef}
                        placeholder="Referencia (opcional)"
                        placeholderTextColor="#64748b"
                      />
                      <Pressable style={styles.primaryBtn} onPress={handleAddPayment} disabled={busyAction}>
                        <View style={styles.btnContentRow}>
                          <Ionicons name={busyAction ? 'hourglass-outline' : 'wallet-outline'} size={16} color="#ecfdf5" />
                          <Text style={styles.primaryBtnText}>{busyAction ? 'Procesando...' : 'Guardar abono'}</Text>
                        </View>
                      </Pressable>

                      <View style={styles.inlineActions}>
                        <Pressable style={styles.secondaryBtn} onPress={handleComplete} disabled={busyAction || Number(detail?.balance || 0) !== 0}>
                          <View style={styles.btnContentRow}>
                            <Ionicons name="checkmark-circle-outline" size={16} color="#dbeafe" />
                            <Text style={styles.secondaryBtnText}>Completar</Text>
                          </View>
                        </Pressable>
                        <Pressable style={styles.warningBtn} onPress={() => handleCancel(LAYAWAY_STATUS.EXPIRED)} disabled={busyAction}>
                          <View style={styles.btnContentRow}>
                            <Ionicons name="time-outline" size={16} color="#fde68a" />
                            <Text style={styles.warningBtnText}>Expirar</Text>
                          </View>
                        </Pressable>
                        <Pressable style={styles.dangerBtn} onPress={() => handleCancel(LAYAWAY_STATUS.CANCELLED)} disabled={busyAction}>
                          <View style={styles.btnContentRow}>
                            <Ionicons name="close-circle-outline" size={16} color="#fee2e2" />
                            <Text style={styles.dangerBtnText}>Cancelar</Text>
                          </View>
                        </Pressable>
                      </View>
                    </View>
                  ) : null}
                </ScrollView>
              )}

              <Pressable onPress={() => setDetail(null)} style={styles.closeBtn}>
                <View style={styles.btnContentRow}>
                  <Ionicons name="chevron-down-circle-outline" size={16} color="#fff" />
                  <Text style={styles.closeBtnText}>Cerrar</Text>
                </View>
              </Pressable>
            </View>
          </KeyboardAvoidingView>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#060b16', padding: 12 },
  containerLight: { backgroundColor: '#edf2fb' },
  filtersBlock: { marginBottom: 8 },
  card: { backgroundColor: '#111827', borderWidth: 1, borderColor: '#1f2937', borderRadius: 12, padding: 12, marginBottom: 8 },
  cardLight: { backgroundColor: '#ffffff', borderColor: '#dbe4ef' },
  cardTopRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 4, gap: 8 },
  saleNumber: { color: '#f8fafc', fontWeight: '700' },
  saleNumberLight: { color: '#0f172a' },
  status: { color: '#86efac', fontSize: 12, fontWeight: '700' },
  metaLine: { color: '#cbd5e1', fontSize: 13, marginBottom: 2 },
  metaLineLight: { color: '#475569' },
  total: { color: '#34d399', fontSize: 18, fontWeight: '700', marginTop: 4 },
  warningText: { color: '#fbbf24', fontSize: 12, fontWeight: '700', marginTop: 2 },
  sessionBox: {
    marginBottom: 8,
    borderWidth: 1,
    borderColor: '#1f2937',
    borderRadius: 10,
    padding: 10,
    backgroundColor: '#0f172a',
  },
  sessionBoxLight: { borderColor: '#dbe4ef', backgroundColor: '#ffffff' },
  sessionText: { color: '#cbd5e1', fontSize: 12, marginBottom: 4 },
  sessionTextLight: { color: '#475569' },
  sessionOk: { color: '#4ade80', fontSize: 12, fontWeight: '700' },
  sessionWarn: { color: '#f87171', fontSize: 12, fontWeight: '700' },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(2,6,23,0.72)',
    justifyContent: 'flex-end',
  },
  modalAvoider: {
    width: '100%',
  },
  modalBody: {
    maxHeight: '92%',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    borderWidth: 1,
    borderColor: '#1f2937',
    backgroundColor: '#0f172a',
    paddingHorizontal: 16,
    paddingTop: 14,
    gap: 10,
  },
  modalBodyLight: {
    borderColor: '#dbe4ef',
    backgroundColor: '#ffffff',
  },
  modalTitle: {
    color: '#f8fafc',
    fontSize: 20,
    fontWeight: '800',
    marginBottom: 4,
  },
  modalTitleLight: { color: '#0f172a' },
  groupTitle: {
    color: '#93c5fd',
    fontWeight: '800',
    fontSize: 14,
    marginTop: 14,
    marginBottom: 6,
  },
  fieldLabel: {
    color: '#94a3b8',
    fontSize: 12,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.4,
    marginTop: 12,
    marginBottom: 6,
  },
  fieldLabelLight: { color: '#475569' },
  input: {
    minHeight: 42,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#334155',
    backgroundColor: '#111827',
    color: '#f8fafc',
    paddingHorizontal: 12,
  },
  inputLight: {
    borderColor: '#cbd5e1',
    backgroundColor: '#ffffff',
    color: '#0f172a',
  },
  multilineInput: {
    minHeight: 86,
    paddingTop: 12,
    textAlignVertical: 'top',
  },
  lineCard: {
    borderWidth: 1,
    borderColor: '#1f2937',
    borderRadius: 12,
    backgroundColor: '#111827',
    padding: 12,
    marginTop: 10,
  },
  lineCardLight: {
    borderColor: '#dbe4ef',
    backgroundColor: '#f8fbff',
  },
  lineHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 8,
  },
  lineTitle: {
    color: '#f8fafc',
    fontWeight: '700',
    fontSize: 14,
  },
  lineTitleLight: { color: '#0f172a' },
  lineMeta: {
    color: '#94a3b8',
    fontSize: 12,
    marginTop: 4,
  },
  lineMetaLight: { color: '#64748b' },
  iconBtn: {
    padding: 4,
  },
  rowTwo: {
    flexDirection: 'row',
    gap: 10,
  },
  rowHalf: {
    flex: 1,
  },
  toggleRow: {
    flexDirection: 'row',
    gap: 8,
  },
  toggleBtn: {
    flex: 1,
    minHeight: 42,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#334155',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#0b1220',
  },
  toggleBtnActive: {
    borderColor: '#2563eb',
    backgroundColor: '#1d4ed8',
  },
  toggleBtnText: {
    color: '#eff6ff',
    fontWeight: '800',
  },
  summaryCard: {
    borderWidth: 1,
    borderColor: '#1f2937',
    borderRadius: 12,
    backgroundColor: '#0b1220',
    padding: 12,
    marginTop: 14,
  },
  summaryCardLight: {
    borderColor: '#dbe4ef',
    backgroundColor: '#f8fbff',
  },
  summaryText: {
    color: '#cbd5e1',
    fontSize: 13,
    marginBottom: 4,
  },
  summaryTextLight: { color: '#475569' },
  summaryTotal: {
    color: '#34d399',
    fontWeight: '800',
    fontSize: 16,
    marginTop: 4,
  },
  sectionTitle: {
    color: '#f8fafc',
    fontWeight: '800',
    fontSize: 15,
    marginTop: 14,
  },
  sectionTitleLight: { color: '#0f172a' },
  sectionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 14,
  },
  inlineAddBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  inlineAddBtnText: {
    color: '#93c5fd',
    fontWeight: '700',
  },
  emptyText: {
    color: '#94a3b8',
    textAlign: 'center',
    paddingVertical: 12,
  },
  emptyTextLight: { color: '#64748b' },
  detailRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
    marginBottom: 6,
  },
  actionBox: {
    marginTop: 14,
    borderWidth: 1,
    borderColor: '#1f2937',
    borderRadius: 12,
    backgroundColor: '#111827',
    padding: 12,
    gap: 10,
  },
  actionBoxLight: {
    borderColor: '#dbe4ef',
    backgroundColor: '#f8fbff',
  },
  primaryBtn: {
    minHeight: 44,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#0f766e',
    borderWidth: 1,
    borderColor: '#14b8a6',
    paddingHorizontal: 14,
  },
  primaryBtnText: {
    color: '#ecfdf5',
    fontWeight: '800',
    fontSize: 14,
  },
  secondaryBtn: {
    flex: 1,
    minHeight: 42,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#1d4ed8',
    borderWidth: 1,
    borderColor: '#60a5fa',
    paddingHorizontal: 14,
  },
  secondaryBtnText: {
    color: '#dbeafe',
    fontWeight: '800',
    fontSize: 13,
  },
  warningBtn: {
    flex: 1,
    minHeight: 42,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#a16207',
    borderWidth: 1,
    borderColor: '#fbbf24',
    paddingHorizontal: 14,
  },
  warningBtnText: {
    color: '#fef3c7',
    fontWeight: '800',
    fontSize: 13,
  },
  dangerBtn: {
    flex: 1,
    minHeight: 42,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#991b1b',
    borderWidth: 1,
    borderColor: '#f87171',
    paddingHorizontal: 14,
  },
  dangerBtnText: {
    color: '#fee2e2',
    fontWeight: '800',
    fontSize: 13,
  },
  inlineActions: {
    flexDirection: 'row',
    gap: 8,
    flexWrap: 'wrap',
  },
  footerActions: {
    flexDirection: 'row',
    gap: 10,
    paddingTop: 8,
    paddingBottom: 4,
  },
  btnContentRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  closeBtn: {
    minHeight: 44,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#1e293b',
    borderWidth: 1,
    borderColor: '#475569',
    marginTop: 6,
    marginBottom: 8,
  },
  closeBtnText: {
    color: '#fff',
    fontWeight: '800',
    fontSize: 14,
  },
  errorText: {
    color: '#fca5a5',
    fontSize: 13,
    fontWeight: '700',
    marginBottom: 6,
  },
});
