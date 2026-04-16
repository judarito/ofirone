import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import BottomSheetModal from '../components/BottomSheetModal';
import CollapsibleFilterSection from '../components/CollapsibleFilterSection';
import DatePickerField from '../components/DatePickerField';
import ListHeaderActionButton from '../components/ListHeaderActionButton';
import PaginatedList from '../components/PaginatedList';
import SearchableSelectField from '../components/SearchableSelectField';
import { usePaginatedList } from '../hooks/usePaginatedList';
import { useThemeMode } from '../lib/themeMode';
import {
  buildBatchAlertMeta,
  createBatch,
  createBatchDraft,
  formatDaysToExpiry,
  generateBatchNumber,
  getBatchTraceability,
  getExpirationDashboard,
  getExpiringProducts,
  getTopAtRiskProducts,
  listManagedBatches,
  updateBatch,
} from '../services/batches.service';
import { listLocations } from '../services/inventoryCatalog.service';
import { searchPurchaseVariants } from '../services/purchases.service';

const TABS = [
  { key: 'batches', label: 'Lotes', icon: 'albums-outline' },
  { key: 'alerts', label: 'Alertas', icon: 'alert-circle-outline' },
  { key: 'reports', label: 'Reportes', icon: 'bar-chart-outline' },
];

const ALERT_FILTER_OPTIONS = [
  { key: '', label: 'Todos' },
  { key: 'EXPIRED', label: 'Vencidos' },
  { key: 'CRITICAL', label: 'Críticos' },
  { key: 'WARNING', label: 'Advertencia' },
  { key: 'OK', label: 'OK' },
  { key: 'NO_EXP', label: 'Sin vencimiento' },
];

function parseDecimalInput(value) {
  const normalized = String(value ?? '').replace(/\s+/g, '').replace(',', '.');
  return Number(normalized);
}

function formatMoneyValue(value) {
  return `$ ${Math.round(Number(value || 0)).toLocaleString('es-CO')}`;
}

function buildVariantLabel(variant) {
  const productName = variant?.product?.name || 'Producto';
  const variantName = variant?.variant_name ? ` - ${variant.variant_name}` : '';
  const sku = variant?.sku ? ` (${variant.sku})` : '';
  return `${productName}${variantName}${sku}`;
}

export default function BatchesScreen({
  tenant,
  themeMode,
  offlineMode,
  pageSize = 20,
}) {
  const themeModeContext = useThemeMode();
  const resolvedThemeMode = themeMode || themeModeContext || 'dark';
  const isLightTheme = resolvedThemeMode === 'light';
  const [tab, setTab] = useState('batches');
  const [locations, setLocations] = useState([]);
  const [alertsRows, setAlertsRows] = useState([]);
  const [alertsLoading, setAlertsLoading] = useState(false);
  const [alertsError, setAlertsError] = useState('');
  const [dashboardRows, setDashboardRows] = useState([]);
  const [topAtRiskRows, setTopAtRiskRows] = useState([]);
  const [reportsLoading, setReportsLoading] = useState(false);
  const [reportsError, setReportsError] = useState('');
  const [variantOptions, setVariantOptions] = useState([]);
  const [variantsLoading, setVariantsLoading] = useState(false);
  const [batchModalOpen, setBatchModalOpen] = useState(false);
  const [batchSaving, setBatchSaving] = useState(false);
  const [batchError, setBatchError] = useState('');
  const [batchForm, setBatchForm] = useState(() => createBatchDraft(''));
  const [traceabilityOpen, setTraceabilityOpen] = useState(false);
  const [traceabilityLoading, setTraceabilityLoading] = useState(false);
  const [traceabilityError, setTraceabilityError] = useState('');
  const [traceabilityRows, setTraceabilityRows] = useState([]);
  const [traceabilityBatchLabel, setTraceabilityBatchLabel] = useState('');
  const variantRequestRef = useRef(0);
  const mountedRef = useRef(true);

  const defaultLocationId = useMemo(
    () => (locations.length === 1 ? locations[0].location_id : ''),
    [locations],
  );

  const {
    items,
    page,
    totalPages,
    loading,
    error,
    cacheInfo,
    refreshing,
    reload,
    filters,
    changePage,
    updateFilters,
  } = usePaginatedList({
    tenantId: tenant?.tenant_id,
    pageSize,
    offlineMode,
    cacheNamespace: 'batch-management-main',
    initialFilters: {
      location_id: '',
      alert_level: '',
      search: '',
    },
    fetchPage: async ({ page: nextPage, pageSize: nextPageSize, filters: nextFilters, tenantId }) => {
      const offset = (nextPage - 1) * nextPageSize;
      return listManagedBatches({
        tenantId,
        locationId: nextFilters?.location_id || null,
        alertLevel: nextFilters?.alert_level || null,
        search: nextFilters?.search || '',
        limit: nextPageSize,
        offset,
        offlineMode,
      });
    },
  });

  const locationOptions = useMemo(
    () => (locations || []).map((loc) => ({
      key: loc.location_id,
      label: loc.name,
      searchText: loc.name,
    })),
    [locations],
  );

  const alertFilterSelectOptions = useMemo(
    () => ALERT_FILTER_OPTIONS.filter((item) => item.key).map((item) => ({
      key: item.key,
      label: item.label,
      searchText: item.label,
    })),
    [],
  );

  const variantSelectOptions = useMemo(
    () => (variantOptions || []).map((variant) => ({
      key: variant.variant_id,
      label: buildVariantLabel(variant),
      searchText: [variant.product?.name, variant.variant_name, variant.sku].filter(Boolean).join(' '),
      raw: variant,
    })),
    [variantOptions],
  );

  useEffect(() => {
    const load = async () => {
      if (!tenant?.tenant_id) return;
      const result = await listLocations(tenant.tenant_id, { offlineMode });
      if (result.success) {
        setLocations(result.data || []);
      }
    };
    load();
  }, [offlineMode, tenant?.tenant_id]);

  useEffect(() => () => {
    mountedRef.current = false;
  }, []);

  useEffect(() => {
    if (!defaultLocationId) return;
    setBatchForm((prev) => (prev.location_id ? prev : { ...prev, location_id: defaultLocationId }));
  }, [defaultLocationId]);

  const loadVariantOptions = useCallback(async (search = '') => {
    if (!tenant?.tenant_id || offlineMode) return;

    const requestId = variantRequestRef.current + 1;
    variantRequestRef.current = requestId;
    setVariantsLoading(true);
    try {
      const result = await searchPurchaseVariants({
        tenantId: tenant.tenant_id,
        search,
        limit: 40,
      });
      if (!mountedRef.current || requestId !== variantRequestRef.current) return;
      if (result.success) {
        setVariantOptions(result.data || []);
      }
    } finally {
      if (mountedRef.current && requestId === variantRequestRef.current) {
        setVariantsLoading(false);
      }
    }
  }, [offlineMode, tenant?.tenant_id]);

  const loadAlerts = useCallback(async () => {
    if (!tenant?.tenant_id || tab !== 'alerts') return;
    setAlertsLoading(true);
    setAlertsError('');
    const result = await getExpiringProducts({
      tenantId: tenant.tenant_id,
      locationId: filters?.location_id || null,
      alertLevel: filters?.alert_level || null,
      offlineMode,
    });
    if (!result.success) {
      setAlertsRows([]);
      setAlertsError(result.error || 'No fue posible cargar alertas.');
      setAlertsLoading(false);
      return;
    }

    setAlertsRows(result.data || []);
    if (result.warning) setAlertsError(result.warning);
    setAlertsLoading(false);
  }, [filters?.alert_level, filters?.location_id, offlineMode, tab, tenant?.tenant_id]);

  const loadReports = useCallback(async () => {
    if (!tenant?.tenant_id || tab !== 'reports') return;
    setReportsLoading(true);
    setReportsError('');
    const [dashboardResult, topResult] = await Promise.all([
      getExpirationDashboard({ tenantId: tenant.tenant_id, offlineMode }),
      getTopAtRiskProducts({
        tenantId: tenant.tenant_id,
        locationId: filters?.location_id || null,
        limit: 10,
        offlineMode,
      }),
    ]);

    if (!dashboardResult.success) {
      setDashboardRows([]);
      setReportsError(dashboardResult.error || 'No fue posible cargar el dashboard de vencimientos.');
    } else {
      setDashboardRows(dashboardResult.data || []);
      if (dashboardResult.warning) setReportsError(dashboardResult.warning);
    }

    if (!topResult.success) {
      setTopAtRiskRows([]);
      setReportsError((prev) => prev || topResult.error || 'No fue posible cargar productos en riesgo.');
    } else {
      setTopAtRiskRows(topResult.data || []);
      if (topResult.warning && !dashboardResult.warning) setReportsError(topResult.warning);
    }

    setReportsLoading(false);
  }, [filters?.location_id, offlineMode, tab, tenant?.tenant_id]);

  useEffect(() => {
    loadAlerts();
  }, [loadAlerts]);

  useEffect(() => {
    loadReports();
  }, [loadReports]);

  const openCreateBatch = () => {
    setBatchError('');
    setBatchForm(createBatchDraft(defaultLocationId));
    setBatchModalOpen(true);
    loadVariantOptions('');
  };

  const openEditBatch = (item) => {
    setBatchError('');
    setBatchForm(createBatchDraft(defaultLocationId, {
      ...item,
      variant_label: buildVariantLabel(item?.variant),
    }));
    setBatchModalOpen(true);
    loadVariantOptions(item?.variant?.sku || item?.variant?.product?.name || '');
  };

  const handleSelectVariant = (nextVariantId) => {
    if (!nextVariantId) {
      setBatchForm((prev) => ({
        ...prev,
        variant_id: '',
        variant_label: '',
      }));
      return;
    }

    const selected = variantSelectOptions.find((item) => String(item.key) === String(nextVariantId));
    const variant = selected?.raw || null;
    setBatchForm((prev) => ({
      ...prev,
      variant_id: nextVariantId,
      variant_label: selected?.label || prev.variant_label,
      unit_cost:
        variant?.cost !== null && variant?.cost !== undefined
          ? String(variant.cost)
          : prev.unit_cost,
    }));
  };

  const handleGenerateBatchNumber = async () => {
    if (!tenant?.tenant_id) return;
    if (!batchForm.variant_id) {
      setBatchError('Selecciona primero el producto o variante del lote.');
      return;
    }
    const result = await generateBatchNumber({
      tenantId: tenant.tenant_id,
      variantId: batchForm.variant_id,
      locationId: batchForm.location_id || null,
    });
    if (!result.success || !result.batchNumber) {
      setBatchError(result.error || 'No fue posible generar el número de lote.');
      return;
    }
    setBatchForm((prev) => ({ ...prev, batch_number: result.batchNumber }));
  };

  const submitBatch = async () => {
    if (offlineMode) {
      setBatchError('La creación o edición de lotes no está disponible en modo offline.');
      return;
    }
    if (!tenant?.tenant_id) {
      setBatchError('No hay tenant activo para registrar el lote.');
      return;
    }
    if (!batchForm.location_id) {
      setBatchError('Selecciona la sede del lote.');
      return;
    }
    if (!batchForm.variant_id) {
      setBatchError('Selecciona el producto o variante del lote.');
      return;
    }
    if (!String(batchForm.batch_number || '').trim()) {
      setBatchError('El número de lote es obligatorio.');
      return;
    }

    const onHand = parseDecimalInput(batchForm.on_hand);
    const unitCost = parseDecimalInput(batchForm.unit_cost);
    if (!Number.isFinite(onHand) || onHand < 0) {
      setBatchError('La cantidad del lote debe ser mayor o igual a 0.');
      return;
    }
    if (!Number.isFinite(unitCost) || unitCost < 0) {
      setBatchError('El costo unitario del lote debe ser mayor o igual a 0.');
      return;
    }

    setBatchSaving(true);
    setBatchError('');
    const result = batchForm.batch_id
      ? await updateBatch(batchForm.batch_id, batchForm)
      : await createBatch({ tenantId: tenant.tenant_id, form: batchForm });

    if (!result.success) {
      setBatchError(result.error || 'No fue posible guardar el lote.');
      setBatchSaving(false);
      return;
    }

    setBatchSaving(false);
    setBatchModalOpen(false);
    await reload();
    if (tab === 'alerts') await loadAlerts();
    if (tab === 'reports') await loadReports();
    Alert.alert('Lote guardado', batchForm.batch_id ? 'El lote se actualizó correctamente.' : 'El lote se creó correctamente.');
  };

  const openTraceability = async (item) => {
    if (!tenant?.tenant_id) return;
    setTraceabilityOpen(true);
    setTraceabilityRows([]);
    setTraceabilityError('');
    setTraceabilityLoading(true);
    setTraceabilityBatchLabel(item?.batch_number || 'Lote');
    const result = await getBatchTraceability({
      tenantId: tenant.tenant_id,
      batchId: item.batch_id,
      offlineMode,
    });
    if (!result.success) {
      setTraceabilityError(result.error || 'No fue posible cargar la trazabilidad del lote.');
      setTraceabilityLoading(false);
      return;
    }
    setTraceabilityRows(result.data || []);
    if (result.warning) setTraceabilityError(result.warning);
    setTraceabilityLoading(false);
  };

  const activeFiltersCount = [
    filters?.location_id,
    filters?.alert_level,
    String(filters?.search || '').trim(),
  ].filter(Boolean).length;

  const renderBatchItem = (item) => {
    const alert = buildBatchAlertMeta(item.expiration_date);
    return (
      <View key={item.batch_id} style={[styles.card, isLightTheme && styles.cardLight]}>
        <View style={styles.cardHeader}>
          <View style={styles.cardHeaderCopy}>
            <Text style={[styles.cardTitle, isLightTheme && styles.cardTitleLight]}>
              {item.variant?.product?.name || 'Producto'}
            </Text>
            <Text style={[styles.cardSubtitle, isLightTheme && styles.cardSubtitleLight]}>
              {item.variant?.sku || '-'} · {item.variant?.variant_name || 'Predeterminada'}
            </Text>
          </View>
          <View style={[styles.alertPill, { borderColor: alert.color, backgroundColor: `${alert.color}22` }]}>
            <Text style={[styles.alertPillText, { color: alert.color }]}>{alert.label}</Text>
          </View>
        </View>

        <Text style={[styles.meta, isLightTheme && styles.metaLight]}>
          {item.location?.name || 'Sin sede'} · Lote {item.batch_number || '-'}
        </Text>
        {item.physical_location ? (
          <Text style={[styles.meta, isLightTheme && styles.metaLight]}>
            Ubicación física: {item.physical_location}
          </Text>
        ) : null}

        <View style={styles.badgesRow}>
          <View style={[styles.badge, isLightTheme && styles.badgeLight, { borderColor: '#38bdf8' }]}>
            <Text style={[styles.badgeText, isLightTheme && styles.badgeTextLight]}>
              Stock {Number(item.on_hand || 0).toLocaleString('es-CO')}
            </Text>
          </View>
          <View style={[styles.badge, isLightTheme && styles.badgeLight, { borderColor: '#a78bfa' }]}>
            <Text style={[styles.badgeText, isLightTheme && styles.badgeTextLight]}>
              Reservado {Number(item.reserved || 0).toLocaleString('es-CO')}
            </Text>
          </View>
          <View style={[styles.badge, isLightTheme && styles.badgeLight, { borderColor: '#34d399' }]}>
            <Text style={[styles.badgeText, isLightTheme && styles.badgeTextLight]}>
              Costo {formatMoneyValue(item.unit_cost || 0)}
            </Text>
          </View>
        </View>

        <Text style={[styles.note, isLightTheme && styles.noteLight]}>
          {item.expiration_date
            ? `Vence: ${new Date(`${item.expiration_date}T00:00:00`).toLocaleDateString('es-CO')} · ${formatDaysToExpiry(alert.daysToExpiry)}`
            : 'Sin fecha de vencimiento'}
        </Text>

        {item.notes ? (
          <Text style={[styles.note, isLightTheme && styles.noteLight]} numberOfLines={3}>
            Nota: {item.notes}
          </Text>
        ) : null}

        <View style={styles.actionsRow}>
          <Pressable
            style={[styles.actionBtn, isLightTheme && styles.actionBtnLight, offlineMode && styles.actionBtnDisabled]}
            disabled={offlineMode}
            onPress={() => openEditBatch(item)}
          >
            <Text style={[styles.actionBtnText, isLightTheme && styles.actionBtnTextLight]}>Editar</Text>
          </Pressable>
          <Pressable
            style={[styles.actionBtn, isLightTheme && styles.actionBtnLight]}
            onPress={() => openTraceability(item)}
          >
            <Text style={[styles.actionBtnText, isLightTheme && styles.actionBtnTextLight]}>Trazabilidad</Text>
          </Pressable>
        </View>
      </View>
    );
  };

  return (
    <View style={[styles.container, isLightTheme && styles.containerLight]}>
      <View style={styles.tabsRow}>
        {TABS.map((entry) => {
          const active = tab === entry.key;
          return (
            <Pressable
              key={entry.key}
              style={[
                styles.tabBtn,
                isLightTheme && styles.tabBtnLight,
                active && styles.tabBtnActive,
              ]}
              onPress={() => setTab(entry.key)}
            >
              <Ionicons
                name={entry.icon}
                size={16}
                color={active ? '#eff6ff' : isLightTheme ? '#235ea9' : '#93c5fd'}
              />
              <Text
                style={[
                  styles.tabBtnText,
                  isLightTheme && styles.tabBtnTextLight,
                  active && styles.tabBtnTextActive,
                ]}
              >
                {entry.label}
              </Text>
            </Pressable>
          );
        })}
      </View>

      <CollapsibleFilterSection
        title="Filtros de lotes"
        themeMode={resolvedThemeMode}
        defaultCollapsed={false}
        activeCount={activeFiltersCount}
        summary={`${filters?.location_id ? 'Sede filtrada' : 'Todas las sedes'} · ${filters?.alert_level || 'todos los estados'}`}
      >
        <SearchableSelectField
          title="Sede"
          themeMode={resolvedThemeMode}
          valueLabel={locationOptions.find((item) => item.key === filters?.location_id)?.label || 'Todas las sedes'}
          clearLabel="Todas las sedes"
          placeholder="Todas las sedes"
          searchPlaceholder="Buscar sede..."
          options={locationOptions}
          selectedKey={filters?.location_id || ''}
          onSelect={(nextValue) => updateFilters({ location_id: nextValue || '' })}
        />

        <SearchableSelectField
          title="Nivel de alerta"
          themeMode={resolvedThemeMode}
          valueLabel={ALERT_FILTER_OPTIONS.find((item) => item.key === filters?.alert_level)?.label || 'Todos'}
          clearLabel="Todos"
          placeholder="Todos"
          searchPlaceholder="Buscar nivel..."
          options={alertFilterSelectOptions}
          selectedKey={filters?.alert_level || ''}
          onSelect={(nextValue) => updateFilters({ alert_level: nextValue || '' })}
        />

        <Text style={[styles.fieldLabel, isLightTheme && styles.fieldLabelLight]}>Buscar por lote</Text>
        <TextInput
          value={filters?.search || ''}
          onChangeText={(value) => updateFilters({ search: value })}
          placeholder="Ej: BATCH-JEAN-001"
          placeholderTextColor="#64748b"
          style={[styles.input, isLightTheme && styles.inputLight]}
        />
      </CollapsibleFilterSection>

      {tab === 'batches' ? (
        <PaginatedList
          themeMode={resolvedThemeMode}
          title="Gestión de lotes"
          loading={loading}
          refreshing={refreshing}
          onRefresh={reload}
          error={error}
          items={items}
          emptyText="No hay lotes para este filtro."
          page={page}
          totalPages={totalPages}
          onPrev={() => changePage(page - 1)}
          onNext={() => changePage(page + 1)}
          footerMeta={
            cacheInfo?.source === 'cache' && cacheInfo?.cachedAt
              ? `Caché offline: ${new Date(cacheInfo.cachedAt).toLocaleString('es-CO')}`
              : offlineMode
                ? 'Vista en modo offline. La creación y edición quedan deshabilitadas.'
                : null
          }
          headerRight={(
            <ListHeaderActionButton
              label="Nuevo lote"
              onPress={openCreateBatch}
              themeMode={resolvedThemeMode}
              disabled={offlineMode}
            />
          )}
          renderItem={renderBatchItem}
        />
      ) : null}

      {tab === 'alerts' ? (
        <View style={[styles.panel, isLightTheme && styles.panelLight]}>
          <View style={styles.panelHeader}>
            <Text style={[styles.panelTitle, isLightTheme && styles.panelTitleLight]}>Alertas de vencimiento</Text>
            {alertsLoading ? <ActivityIndicator color={isLightTheme ? '#235ea9' : '#93c5fd'} /> : null}
          </View>
          {alertsError ? <Text style={styles.errorText}>{alertsError}</Text> : null}
          <ScrollView contentContainerStyle={styles.panelScrollContent}>
            {alertsRows.length === 0 && !alertsLoading ? (
              <Text style={[styles.emptyText, isLightTheme && styles.emptyTextLight]}>
                No hay alertas para el filtro actual.
              </Text>
            ) : null}
            {alertsRows.map((item) => (
              <View key={item.batch_id || `${item.batch_number}-${item.expiration_date}`} style={[styles.card, isLightTheme && styles.cardLight]}>
                <View style={styles.cardHeader}>
                  <View style={styles.cardHeaderCopy}>
                    <Text style={[styles.cardTitle, isLightTheme && styles.cardTitleLight]}>
                      {item.product_name || 'Producto'}
                    </Text>
                    <Text style={[styles.cardSubtitle, isLightTheme && styles.cardSubtitleLight]}>
                      Lote {item.batch_number || '-'} · SKU {item.sku || '-'}
                    </Text>
                  </View>
                  <View style={[styles.alertPill, { borderColor: buildBatchAlertMeta(item.expiration_date).color, backgroundColor: `${buildBatchAlertMeta(item.expiration_date).color}22` }]}>
                    <Text style={[styles.alertPillText, { color: buildBatchAlertMeta(item.expiration_date).color }]}>
                      {item.alert_level || buildBatchAlertMeta(item.expiration_date).level}
                    </Text>
                  </View>
                </View>
                <Text style={[styles.meta, isLightTheme && styles.metaLight]}>
                  {item.location_name || item.location?.name || 'Sin sede'} · {formatDaysToExpiry(
                    item.days_to_expiry === null || item.days_to_expiry === undefined ? NaN : Number(item.days_to_expiry),
                  )}
                </Text>
                <Text style={[styles.note, isLightTheme && styles.noteLight]}>
                  Valor en riesgo: {formatMoneyValue(item.total_value || item.total_value_at_risk || 0)}
                </Text>
              </View>
            ))}
          </ScrollView>
        </View>
      ) : null}

      {tab === 'reports' ? (
        <View style={[styles.panel, isLightTheme && styles.panelLight]}>
          <View style={styles.panelHeader}>
            <Text style={[styles.panelTitle, isLightTheme && styles.panelTitleLight]}>Reportes de vencimiento</Text>
            {reportsLoading ? <ActivityIndicator color={isLightTheme ? '#235ea9' : '#93c5fd'} /> : null}
          </View>
          {reportsError ? <Text style={styles.errorText}>{reportsError}</Text> : null}
          <ScrollView contentContainerStyle={styles.panelScrollContent}>
            <Text style={[styles.sectionLabel, isLightTheme && styles.sectionLabelLight]}>Dashboard por sede</Text>
            <View style={styles.dashboardGrid}>
              {dashboardRows.length === 0 && !reportsLoading ? (
                <Text style={[styles.emptyText, isLightTheme && styles.emptyTextLight]}>
                  No hay datos de dashboard para el tenant actual.
                </Text>
              ) : null}
              {dashboardRows.map((row) => (
                <View key={row.location_id || row.location_name} style={[styles.dashboardCard, isLightTheme && styles.dashboardCardLight]}>
                  <Text style={[styles.dashboardTitle, isLightTheme && styles.dashboardTitleLight]}>
                    {row.location_name || 'Sin sede'}
                  </Text>
                  <Text style={[styles.dashboardLine, isLightTheme && styles.dashboardLineLight]}>
                    Vencidos: {Number(row.expired_count || 0)}
                  </Text>
                  <Text style={[styles.dashboardLine, isLightTheme && styles.dashboardLineLight]}>
                    Críticos: {Number(row.critical_count || 0)}
                  </Text>
                  <Text style={[styles.dashboardLine, isLightTheme && styles.dashboardLineLight]}>
                    Advertencia: {Number(row.warning_count || 0)}
                  </Text>
                  <Text style={[styles.dashboardValue, isLightTheme && styles.dashboardValueLight]}>
                    Riesgo: {formatMoneyValue(row.total_value_at_risk || 0)}
                  </Text>
                </View>
              ))}
            </View>

            <Text style={[styles.sectionLabel, isLightTheme && styles.sectionLabelLight]}>Top productos en riesgo</Text>
            {topAtRiskRows.length === 0 && !reportsLoading ? (
              <Text style={[styles.emptyText, isLightTheme && styles.emptyTextLight]}>
                No hay productos en riesgo con el filtro actual.
              </Text>
            ) : null}
            {topAtRiskRows.map((item, index) => (
              <View key={item.variant_id || `${item.sku}-${index}`} style={[styles.card, isLightTheme && styles.cardLight]}>
                <Text style={[styles.cardTitle, isLightTheme && styles.cardTitleLight]}>
                  {item.product_name || 'Producto'}
                </Text>
                <Text style={[styles.cardSubtitle, isLightTheme && styles.cardSubtitleLight]}>
                  SKU {item.sku || '-'} · {Number(item.batches_count || 0)} lote(s)
                </Text>
                <Text style={[styles.note, isLightTheme && styles.noteLight]}>
                  Vence en {Number(item.days_to_expiry || 0)} día(s) · {formatMoneyValue(item.total_value || 0)}
                </Text>
              </View>
            ))}
          </ScrollView>
        </View>
      ) : null}

      <BottomSheetModal
        visible={batchModalOpen}
        onClose={() => setBatchModalOpen(false)}
        themeMode={resolvedThemeMode}
        maxHeight="92%"
        footer={(
          <View style={styles.modalFooter}>
            <Pressable
              style={[styles.footerBtn, isLightTheme && styles.footerBtnLight]}
              onPress={() => setBatchModalOpen(false)}
            >
              <Text style={[styles.footerBtnText, isLightTheme && styles.footerBtnTextLight]}>Cerrar</Text>
            </Pressable>
            <Pressable
              style={[styles.footerPrimaryBtn, batchSaving && styles.actionBtnDisabled]}
              disabled={batchSaving}
              onPress={submitBatch}
            >
              <Text style={styles.footerPrimaryText}>{batchSaving ? 'Guardando...' : 'Guardar lote'}</Text>
            </Pressable>
          </View>
        )}
      >
        <Text style={[styles.modalTitle, isLightTheme && styles.modalTitleLight]}>
          {batchForm.batch_id ? 'Editar lote' : 'Nuevo lote'}
        </Text>
        <Text style={[styles.modalSubtitle, isLightTheme && styles.modalSubtitleLight]}>
          Crea ajustes manuales de lotes o corrige datos de vencimiento y ubicación física.
        </Text>
        {batchError ? <Text style={styles.errorText}>{batchError}</Text> : null}

        <SearchableSelectField
          title="Sede"
          themeMode={resolvedThemeMode}
          valueLabel={locationOptions.find((item) => item.key === batchForm.location_id)?.label || 'Seleccionar sede'}
          placeholder="Seleccionar sede"
          options={locationOptions}
          selectedKey={batchForm.location_id || ''}
          onSelect={(nextValue) => setBatchForm((prev) => ({ ...prev, location_id: nextValue || '' }))}
          allowClear={false}
        />

        <SearchableSelectField
          title="Producto / variante"
          themeMode={resolvedThemeMode}
          valueLabel={batchForm.variant_label || 'Seleccionar producto'}
          placeholder="Seleccionar producto"
          searchPlaceholder="Buscar producto..."
          options={variantSelectOptions}
          selectedKey={batchForm.variant_id || ''}
          onSelect={handleSelectVariant}
          onSearchQueryChange={loadVariantOptions}
          loadingOptions={variantsLoading}
          allowClear={false}
        />

        <Text style={[styles.fieldLabel, isLightTheme && styles.fieldLabelLight]}>Número de lote</Text>
        <View style={styles.batchRow}>
          <TextInput
            value={batchForm.batch_number}
            onChangeText={(value) => setBatchForm((prev) => ({ ...prev, batch_number: value }))}
            placeholder="Auto si lo dejas vacío"
            placeholderTextColor="#64748b"
            style={[styles.input, isLightTheme && styles.inputLight, styles.batchInputWrap]}
          />
          <Pressable
            style={[styles.inlineBtn, isLightTheme && styles.inlineBtnLight]}
            onPress={handleGenerateBatchNumber}
          >
            <Text style={[styles.inlineBtnText, isLightTheme && styles.inlineBtnTextLight]}>Generar</Text>
          </Pressable>
        </View>

        <DatePickerField
          label="Fecha de vencimiento"
          value={batchForm.expiration_date || ''}
          onChange={(value) => setBatchForm((prev) => ({ ...prev, expiration_date: value || '' }))}
        />

        <Text style={[styles.fieldLabel, isLightTheme && styles.fieldLabelLight]}>Cantidad inicial</Text>
        <TextInput
          value={batchForm.on_hand}
          onChangeText={(value) => setBatchForm((prev) => ({ ...prev, on_hand: value }))}
          placeholder="0"
          placeholderTextColor="#64748b"
          keyboardType="numeric"
          style={[styles.input, isLightTheme && styles.inputLight]}
        />

        <Text style={[styles.fieldLabel, isLightTheme && styles.fieldLabelLight]}>Costo unitario</Text>
        <TextInput
          value={batchForm.unit_cost}
          onChangeText={(value) => setBatchForm((prev) => ({ ...prev, unit_cost: value }))}
          placeholder="0"
          placeholderTextColor="#64748b"
          keyboardType="numeric"
          style={[styles.input, isLightTheme && styles.inputLight]}
        />

        <Text style={[styles.fieldLabel, isLightTheme && styles.fieldLabelLight]}>Ubicación física</Text>
        <TextInput
          value={batchForm.physical_location}
          onChangeText={(value) => setBatchForm((prev) => ({ ...prev, physical_location: value }))}
          placeholder="Ej: estante 2, cuarto frío"
          placeholderTextColor="#64748b"
          style={[styles.input, isLightTheme && styles.inputLight]}
        />

        <Text style={[styles.fieldLabel, isLightTheme && styles.fieldLabelLight]}>Notas</Text>
        <TextInput
          value={batchForm.notes}
          onChangeText={(value) => setBatchForm((prev) => ({ ...prev, notes: value }))}
          placeholder="Detalle operativo del lote"
          placeholderTextColor="#64748b"
          multiline
          style={[styles.input, styles.inputMulti, isLightTheme && styles.inputLight]}
        />
      </BottomSheetModal>

      <BottomSheetModal
        visible={traceabilityOpen}
        onClose={() => setTraceabilityOpen(false)}
        themeMode={resolvedThemeMode}
        maxHeight="86%"
      >
        <Text style={[styles.modalTitle, isLightTheme && styles.modalTitleLight]}>
          Trazabilidad {traceabilityBatchLabel ? `· ${traceabilityBatchLabel}` : ''}
        </Text>
        <Text style={[styles.modalSubtitle, isLightTheme && styles.modalSubtitleLight]}>
          Historial de movimientos o salidas asociados al lote seleccionado.
        </Text>
        {traceabilityError ? <Text style={styles.errorText}>{traceabilityError}</Text> : null}
        {traceabilityLoading ? <ActivityIndicator color={isLightTheme ? '#235ea9' : '#93c5fd'} style={styles.traceabilityLoading} /> : null}
        {!traceabilityLoading && traceabilityRows.length === 0 ? (
          <Text style={[styles.emptyText, isLightTheme && styles.emptyTextLight]}>
            Aún no hay trazabilidad registrada para este lote.
          </Text>
        ) : null}
        {traceabilityRows.map((row, index) => (
          <View key={row.sale_line_batch_id || row.sale_id || index} style={[styles.card, isLightTheme && styles.cardLight]}>
            <Text style={[styles.cardTitle, isLightTheme && styles.cardTitleLight]}>
              {row.customer_name || row.sale_number || 'Movimiento de lote'}
            </Text>
            <Text style={[styles.cardSubtitle, isLightTheme && styles.cardSubtitleLight]}>
              Venta {row.sale_number || '-'} · Cantidad {Number(row.quantity || row.qty || 0).toLocaleString('es-CO')}
            </Text>
            <Text style={[styles.note, isLightTheme && styles.noteLight]}>
              {row.sold_at ? new Date(row.sold_at).toLocaleString('es-CO') : 'Sin fecha de salida'}
            </Text>
          </View>
        ))}
      </BottomSheetModal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#060b16', padding: 12 },
  containerLight: { backgroundColor: '#edf2fb' },
  tabsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 10,
  },
  tabBtn: {
    minHeight: 40,
    paddingHorizontal: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#254269',
    backgroundColor: '#0f182b',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  tabBtnLight: {
    borderColor: '#d5e2f4',
    backgroundColor: '#ffffff',
  },
  tabBtnActive: {
    borderColor: '#2563eb',
    backgroundColor: '#2563eb',
  },
  tabBtnText: {
    color: '#93c5fd',
    fontWeight: '800',
    fontSize: 12,
  },
  tabBtnTextLight: {
    color: '#235ea9',
  },
  tabBtnTextActive: {
    color: '#eff6ff',
  },
  fieldLabel: {
    color: '#cbd5e1',
    marginTop: 12,
    marginBottom: 6,
    fontWeight: '700',
    fontSize: 13,
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
  fieldLabelLight: {
    color: '#334155',
  },
  input: {
    minHeight: 44,
    borderWidth: 1,
    borderColor: '#334155',
    borderRadius: 10,
    backgroundColor: '#0f172a',
    color: '#e2e8f0',
    paddingHorizontal: 12,
  },
  inputLight: {
    borderColor: '#d5e2f4',
    backgroundColor: '#ffffff',
    color: '#0f172a',
  },
  inputMulti: {
    minHeight: 96,
    textAlignVertical: 'top',
    paddingTop: 10,
    paddingBottom: 10,
  },
  panel: {
    flex: 1,
    borderWidth: 1,
    borderColor: '#223a5e',
    borderRadius: 14,
    backgroundColor: '#0f182b',
    padding: 12,
  },
  panelLight: {
    borderColor: '#d5e2f4',
    backgroundColor: '#ffffff',
  },
  panelHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
    marginBottom: 10,
  },
  panelTitle: {
    color: '#f8fafc',
    fontWeight: '800',
    fontSize: 18,
  },
  panelTitleLight: {
    color: '#0f172a',
  },
  panelScrollContent: {
    paddingBottom: 8,
  },
  sectionLabel: {
    color: '#cbd5e1',
    fontWeight: '800',
    fontSize: 12,
    textTransform: 'uppercase',
    letterSpacing: 0.4,
    marginBottom: 8,
  },
  sectionLabelLight: {
    color: '#334155',
  },
  dashboardGrid: {
    gap: 8,
    marginBottom: 14,
  },
  dashboardCard: {
    borderWidth: 1,
    borderColor: '#254269',
    borderRadius: 12,
    backgroundColor: '#101a2e',
    padding: 12,
  },
  dashboardCardLight: {
    borderColor: '#d5e2f4',
    backgroundColor: '#f8fbff',
  },
  dashboardTitle: {
    color: '#f8fafc',
    fontWeight: '800',
    fontSize: 14,
    marginBottom: 8,
  },
  dashboardTitleLight: {
    color: '#0f172a',
  },
  dashboardLine: {
    color: '#cbd5e1',
    fontSize: 12,
    marginTop: 2,
  },
  dashboardLineLight: {
    color: '#475569',
  },
  dashboardValue: {
    color: '#fca5a5',
    fontWeight: '800',
    fontSize: 13,
    marginTop: 8,
  },
  dashboardValueLight: {
    color: '#b91c1c',
  },
  card: {
    backgroundColor: '#111827',
    borderWidth: 1,
    borderColor: '#1f2937',
    borderRadius: 12,
    padding: 12,
    marginBottom: 8,
  },
  cardLight: { backgroundColor: '#ffffff', borderColor: '#dbe4ef' },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 10,
    alignItems: 'flex-start',
  },
  cardHeaderCopy: {
    flex: 1,
  },
  cardTitle: { color: '#f8fafc', fontWeight: '700', fontSize: 15 },
  cardTitleLight: { color: '#0f172a' },
  cardSubtitle: { color: '#cbd5e1', marginTop: 2, fontSize: 13 },
  cardSubtitleLight: { color: '#475569' },
  meta: { color: '#cbd5e1', marginTop: 6, fontSize: 13 },
  metaLight: { color: '#475569' },
  alertPill: {
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 5,
  },
  alertPillText: {
    fontWeight: '800',
    fontSize: 11,
    textTransform: 'uppercase',
  },
  badgesRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 8 },
  badge: {
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 4,
    backgroundColor: '#0f172a',
  },
  badgeLight: { backgroundColor: '#f8fafc' },
  badgeText: { color: '#e2e8f0', fontSize: 11, fontWeight: '700' },
  badgeTextLight: { color: '#334155' },
  note: { color: '#94a3b8', marginTop: 8, fontSize: 12, lineHeight: 18 },
  noteLight: { color: '#64748b' },
  actionsRow: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 10,
  },
  actionBtn: {
    minHeight: 38,
    paddingHorizontal: 12,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#27446c',
    backgroundColor: '#0b1220',
    alignItems: 'center',
    justifyContent: 'center',
  },
  actionBtnLight: {
    borderColor: '#d5e2f4',
    backgroundColor: '#f8fbff',
  },
  actionBtnDisabled: {
    opacity: 0.5,
  },
  actionBtnText: {
    color: '#93c5fd',
    fontSize: 12,
    fontWeight: '800',
  },
  actionBtnTextLight: {
    color: '#235ea9',
  },
  emptyText: {
    color: '#94a3b8',
    textAlign: 'center',
    paddingVertical: 14,
    lineHeight: 18,
  },
  emptyTextLight: {
    color: '#64748b',
  },
  errorText: {
    color: '#fca5a5',
    marginBottom: 8,
    lineHeight: 18,
  },
  modalTitle: {
    color: '#f8fafc',
    fontSize: 18,
    fontWeight: '800',
  },
  modalTitleLight: {
    color: '#0f172a',
  },
  modalSubtitle: {
    color: '#94a3b8',
    fontSize: 13,
    lineHeight: 18,
    marginTop: 4,
    marginBottom: 6,
  },
  modalSubtitleLight: {
    color: '#64748b',
  },
  batchRow: {
    flexDirection: 'row',
    gap: 8,
    alignItems: 'flex-end',
  },
  batchInputWrap: {
    flex: 1,
  },
  inlineBtn: {
    minHeight: 44,
    paddingHorizontal: 12,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#2563eb',
    backgroundColor: '#1d4ed8',
    alignItems: 'center',
    justifyContent: 'center',
  },
  inlineBtnLight: {
    borderColor: '#2563eb',
    backgroundColor: '#2563eb',
  },
  inlineBtnText: {
    color: '#eff6ff',
    fontWeight: '800',
    fontSize: 12,
  },
  inlineBtnTextLight: {
    color: '#eff6ff',
  },
  modalFooter: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 10,
    marginTop: 8,
  },
  footerBtn: {
    flex: 1,
    minHeight: 42,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#334155',
    backgroundColor: '#0f172a',
    alignItems: 'center',
    justifyContent: 'center',
  },
  footerBtnLight: {
    borderColor: '#d5e2f4',
    backgroundColor: '#ffffff',
  },
  footerBtnText: {
    color: '#e2e8f0',
    fontWeight: '700',
    fontSize: 13,
  },
  footerBtnTextLight: {
    color: '#334155',
  },
  footerPrimaryBtn: {
    flex: 1,
    minHeight: 42,
    borderRadius: 12,
    backgroundColor: '#2563eb',
    alignItems: 'center',
    justifyContent: 'center',
  },
  footerPrimaryText: {
    color: '#eff6ff',
    fontWeight: '800',
    fontSize: 13,
  },
  traceabilityLoading: {
    marginVertical: 16,
  },
});
