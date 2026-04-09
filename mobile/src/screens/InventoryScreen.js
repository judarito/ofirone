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
import BottomSheetModal from '../components/BottomSheetModal';
import PaginatedList from '../components/PaginatedList';
import SearchableSelectField from '../components/SearchableSelectField';
import { usePaginatedList } from '../hooks/usePaginatedList';
import { useAndroidBottomInset } from '../lib/useAndroidBottomInset';
import { useThemeMode } from '../lib/themeMode';
import {
  listInventoryMoves,
  listLocations,
  listStockBalances,
} from '../services/inventoryCatalog.service';
import {
  createManualAdjustment,
  createTransfer,
  getPendingTransfers,
  receiveTransfer,
} from '../services/inventoryOperations.service';
import { searchPurchaseVariants } from '../services/purchases.service';

const TABS = [
  { key: 'stock', label: 'Stock Actual' },
  { key: 'components', label: 'Insumos' },
  { key: 'kardex', label: 'Kardex / Movimientos' },
  { key: 'operations', label: 'Operaciones' },
];

const MOVE_TYPES = [
  '',
  'PURCHASE_IN',
  'SALE_OUT',
  'RETURN_IN',
  'ADJUSTMENT',
  'TRANSFER_OUT',
  'TRANSFER_IN',
  'PRODUCTION_IN',
  'PRODUCTION_OUT',
];

function moveLabel(type) {
  return type || 'Todos';
}

function moveTypeLabel(type) {
  const map = {
    PURCHASE_IN: 'Compra',
    SALE_OUT: 'Venta',
    RETURN_IN: 'Devolucion',
    ADJUSTMENT: 'Ajuste',
    TRANSFER_OUT: 'Traslado salida',
    TRANSFER_IN: 'Traslado entrada',
    PRODUCTION_IN: 'Produccion entrada',
    PRODUCTION_OUT: 'Produccion salida',
  };
  return map[type] || type || '-';
}

function getAlert(item) {
  const onHand = Number(item.on_hand || 0);
  const min = Number(item.variant?.min_stock || 0);
  if (onHand <= 0) return { label: 'Sin stock', color: '#ef4444' };
  if (onHand <= min && min > 0) return { label: 'Stock bajo', color: '#f59e0b' };
  return { label: 'OK', color: '#16a34a' };
}

function parseDecimalInput(value) {
  const normalized = String(value ?? '')
    .replace(/\s+/g, '')
    .replace(',', '.');
  return Number(normalized);
}

function buildVariantLabel(variant) {
  const productName = variant?.product?.name || 'Producto';
  const variantName = variant?.variant_name ? ` - ${variant.variant_name}` : '';
  const sku = variant?.sku ? ` (${variant.sku})` : '';
  return `${productName}${variantName}${sku}`;
}

function createAdjustmentForm(defaultLocationId = '') {
  return {
    location_id: defaultLocationId || '',
    variant_id: '',
    variant_label: '',
    quantity: '1',
    unit_cost: '',
    is_increase: true,
    note: '',
  };
}

function createTransferForm(defaultLocationId = '') {
  return {
    from_location_id: defaultLocationId || '',
    to_location_id: '',
    variant_id: '',
    variant_label: '',
    variant_cost: 0,
    quantity: '1',
    note: '',
  };
}

export default function InventoryScreen({
  tenant,
  userProfile,
  themeMode,
  offlineMode,
  pageSize = 20,
  formatMoney,
}) {
  const themeModeContext = useThemeMode();
  const resolvedThemeMode = themeMode || themeModeContext || 'dark';
  const isLightTheme = resolvedThemeMode === 'light';
  const androidBottomInset = useAndroidBottomInset();
  const [locations, setLocations] = useState([]);
  const [operationError, setOperationError] = useState('');
  const [variantOptions, setVariantOptions] = useState([]);
  const [variantsLoading, setVariantsLoading] = useState(false);
  const [adjusting, setAdjusting] = useState(false);
  const [transferring, setTransferring] = useState(false);
  const [pendingTransfersModalOpen, setPendingTransfersModalOpen] = useState(false);
  const [pendingTransfersLocationId, setPendingTransfersLocationId] = useState('');
  const [pendingTransfersLoading, setPendingTransfersLoading] = useState(false);
  const [pendingTransfers, setPendingTransfers] = useState([]);
  const [receivingTransferId, setReceivingTransferId] = useState('');
  const [adjustForm, setAdjustForm] = useState(() => createAdjustmentForm(''));
  const [transferForm, setTransferForm] = useState(() => createTransferForm(''));
  const mountedRef = useRef(true);
  const variantSearchRequestRef = useRef(0);
  const pendingTransfersRequestRef = useRef(0);

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
    cacheNamespace: 'inventory-main',
    initialFilters: {
      tab: 'stock',
      location_id: '',
      move_type: '',
    },
    fetchPage: async ({ page: nextPage, pageSize: nextPageSize, filters: nextFilters, tenantId }) => {
      if (nextFilters?.tab === 'operations') {
        return { success: true, data: [], total: 0 };
      }

      const offset = (nextPage - 1) * nextPageSize;
      if (nextFilters?.tab === 'kardex') {
        return listInventoryMoves({
          tenantId,
          locationId: nextFilters?.location_id || null,
          moveType: nextFilters?.move_type || null,
          limit: nextPageSize,
          offset,
        });
      }

      return listStockBalances({
        tenantId,
        locationId: nextFilters?.location_id || null,
        isComponent: nextFilters?.tab === 'components',
        limit: nextPageSize,
        offset,
        offlineMode,
      });
    },
  });

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
    setAdjustForm((prev) => (prev.location_id ? prev : { ...prev, location_id: defaultLocationId }));
    setTransferForm((prev) => (prev.from_location_id ? prev : { ...prev, from_location_id: defaultLocationId }));
  }, [defaultLocationId]);

  const money = useMemo(
    () =>
      formatMoney ||
      ((value) => `$ ${Math.round(Number(value || 0)).toLocaleString('es-CO')}`),
    [formatMoney],
  );

  const tabFilterOptions = useMemo(
    () => TABS.map((tab) => ({ key: tab.key, label: tab.label, searchText: tab.label })),
    [],
  );

  const locationFilterOptions = useMemo(
    () =>
      (locations || []).map((loc) => ({
        key: loc.location_id,
        label: loc.name,
        searchText: loc.name,
      })),
    [locations],
  );

  const moveTypeFilterOptions = useMemo(
    () =>
      MOVE_TYPES.filter(Boolean).map((type) => ({
        key: type,
        label: moveLabel(type),
        searchText: moveLabel(type),
      })),
    [],
  );

  const variantSelectOptions = useMemo(
    () =>
      (variantOptions || []).map((variant) => ({
        key: variant.variant_id,
        label: buildVariantLabel(variant),
        searchText: [
          variant.product?.name,
          variant.variant_name,
          variant.sku,
          buildVariantLabel(variant),
        ]
          .filter(Boolean)
          .join(' '),
        raw: variant,
      })),
    [variantOptions],
  );

  const loadVariants = useCallback(async (search = '') => {
    if (offlineMode || !tenant?.tenant_id) return;
    const requestId = variantSearchRequestRef.current + 1;
    variantSearchRequestRef.current = requestId;
    setVariantsLoading(true);
    try {
      const result = await searchPurchaseVariants({
        tenantId: tenant.tenant_id,
        search,
        limit: 40,
      });
      if (!mountedRef.current || requestId !== variantSearchRequestRef.current) return;
      if (result.success) {
        setVariantOptions(result.data || []);
      }
    } finally {
      if (mountedRef.current && requestId === variantSearchRequestRef.current) {
        setVariantsLoading(false);
      }
    }
  }, [offlineMode, tenant?.tenant_id]);

  const loadPendingTransfersList = useCallback(async (overrideLocationId = pendingTransfersLocationId) => {
    if (offlineMode || !tenant?.tenant_id) {
      setPendingTransfers([]);
      return;
    }

    const requestId = pendingTransfersRequestRef.current + 1;
    pendingTransfersRequestRef.current = requestId;
    setPendingTransfersLoading(true);
    try {
      const result = await getPendingTransfers({
        tenantId: tenant.tenant_id,
        toLocationId: overrideLocationId || null,
      });
      if (!mountedRef.current || requestId !== pendingTransfersRequestRef.current) return;
      if (result.success) {
        setPendingTransfers(result.data || []);
      } else {
        setOperationError(result.error || 'No fue posible cargar los traslados pendientes.');
      }
    } finally {
      if (mountedRef.current && requestId === pendingTransfersRequestRef.current) {
        setPendingTransfersLoading(false);
      }
    }
  }, [offlineMode, pendingTransfersLocationId, tenant?.tenant_id]);

  useEffect(() => {
    if (filters?.tab !== 'operations') return;
    setPendingTransfersLocationId('');
    loadPendingTransfersList('');
  }, [filters?.tab, loadPendingTransfersList]);

  const handleSelectAdjustVariant = (nextVariantId) => {
    if (!nextVariantId) {
      setAdjustForm((prev) => ({
        ...prev,
        variant_id: '',
        variant_label: '',
        unit_cost: '',
      }));
      return;
    }

    const selected = variantSelectOptions.find((item) => String(item.key) === String(nextVariantId));
    const variant = selected?.raw || null;
    setAdjustForm((prev) => ({
      ...prev,
      variant_id: nextVariantId,
      variant_label: selected?.label || prev.variant_label,
      unit_cost:
        variant?.cost !== null && variant?.cost !== undefined
          ? String(variant.cost)
          : prev.unit_cost,
    }));
  };

  const handleSelectTransferVariant = (nextVariantId) => {
    if (!nextVariantId) {
      setTransferForm((prev) => ({
        ...prev,
        variant_id: '',
        variant_label: '',
        variant_cost: 0,
      }));
      return;
    }

    const selected = variantSelectOptions.find((item) => String(item.key) === String(nextVariantId));
    const variant = selected?.raw || null;
    setTransferForm((prev) => ({
      ...prev,
      variant_id: nextVariantId,
      variant_label: selected?.label || prev.variant_label,
      variant_cost: Number(variant?.cost || 0),
    }));
  };

  const resetAdjustmentForm = () => {
    setAdjustForm(createAdjustmentForm(defaultLocationId));
  };

  const resetTransferForm = () => {
    setTransferForm(createTransferForm(defaultLocationId));
  };

  const submitAdjustment = async () => {
    if (offlineMode) {
      setOperationError('Inventario no permite registrar ajustes en modo offline.');
      return;
    }
    if (!tenant?.tenant_id || !userProfile?.user_id) {
      setOperationError('Necesitas un tenant y usuario validos para registrar ajustes.');
      return;
    }
    if (!adjustForm.location_id) {
      setOperationError('Selecciona la sede del ajuste.');
      return;
    }
    if (!adjustForm.variant_id) {
      setOperationError('Selecciona el producto o variante para el ajuste.');
      return;
    }

    const quantity = parseDecimalInput(adjustForm.quantity);
    const unitCost = parseDecimalInput(adjustForm.unit_cost || '0');

    if (!Number.isFinite(quantity) || quantity <= 0) {
      setOperationError('La cantidad del ajuste debe ser mayor a 0.');
      return;
    }
    if (!Number.isFinite(unitCost) || unitCost < 0) {
      setOperationError('El costo unitario del ajuste debe ser mayor o igual a 0.');
      return;
    }

    setOperationError('');
    setAdjusting(true);
    try {
      const result = await createManualAdjustment({
        tenantId: tenant.tenant_id,
        locationId: adjustForm.location_id,
        variantId: adjustForm.variant_id,
        quantity,
        unitCost,
        isIncrease: adjustForm.is_increase,
        note: String(adjustForm.note || '').trim() || null,
        createdBy: userProfile.user_id,
      });

      if (!result.success) {
        setOperationError(result.error || 'No fue posible registrar el ajuste.');
        return;
      }

      resetAdjustmentForm();
      Alert.alert('Ajuste registrado', 'El movimiento manual de inventario se guardo correctamente.');
    } finally {
      setAdjusting(false);
    }
  };

  const submitTransfer = async () => {
    if (offlineMode) {
      setOperationError('Inventario no permite registrar traslados en modo offline.');
      return;
    }
    if (!tenant?.tenant_id || !userProfile?.user_id) {
      setOperationError('Necesitas un tenant y usuario validos para registrar traslados.');
      return;
    }
    if (!transferForm.from_location_id || !transferForm.to_location_id) {
      setOperationError('Selecciona la sede origen y la sede destino.');
      return;
    }
    if (String(transferForm.from_location_id) === String(transferForm.to_location_id)) {
      setOperationError('La sede destino debe ser diferente a la sede origen.');
      return;
    }
    if (!transferForm.variant_id) {
      setOperationError('Selecciona el producto o variante para el traslado.');
      return;
    }

    const quantity = parseDecimalInput(transferForm.quantity);
    if (!Number.isFinite(quantity) || quantity <= 0) {
      setOperationError('La cantidad del traslado debe ser mayor a 0.');
      return;
    }

    setOperationError('');
    setTransferring(true);
    try {
      const result = await createTransfer({
        tenantId: tenant.tenant_id,
        fromLocationId: transferForm.from_location_id,
        toLocationId: transferForm.to_location_id,
        variantId: transferForm.variant_id,
        quantity,
        unitCost: Number(transferForm.variant_cost || 0),
        note: String(transferForm.note || '').trim() || null,
        createdBy: userProfile.user_id,
      });

      if (!result.success) {
        setOperationError(result.error || 'No fue posible registrar el traslado.');
        return;
      }

      resetTransferForm();
      await loadPendingTransfersList('');
      Alert.alert('Traslado registrado', 'El traslado quedo enviado en transito.');
    } finally {
      setTransferring(false);
    }
  };

  const openPendingTransfersModal = async () => {
    if (offlineMode) {
      setOperationError('Recibir traslados requiere conexion.');
      return;
    }
    setOperationError('');
    setPendingTransfersModalOpen(true);
    await loadPendingTransfersList(pendingTransfersLocationId);
  };

  const handleReceiveTransfer = async (transferItem) => {
    if (!tenant?.tenant_id || !userProfile?.user_id || !transferItem?.transfer_id) {
      setOperationError('No se pudo identificar el traslado a recibir.');
      return;
    }

    setOperationError('');
    setReceivingTransferId(transferItem.transfer_id);
    try {
      const result = await receiveTransfer({
        tenantId: tenant.tenant_id,
        transferId: transferItem.transfer_id,
        receivedBy: userProfile.user_id,
        note: transferItem.note || null,
      });

      if (!result.success) {
        setOperationError(result.error || 'No fue posible recibir el traslado.');
        return;
      }

      await loadPendingTransfersList(pendingTransfersLocationId);
      Alert.alert('Traslado recibido', 'El traslado ya ingreso a la sede destino.');
    } finally {
      setReceivingTransferId('');
    }
  };

  const renderInventoryList = () => (
    <PaginatedList
      themeMode={resolvedThemeMode}
      title={
        filters?.tab === 'kardex'
          ? 'Kardex / Movimientos'
          : filters?.tab === 'components'
            ? 'Insumos por sede'
            : 'Stock por sede'
      }
      loading={loading}
      refreshing={refreshing}
      onRefresh={reload}
      error={error}
      items={items}
      emptyText="No hay registros para este filtro."
      page={page}
      totalPages={totalPages}
      onPrev={() => changePage(page - 1)}
      onNext={() => changePage(page + 1)}
      footerMeta={
        cacheInfo?.source === 'cache' && cacheInfo?.cachedAt
          ? `Cache offline: ${new Date(cacheInfo.cachedAt).toLocaleString()}`
          : null
      }
      renderItem={(item) =>
        filters?.tab === 'kardex' ? (
          <View key={item.inventory_move_id} style={[styles.card, isLightTheme && styles.cardLight]}>
            <Text style={[styles.title, isLightTheme && styles.titleLight]}>
              {item.variant?.product?.name || 'Producto'}
            </Text>
            <Text style={[styles.meta, isLightTheme && styles.metaLight]}>
              {item.variant?.sku || '-'} - {item.variant?.variant_name || '-'}
            </Text>
            <View style={[styles.kardexRows, isLightTheme && styles.kardexRowsLight]}>
              <View style={styles.kardexRow}>
                <Text style={[styles.kardexLabel, isLightTheme && styles.kardexLabelLight]}>Fecha</Text>
                <Text style={[styles.kardexValue, isLightTheme && styles.kardexValueLight]}>
                  {new Date(item.created_at).toLocaleString()}
                </Text>
              </View>
              <View style={styles.kardexRow}>
                <Text style={[styles.kardexLabel, isLightTheme && styles.kardexLabelLight]}>Sede</Text>
                <Text style={[styles.kardexValue, isLightTheme && styles.kardexValueLight]}>
                  {item.location?.name || 'Sin sede'}
                </Text>
              </View>
              <View style={styles.kardexRow}>
                <Text style={[styles.kardexLabel, isLightTheme && styles.kardexLabelLight]}>Tipo</Text>
                <Text style={[styles.kardexValue, isLightTheme && styles.kardexValueLight]}>
                  {moveTypeLabel(item.move_type)}
                </Text>
              </View>
              <View style={styles.kardexRow}>
                <Text style={[styles.kardexLabel, isLightTheme && styles.kardexLabelLight]}>Cantidad</Text>
                <Text
                  style={[
                    styles.kardexValue,
                    isLightTheme && styles.kardexValueLight,
                    Number(item.quantity || 0) >= 0 ? styles.qtyPositive : styles.qtyNegative,
                  ]}
                >
                  {Number(item.quantity || 0) >= 0 ? '+' : ''}
                  {Number(item.quantity || 0).toLocaleString('es-CO')}
                </Text>
              </View>
              <View style={styles.kardexRow}>
                <Text style={[styles.kardexLabel, isLightTheme && styles.kardexLabelLight]}>Costo unitario</Text>
                <Text style={[styles.kardexValue, isLightTheme && styles.kardexValueLight]}>
                  {money(item.unit_cost || 0)}
                </Text>
              </View>
              <View style={styles.kardexRow}>
                <Text style={[styles.kardexLabel, isLightTheme && styles.kardexLabelLight]}>Origen</Text>
                <Text style={[styles.kardexValue, isLightTheme && styles.kardexValueLight]}>
                  {item.source || '-'}
                </Text>
              </View>
              <View style={styles.kardexRow}>
                <Text style={[styles.kardexLabel, isLightTheme && styles.kardexLabelLight]}>Usuario</Text>
                <Text style={[styles.kardexValue, isLightTheme && styles.kardexValueLight]}>
                  {item.created_by_user?.full_name || '-'}
                </Text>
              </View>
            </View>
            {item.note ? (
              <Text style={[styles.note, isLightTheme && styles.noteLight]}>{item.note}</Text>
            ) : null}
          </View>
        ) : (
          <View key={`${item.location_id}-${item.variant_id}`} style={[styles.card, isLightTheme && styles.cardLight]}>
            <Text style={[styles.title, isLightTheme && styles.titleLight]}>
              {item.variant?.product?.name || 'Producto'}
            </Text>
            <Text style={[styles.meta, isLightTheme && styles.metaLight]}>
              {item.variant?.sku || '-'} - {item.variant?.variant_name || '-'}
            </Text>
            <Text style={[styles.meta, isLightTheme && styles.metaLight]}>
              {item.location?.name || 'Sin sede'}
            </Text>
            <View style={styles.badgesRow}>
              <View style={[styles.badge, isLightTheme && styles.badgeLight, { borderColor: '#38bdf8' }]}>
                <Text style={[styles.badgeText, isLightTheme && styles.badgeTextLight]}>
                  Stock {Number(item.on_hand || 0).toLocaleString('es-CO')}
                </Text>
              </View>
              <View style={[styles.badge, isLightTheme && styles.badgeLight, { borderColor: '#a78bfa' }]}>
                <Text style={[styles.badgeText, isLightTheme && styles.badgeTextLight]}>
                  Min {Number(item.variant?.min_stock || 0).toLocaleString('es-CO')}
                </Text>
              </View>
              <View style={[styles.badge, isLightTheme && styles.badgeLight, { borderColor: getAlert(item).color }]}>
                <Text style={[styles.badgeText, isLightTheme && styles.badgeTextLight]}>
                  {getAlert(item).label}
                </Text>
              </View>
            </View>
            <Text style={[styles.note, isLightTheme && styles.noteLight]}>
              Costo {money(item.variant?.cost || 0)} - Valor {money(Number(item.on_hand || 0) * Number(item.variant?.cost || 0))}
            </Text>
          </View>
        )
      }
    />
  );

  const renderOperations = () => (
    <ScrollView
      style={styles.operationsScroll}
      contentContainerStyle={[styles.operationsContent, { paddingBottom: 20 + androidBottomInset }]}
      keyboardShouldPersistTaps="handled"
    >
      <View style={[styles.noticeBox, isLightTheme && styles.noticeBoxLight]}>
        <Text style={[styles.noticeText, isLightTheme && styles.noticeTextLight]}>
          Ajustes y traslados usan backend online. Si estas sin conexion, este bloque queda en solo lectura.
        </Text>
      </View>

      {operationError ? (
        <View style={[styles.operationErrorBox, isLightTheme && styles.operationErrorBoxLight]}>
          <Text style={styles.operationErrorText}>{operationError}</Text>
        </View>
      ) : null}

      <View style={[styles.operationCard, isLightTheme && styles.operationCardLight]}>
        <Text style={[styles.operationTitle, isLightTheme && styles.operationTitleLight]}>
          Ajuste de Inventario
        </Text>

        <SearchableSelectField
          title="Sede"
          themeMode={resolvedThemeMode}
          valueLabel={
            locationFilterOptions.find((item) => String(item.key) === String(adjustForm.location_id))?.label ||
            'Seleccionar sede'
          }
          clearLabel="Sin sede"
          placeholder="Seleccionar sede"
          searchPlaceholder="Buscar sede..."
          options={locationFilterOptions}
          selectedKey={adjustForm.location_id}
          allowClear={false}
          disabled={offlineMode}
          onSelect={(nextValue) => setAdjustForm((prev) => ({ ...prev, location_id: nextValue || '' }))}
        />

        <SearchableSelectField
          title="Producto / Variante"
          themeMode={resolvedThemeMode}
          valueLabel={adjustForm.variant_label || 'Buscar producto/variante'}
          clearLabel="Sin producto"
          placeholder="Buscar producto/variante"
          searchPlaceholder="Buscar producto o SKU..."
          options={variantSelectOptions}
          selectedKey={adjustForm.variant_id}
          disabled={offlineMode}
          onSelect={handleSelectAdjustVariant}
          onSearchQueryChange={loadVariants}
          loadingOptions={variantsLoading}
          emptyText="No hay productos para esa busqueda."
        />

        <Text style={[styles.fieldLabel, isLightTheme && styles.fieldLabelLight]}>Tipo de ajuste</Text>
        <View style={styles.toggleRow}>
          <Pressable
            style={[
              styles.toggleBtn,
              isLightTheme && styles.toggleBtnLight,
              adjustForm.is_increase && styles.toggleBtnActive,
              adjustForm.is_increase && isLightTheme && styles.toggleBtnActiveLight,
            ]}
            onPress={() => setAdjustForm((prev) => ({ ...prev, is_increase: true }))}
            disabled={offlineMode}
          >
            <Text
              style={[
                styles.toggleBtnText,
                isLightTheme && styles.toggleBtnTextLight,
                adjustForm.is_increase && styles.toggleBtnTextActive,
              ]}
            >
              Entrada (+)
            </Text>
          </Pressable>
          <Pressable
            style={[
              styles.toggleBtn,
              isLightTheme && styles.toggleBtnLight,
              !adjustForm.is_increase && styles.toggleBtnDangerActive,
              !adjustForm.is_increase && isLightTheme && styles.toggleBtnDangerActiveLight,
            ]}
            onPress={() => setAdjustForm((prev) => ({ ...prev, is_increase: false }))}
            disabled={offlineMode}
          >
            <Text
              style={[
                styles.toggleBtnText,
                isLightTheme && styles.toggleBtnTextLight,
                !adjustForm.is_increase && styles.toggleBtnTextDangerActive,
              ]}
            >
              Salida (-)
            </Text>
          </Pressable>
        </View>

        <Text style={[styles.fieldLabel, isLightTheme && styles.fieldLabelLight]}>Cantidad</Text>
        <TextInput
          style={[styles.input, isLightTheme && styles.inputLight]}
          value={adjustForm.quantity}
          onChangeText={(value) => setAdjustForm((prev) => ({ ...prev, quantity: value }))}
          placeholder="1"
          placeholderTextColor="#64748b"
          keyboardType="numeric"
          editable={!offlineMode}
        />

        <Text style={[styles.fieldLabel, isLightTheme && styles.fieldLabelLight]}>Costo unitario</Text>
        <TextInput
          style={[styles.input, isLightTheme && styles.inputLight]}
          value={adjustForm.unit_cost}
          onChangeText={(value) => setAdjustForm((prev) => ({ ...prev, unit_cost: value }))}
          placeholder="0"
          placeholderTextColor="#64748b"
          keyboardType="numeric"
          editable={!offlineMode}
        />

        <Text style={[styles.fieldLabel, isLightTheme && styles.fieldLabelLight]}>Nota</Text>
        <TextInput
          style={[styles.input, styles.noteInput, isLightTheme && styles.inputLight]}
          value={adjustForm.note}
          onChangeText={(value) => setAdjustForm((prev) => ({ ...prev, note: value }))}
          placeholder="Explica por que se hace el ajuste"
          placeholderTextColor="#64748b"
          multiline
          editable={!offlineMode}
        />

        <Pressable
          style={[
            styles.primaryActionBtn,
            styles.warningActionBtn,
            (offlineMode || adjusting) && styles.actionDisabled,
          ]}
          onPress={submitAdjustment}
          disabled={offlineMode || adjusting}
        >
          <Text style={styles.primaryActionBtnText}>
            {adjusting ? 'Registrando ajuste...' : 'Registrar Ajuste'}
          </Text>
        </Pressable>
      </View>

      <View style={[styles.operationCard, isLightTheme && styles.operationCardLight]}>
        <Text style={[styles.operationTitle, isLightTheme && styles.operationTitleLight]}>
          Traslado entre Sedes
        </Text>

        <SearchableSelectField
          title="Sede origen"
          themeMode={resolvedThemeMode}
          valueLabel={
            locationFilterOptions.find((item) => String(item.key) === String(transferForm.from_location_id))?.label ||
            'Seleccionar sede origen'
          }
          clearLabel="Sin sede"
          placeholder="Seleccionar sede origen"
          searchPlaceholder="Buscar sede..."
          options={locationFilterOptions}
          selectedKey={transferForm.from_location_id}
          allowClear={false}
          disabled={offlineMode}
          onSelect={(nextValue) => setTransferForm((prev) => ({ ...prev, from_location_id: nextValue || '' }))}
        />

        <SearchableSelectField
          title="Sede destino"
          themeMode={resolvedThemeMode}
          valueLabel={
            locationFilterOptions.find((item) => String(item.key) === String(transferForm.to_location_id))?.label ||
            'Seleccionar sede destino'
          }
          clearLabel="Sin sede"
          placeholder="Seleccionar sede destino"
          searchPlaceholder="Buscar sede..."
          options={locationFilterOptions}
          selectedKey={transferForm.to_location_id}
          allowClear={false}
          disabled={offlineMode}
          onSelect={(nextValue) => setTransferForm((prev) => ({ ...prev, to_location_id: nextValue || '' }))}
        />

        <SearchableSelectField
          title="Producto / Variante"
          themeMode={resolvedThemeMode}
          valueLabel={transferForm.variant_label || 'Buscar producto/variante'}
          clearLabel="Sin producto"
          placeholder="Buscar producto/variante"
          searchPlaceholder="Buscar producto o SKU..."
          options={variantSelectOptions}
          selectedKey={transferForm.variant_id}
          disabled={offlineMode}
          onSelect={handleSelectTransferVariant}
          onSearchQueryChange={loadVariants}
          loadingOptions={variantsLoading}
          emptyText="No hay productos para esa busqueda."
        />

        <Text style={[styles.fieldLabel, isLightTheme && styles.fieldLabelLight]}>Cantidad</Text>
        <TextInput
          style={[styles.input, isLightTheme && styles.inputLight]}
          value={transferForm.quantity}
          onChangeText={(value) => setTransferForm((prev) => ({ ...prev, quantity: value }))}
          placeholder="1"
          placeholderTextColor="#64748b"
          keyboardType="numeric"
          editable={!offlineMode}
        />

        <Text style={[styles.fieldLabel, isLightTheme && styles.fieldLabelLight]}>Nota</Text>
        <TextInput
          style={[styles.input, styles.noteInput, isLightTheme && styles.inputLight]}
          value={transferForm.note}
          onChangeText={(value) => setTransferForm((prev) => ({ ...prev, note: value }))}
          placeholder="Motivo o referencia del traslado"
          placeholderTextColor="#64748b"
          multiline
          editable={!offlineMode}
        />

        <Pressable
          style={[
            styles.primaryActionBtn,
            styles.infoActionBtn,
            (offlineMode || transferring) && styles.actionDisabled,
          ]}
          onPress={submitTransfer}
          disabled={offlineMode || transferring}
        >
          <Text style={styles.primaryActionBtnText}>
            {transferring ? 'Registrando traslado...' : 'Registrar Traslado'}
          </Text>
        </Pressable>

        <Pressable
          style={[
            styles.secondaryActionBtn,
            (offlineMode || pendingTransfersLoading) && styles.actionDisabled,
          ]}
          onPress={openPendingTransfersModal}
          disabled={offlineMode || pendingTransfersLoading}
        >
          <Text style={styles.secondaryActionBtnText}>
            Recibir Traslados en Transito ({pendingTransfers.length})
          </Text>
        </Pressable>
      </View>
    </ScrollView>
  );

  return (
    <View style={[styles.container, isLightTheme && styles.containerLight]}>
      <View style={styles.filtersBlock}>
        <SearchableSelectField
          title="Vista"
          themeMode={resolvedThemeMode}
          valueLabel={TABS.find((tab) => tab.key === filters?.tab)?.label || 'Stock Actual'}
          placeholder="Seleccionar vista"
          searchPlaceholder="Buscar vista..."
          options={tabFilterOptions}
          selectedKey={filters?.tab || 'stock'}
          onSelect={(nextValue) => updateFilters({ tab: nextValue || 'stock', move_type: '' })}
          allowClear={false}
        />
      </View>

      {filters?.tab !== 'operations' ? (
        <>
          <View style={styles.filtersBlock}>
            <SearchableSelectField
              title="Sede"
              themeMode={resolvedThemeMode}
              valueLabel="Todas las sedes"
              clearLabel="Todas las sedes"
              placeholder="Todas las sedes"
              searchPlaceholder="Buscar sede..."
              options={locationFilterOptions}
              selectedKey={filters?.location_id || ''}
              onSelect={(nextValue) => updateFilters({ location_id: nextValue || '' })}
            />
          </View>

          {filters?.tab === 'kardex' ? (
            <View style={styles.filtersBlock}>
              <SearchableSelectField
                title="Tipo de movimiento"
                themeMode={resolvedThemeMode}
                valueLabel="Todos"
                clearLabel="Todos"
                placeholder="Todos"
                searchPlaceholder="Buscar movimiento..."
                options={moveTypeFilterOptions}
                selectedKey={filters?.move_type || ''}
                onSelect={(nextValue) => updateFilters({ move_type: nextValue || '' })}
              />
            </View>
          ) : null}

          {renderInventoryList()}
        </>
      ) : renderOperations()}

      <BottomSheetModal
        visible={pendingTransfersModalOpen}
        onClose={() => setPendingTransfersModalOpen(false)}
        themeMode={resolvedThemeMode}
        maxHeight="88%"
        footer={(
          <Pressable
            style={[styles.modalCloseBtn, isLightTheme && styles.modalCloseBtnLight]}
            onPress={() => setPendingTransfersModalOpen(false)}
          >
            <Text style={[styles.modalCloseBtnText, isLightTheme && styles.modalCloseBtnTextLight]}>
              Cerrar
            </Text>
          </Pressable>
        )}
      >
        <Text style={[styles.modalTitle, isLightTheme && styles.modalTitleLight]}>
          Traslados en Transito
        </Text>

        <SearchableSelectField
          title="Filtrar por sede destino"
          themeMode={resolvedThemeMode}
          valueLabel="Todas las sedes"
          clearLabel="Todas las sedes"
          placeholder="Todas las sedes"
          searchPlaceholder="Buscar sede..."
          options={locationFilterOptions}
          selectedKey={pendingTransfersLocationId}
          onSelect={async (nextValue) => {
            const normalized = nextValue || '';
            setPendingTransfersLocationId(normalized);
            await loadPendingTransfersList(normalized);
          }}
        />

        {pendingTransfersLoading ? (
          <View style={styles.loadingBox}>
            <ActivityIndicator color={isLightTheme ? '#2563eb' : '#93c5fd'} />
            <Text style={[styles.loadingText, isLightTheme && styles.loadingTextLight]}>
              Cargando traslados pendientes...
            </Text>
          </View>
        ) : null}

        {!pendingTransfersLoading && pendingTransfers.length === 0 ? (
          <View style={[styles.emptyBox, isLightTheme && styles.emptyBoxLight]}>
            <Text style={[styles.emptyText, isLightTheme && styles.emptyTextLight]}>
              No hay traslados pendientes.
            </Text>
          </View>
        ) : null}

        {!pendingTransfersLoading
          ? pendingTransfers.map((item) => (
            <View key={item.transfer_id} style={[styles.transferCard, isLightTheme && styles.transferCardLight]}>
              <Text style={[styles.transferTitle, isLightTheme && styles.transferTitleLight]}>
                {item.variant?.product?.name || 'Producto'}
                {item.variant?.variant_name ? ` - ${item.variant.variant_name}` : ''}
              </Text>
              <Text style={[styles.meta, isLightTheme && styles.metaLight]}>
                SKU: {item.variant?.sku || '-'} - {new Date(item.created_at).toLocaleString()}
              </Text>
              <Text style={[styles.meta, isLightTheme && styles.metaLight]}>
                Origen: {item.from_location?.name || '-'} - Destino: {item.to_location?.name || '-'}
              </Text>
              <View style={styles.badgesRow}>
                <View style={[styles.badge, isLightTheme && styles.badgeLight, { borderColor: '#38bdf8' }]}>
                  <Text style={[styles.badgeText, isLightTheme && styles.badgeTextLight]}>
                    Cant. {Number(item.quantity || 0).toLocaleString('es-CO')}
                  </Text>
                </View>
                <View style={[styles.badge, isLightTheme && styles.badgeLight, { borderColor: '#1d4ed8' }]}>
                  <Text style={[styles.badgeText, isLightTheme && styles.badgeTextLight]}>
                    Costo {money(item.unit_cost || 0)}
                  </Text>
                </View>
              </View>
              {item.note ? (
                <Text style={[styles.note, isLightTheme && styles.noteLight]}>{item.note}</Text>
              ) : null}
              <Pressable
                style={[
                  styles.receiveBtn,
                  (receivingTransferId === item.transfer_id) && styles.actionDisabled,
                ]}
                onPress={() => handleReceiveTransfer(item)}
                disabled={receivingTransferId === item.transfer_id}
              >
                <Text style={styles.receiveBtnText}>
                  {receivingTransferId === item.transfer_id ? 'Recibiendo...' : 'Confirmar recepcion'}
                </Text>
              </Pressable>
            </View>
          ))
          : null}
      </BottomSheetModal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#060b16', padding: 12 },
  containerLight: { backgroundColor: '#edf2fb' },
  filtersBlock: { marginBottom: 8 },
  card: {
    backgroundColor: '#111827',
    borderWidth: 1,
    borderColor: '#1f2937',
    borderRadius: 12,
    padding: 12,
    marginBottom: 8,
  },
  cardLight: { backgroundColor: '#ffffff', borderColor: '#dbe4ef' },
  title: { color: '#f8fafc', fontWeight: '700', fontSize: 15 },
  titleLight: { color: '#0f172a' },
  meta: { color: '#cbd5e1', marginTop: 2, fontSize: 13 },
  metaLight: { color: '#475569' },
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
  kardexRows: {
    marginTop: 8,
    borderTopWidth: 1,
    borderTopColor: '#334155',
    paddingTop: 8,
    gap: 4,
  },
  kardexRowsLight: { borderTopColor: '#dbe4ef' },
  kardexRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 12,
  },
  kardexLabel: {
    color: '#94a3b8',
    fontSize: 12,
    fontWeight: '700',
  },
  kardexLabelLight: { color: '#64748b' },
  kardexValue: {
    color: '#e2e8f0',
    fontSize: 12,
    flexShrink: 1,
    textAlign: 'right',
  },
  kardexValueLight: { color: '#334155' },
  qtyPositive: { color: '#16a34a', fontWeight: '700' },
  qtyNegative: { color: '#dc2626', fontWeight: '700' },
  note: { color: '#94a3b8', marginTop: 8, fontSize: 12 },
  noteLight: { color: '#64748b' },
  operationsScroll: { flex: 1 },
  operationsContent: { paddingBottom: 16 },
  noticeBox: {
    borderWidth: 1,
    borderColor: '#334155',
    borderRadius: 10,
    backgroundColor: '#111827',
    padding: 10,
    marginBottom: 10,
  },
  noticeBoxLight: { borderColor: '#cbd5e1', backgroundColor: '#ffffff' },
  noticeText: { color: '#cbd5e1', fontSize: 12, lineHeight: 18 },
  noticeTextLight: { color: '#475569' },
  operationErrorBox: {
    borderWidth: 1,
    borderColor: '#7f1d1d',
    backgroundColor: '#2b1111',
    borderRadius: 12,
    padding: 10,
    marginBottom: 10,
  },
  operationErrorBoxLight: {
    borderColor: '#fecaca',
    backgroundColor: '#fff1f2',
  },
  operationErrorText: { color: '#fecaca', fontWeight: '600', lineHeight: 18 },
  operationCard: {
    borderWidth: 1,
    borderColor: '#1e3a8a',
    backgroundColor: '#0f172a',
    borderRadius: 16,
    padding: 14,
    marginBottom: 12,
  },
  operationCardLight: {
    borderColor: '#c7d2fe',
    backgroundColor: '#ffffff',
  },
  operationTitle: { color: '#f8fafc', fontSize: 22, fontWeight: '800' },
  operationTitleLight: { color: '#0f172a' },
  fieldLabel: {
    color: '#cbd5e1',
    marginTop: 12,
    marginBottom: 6,
    fontWeight: '700',
    fontSize: 13,
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
  fieldLabelLight: { color: '#475569' },
  input: {
    minHeight: 44,
    borderWidth: 1,
    borderColor: '#334155',
    borderRadius: 10,
    backgroundColor: '#0f172a',
    color: '#e2e8f0',
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  inputLight: {
    borderColor: '#cbd5e1',
    backgroundColor: '#ffffff',
    color: '#0f172a',
  },
  noteInput: { minHeight: 84, textAlignVertical: 'top' },
  toggleRow: { flexDirection: 'row', gap: 10, marginTop: 4 },
  toggleBtn: {
    flex: 1,
    minHeight: 44,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#334155',
    backgroundColor: '#111827',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 10,
    paddingVertical: 10,
  },
  toggleBtnLight: {
    borderColor: '#cbd5e1',
    backgroundColor: '#ffffff',
  },
  toggleBtnActive: {
    borderColor: '#16a34a',
    backgroundColor: '#052e16',
  },
  toggleBtnActiveLight: {
    borderColor: '#16a34a',
    backgroundColor: '#dcfce7',
  },
  toggleBtnDangerActive: {
    borderColor: '#dc2626',
    backgroundColor: '#3f1115',
  },
  toggleBtnDangerActiveLight: {
    borderColor: '#ef4444',
    backgroundColor: '#fee2e2',
  },
  toggleBtnText: { color: '#e2e8f0', fontWeight: '700' },
  toggleBtnTextLight: { color: '#334155' },
  toggleBtnTextActive: { color: '#bbf7d0' },
  toggleBtnTextDangerActive: { color: '#fecaca' },
  primaryActionBtn: {
    marginTop: 14,
    minHeight: 48,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderWidth: 1,
  },
  warningActionBtn: {
    backgroundColor: '#fbbf24',
    borderColor: '#f59e0b',
  },
  infoActionBtn: {
    backgroundColor: '#3b82f6',
    borderColor: '#2563eb',
  },
  primaryActionBtnText: { color: '#0f172a', fontWeight: '800', fontSize: 14 },
  secondaryActionBtn: {
    marginTop: 10,
    minHeight: 44,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#3730a3',
    backgroundColor: '#1e1b4b',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  secondaryActionBtnText: { color: '#c7d2fe', fontWeight: '800', fontSize: 13 },
  actionDisabled: { opacity: 0.5 },
  modalTitle: { color: '#f8fafc', fontWeight: '800', fontSize: 22, marginBottom: 4 },
  modalTitleLight: { color: '#0f172a' },
  modalCloseBtn: {
    marginTop: 12,
    alignSelf: 'flex-end',
    minHeight: 42,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#475569',
    backgroundColor: '#1e293b',
    paddingHorizontal: 14,
    paddingVertical: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalCloseBtnLight: {
    borderColor: '#cbd5e1',
    backgroundColor: '#ffffff',
  },
  modalCloseBtnText: { color: '#e2e8f0', fontWeight: '700' },
  modalCloseBtnTextLight: { color: '#334155' },
  loadingBox: {
    paddingVertical: 20,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
  },
  loadingText: { color: '#cbd5e1', fontSize: 13 },
  loadingTextLight: { color: '#475569' },
  emptyBox: {
    marginTop: 12,
    borderWidth: 1,
    borderColor: '#334155',
    borderRadius: 12,
    backgroundColor: '#111827',
    padding: 14,
  },
  emptyBoxLight: {
    borderColor: '#dbe4ef',
    backgroundColor: '#ffffff',
  },
  emptyText: { color: '#cbd5e1', textAlign: 'center' },
  emptyTextLight: { color: '#475569' },
  transferCard: {
    marginTop: 12,
    borderWidth: 1,
    borderColor: '#334155',
    borderRadius: 14,
    backgroundColor: '#111827',
    padding: 12,
  },
  transferCardLight: {
    borderColor: '#dbe4ef',
    backgroundColor: '#ffffff',
  },
  transferTitle: { color: '#f8fafc', fontWeight: '700', fontSize: 15 },
  transferTitleLight: { color: '#0f172a' },
  receiveBtn: {
    marginTop: 12,
    minHeight: 42,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#4338ca',
    backgroundColor: '#312e81',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  receiveBtnText: { color: '#e0e7ff', fontWeight: '800' },
});
