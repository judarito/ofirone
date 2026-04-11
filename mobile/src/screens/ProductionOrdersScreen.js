import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Alert,
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
import PaginatedList from '../components/PaginatedList';
import SearchableSelectField from '../components/SearchableSelectField';
import { usePaginatedList } from '../hooks/usePaginatedList';
import { useThemeMode } from '../lib/themeMode';
import { humanizeAppError } from '../../../shared/utils/appErrors';
import {
  cancelProductionOrder,
  completeProductionOrder,
  createProductionOrder,
  getBOMById,
  getProductionOrderById,
  listBomsForSelect,
  listLocations,
  listProductionOrders,
  startProductionOrder,
  validateBOMAvailability,
} from '../services/inventoryCatalog.service';

// ─── constantes ───────────────────────────────────────────────────────────────

const STATUS_FILTERS = ['', 'PENDING', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED'];
const STATUS_LABELS = {
  PENDING: 'Pendiente',
  IN_PROGRESS: 'En progreso',
  COMPLETED: 'Completada',
  CANCELLED: 'Cancelada',
};

function statusColor(status) {
  if (status === 'PENDING') return '#f59e0b';
  if (status === 'IN_PROGRESS') return '#235ea9';
  if (status === 'COMPLETED') return '#16a34a';
  if (status === 'CANCELLED') return '#ef4444';
  return '#64748b';
}

function fmtQty(value) {
  return Number(value || 0).toLocaleString('es-CO');
}

function fmtDate(isoStr) {
  if (!isoStr) return '-';
  return new Date(isoStr).toLocaleDateString('es-CO');
}

// ─── AvailabilityRow ─────────────────────────────────────────────────────────

function AvailabilityRow({ comp, isLight }) {
  const ok = comp.is_available;
  const color = ok ? '#16a34a' : comp.is_optional ? '#f59e0b' : '#ef4444';
  return (
    <View style={[s.availRow, isLight && s.availRowLight]}>
      <View style={{ flex: 1 }}>
        <Text style={[s.availName, isLight && s.metaLight]}>{comp.sku || comp.variant_name || comp.variant_id}</Text>
        {comp.is_optional && <Text style={[s.availOpt, { color: '#f59e0b' }]}>Opcional</Text>}
      </View>
      <Text style={[s.availQty, { color }]}>
        {fmtQty(comp.required)} requerido · {fmtQty(comp.available)} disponible
      </Text>
    </View>
  );
}

// ─── OrderDetailModal ────────────────────────────────────────────────────────

function OrderDetailModal({ order, visible, onClose, onRefresh, tenant, isLight }) {
  const [actionLoading, setActionLoading] = useState(false);
  const [completeQty, setCompleteQty] = useState('');
  const [expirationDate, setExpirationDate] = useState('');
  const [showCompleteForm, setShowCompleteForm] = useState(false);

  const userId = tenant?.user_id || null;

  const handleStart = () => {
    Alert.alert('Iniciar producción', `¿Iniciar la orden ${order.order_number}?`, [
      { text: 'Cancelar', style: 'cancel' },
      {
        text: 'Iniciar',
        onPress: async () => {
          setActionLoading(true);
          const result = await startProductionOrder(tenant.tenant_id, order.production_order_id, userId);
          setActionLoading(false);
          if (result.success) {
            onRefresh();
            onClose();
          } else {
            Alert.alert('Error', humanizeAppError(result.error));
          }
        },
      },
    ]);
  };

  const handleComplete = async () => {
    const qty = parseFloat(String(completeQty).replace(',', '.'));
    if (!qty || qty <= 0) {
      Alert.alert('Error', 'Ingresa una cantidad producida válida.');
      return;
    }
    setActionLoading(true);
    const result = await completeProductionOrder(tenant.tenant_id, order.production_order_id, {
      quantityProduced: qty,
      completedBy: userId,
      expirationDate: expirationDate || null,
    });
    setActionLoading(false);
    if (result.success) {
      onRefresh();
      onClose();
    } else {
      Alert.alert('Error', humanizeAppError(result.error));
    }
  };

  const handleCancel = () => {
    Alert.alert('Cancelar orden', `¿Cancelar la orden ${order.order_number}? Esta acción no se puede deshacer.`, [
      { text: 'No', style: 'cancel' },
      {
        text: 'Cancelar orden',
        style: 'destructive',
        onPress: async () => {
          setActionLoading(true);
          const result = await cancelProductionOrder(tenant.tenant_id, order.production_order_id);
          setActionLoading(false);
          if (result.success) {
            onRefresh();
            onClose();
          } else {
            Alert.alert('Error', humanizeAppError(result.error));
          }
        },
      },
    ]);
  };

  const lines = order.production_order_lines || [];
  const bomComponents = order.bom?.bom_components || [];
  const isPending = order.status === 'PENDING';
  const isInProgress = order.status === 'IN_PROGRESS';
  const isDone = order.status === 'COMPLETED' || order.status === 'CANCELLED';

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={s.modalOverlay}>
        <KeyboardAvoidingView style={s.modalAvoider} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={[s.modalCard, isLight && s.modalCardLight]}>
          <View style={s.modalHeader}>
            <Text style={[s.modalTitle, isLight && s.titleLight]}>{order.order_number}</Text>
            <Pressable onPress={onClose} style={s.closeBtn}>
              <Text style={[s.closeBtnText, isLight && { color: '#475569' }]}>✕</Text>
            </Pressable>
          </View>

          <ScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
            {/* Info general */}
            <View style={[s.section, isLight && s.sectionLight]}>
              <Row label="BOM" value={order.bom?.bom_name || '-'} isLight={isLight} />
              <Row label="Producto" value={order.bom?.product?.name || order.bom?.variant?.variant_name || '-'} isLight={isLight} />
              <Row label="Sede" value={order.location?.name || '-'} isLight={isLight} />
              <Row label="Estado" value={STATUS_LABELS[order.status] || order.status} color={statusColor(order.status)} isLight={isLight} />
              <Row label="Planeado" value={fmtQty(order.quantity_planned)} isLight={isLight} />
              <Row label="Producido" value={fmtQty(order.quantity_produced)} isLight={isLight} />
              {order.started_at && <Row label="Iniciada" value={fmtDate(order.started_at)} isLight={isLight} />}
              {order.completed_at && <Row label="Completada" value={fmtDate(order.completed_at)} isLight={isLight} />}
              {order.notes ? <Row label="Notas" value={order.notes} isLight={isLight} /> : null}
            </View>

            {/* Componentes del BOM (referencia) */}
            {bomComponents.length > 0 && (
              <View style={[s.section, isLight && s.sectionLight]}>
                <Text style={[s.sectionTitle, isLight && s.titleLight]}>Componentes requeridos</Text>
                {bomComponents.map((comp, idx) => {
                  const wasteMultiplier = 1 + (comp.waste_percentage || 0) / 100;
                  const needed = comp.quantity_required * wasteMultiplier * order.quantity_planned;
                  return (
                    <View key={idx} style={s.compRow}>
                      <Text style={[s.compName, isLight && s.metaLight]}>
                        {comp.component_variant?.sku || comp.component_variant?.variant_name || '-'}
                        {comp.is_optional ? ' (Opcional)' : ''}
                      </Text>
                      <Text style={[s.compQty, isLight && s.metaLight]}>
                        {fmtQty(needed)} {comp.unit?.code || ''}
                        {comp.waste_percentage > 0 ? ` (+${comp.waste_percentage}% desperdicio)` : ''}
                      </Text>
                    </View>
                  );
                })}
              </View>
            )}

            {/* Líneas consumidas (solo si completada) */}
            {lines.length > 0 && (
              <View style={[s.section, isLight && s.sectionLight]}>
                <Text style={[s.sectionTitle, isLight && s.titleLight]}>Componentes consumidos</Text>
                {lines.map((line) => (
                  <View key={line.line_id} style={s.compRow}>
                    <Text style={[s.compName, isLight && s.metaLight]}>
                      {line.component_variant?.sku || line.component_variant?.variant_name || '-'}
                    </Text>
                    <Text style={[s.compQty, isLight && s.metaLight]}>
                      Req: {fmtQty(line.quantity_required)} · Cons: {fmtQty(line.quantity_consumed)}
                    </Text>
                  </View>
                ))}
              </View>
            )}

            {/* Acciones */}
            {!isDone && (
              <View style={s.actionsBlock}>
                {isPending && (
                  <Pressable
                    style={[s.actionBtn, { backgroundColor: '#235ea9' }, actionLoading && s.btnDisabled]}
                    onPress={handleStart}
                    disabled={actionLoading}
                  >
                    <Text style={s.actionBtnText}>▶ Iniciar producción</Text>
                  </Pressable>
                )}

                {isInProgress && !showCompleteForm && (
                  <Pressable
                    style={[s.actionBtn, { backgroundColor: '#16a34a' }, actionLoading && s.btnDisabled]}
                    onPress={() => {
                      setCompleteQty(String(order.quantity_planned));
                      setShowCompleteForm(true);
                    }}
                    disabled={actionLoading}
                  >
                    <Text style={s.actionBtnText}>✓ Completar producción</Text>
                  </Pressable>
                )}

                {isInProgress && showCompleteForm && (
                  <View style={[s.completeForm, isLight && s.completeFormLight]}>
                    <Text style={[s.formLabel, isLight && s.metaLight]}>Cantidad producida</Text>
                    <TextInput
                      style={[s.input, isLight && s.inputLight]}
                      value={completeQty}
                      onChangeText={setCompleteQty}
                      keyboardType="numeric"
                      placeholder={String(order.quantity_planned)}
                      placeholderTextColor="#64748b"
                    />
                    <Text style={[s.formLabel, isLight && s.metaLight]}>Fecha de vencimiento (opcional, YYYY-MM-DD)</Text>
                    <TextInput
                      style={[s.input, isLight && s.inputLight]}
                      value={expirationDate}
                      onChangeText={setExpirationDate}
                      placeholder="2026-12-31"
                      placeholderTextColor="#64748b"
                    />
                    <View style={s.formButtons}>
                      <Pressable style={[s.actionBtn, { backgroundColor: '#16a34a', flex: 1 }, actionLoading && s.btnDisabled]} onPress={handleComplete} disabled={actionLoading}>
                        <Text style={s.actionBtnText}>{actionLoading ? 'Guardando...' : 'Confirmar'}</Text>
                      </Pressable>
                      <Pressable style={[s.actionBtn, { backgroundColor: '#475569', flex: 1 }]} onPress={() => setShowCompleteForm(false)}>
                        <Text style={s.actionBtnText}>Cancelar</Text>
                      </Pressable>
                    </View>
                  </View>
                )}

                {(isPending || isInProgress) && (
                  <Pressable
                    style={[s.actionBtn, { backgroundColor: '#ef4444' }, actionLoading && s.btnDisabled]}
                    onPress={handleCancel}
                    disabled={actionLoading}
                  >
                    <Text style={s.actionBtnText}>✕ Cancelar orden</Text>
                  </Pressable>
                )}
              </View>
            )}
          </ScrollView>
        </View>
        </KeyboardAvoidingView>
      </View>
    </Modal>
  );
}

// ─── CreateOrderModal ─────────────────────────────────────────────────────────

function CreateOrderModal({ visible, onClose, onCreated, tenant, locations, isLight }) {
  const [boms, setBoms] = useState([]);
  const [selectedBom, setSelectedBom] = useState(null);
  const [selectedLocation, setSelectedLocation] = useState(null);
  const [quantity, setQuantity] = useState('');
  const [notes, setNotes] = useState('');
  const [availability, setAvailability] = useState(null);
  const [loadingAvail, setLoadingAvail] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!visible || !tenant?.tenant_id) return;
    listBomsForSelect(tenant.tenant_id).then((r) => {
      if (r.success) setBoms(r.data);
    });
  }, [visible, tenant?.tenant_id]);

  const checkAvailability = useCallback(async () => {
    if (!selectedBom || !selectedLocation || !quantity) return;
    const qty = parseFloat(String(quantity).replace(',', '.'));
    if (!qty || qty <= 0) return;
    setLoadingAvail(true);
    const result = await validateBOMAvailability(tenant.tenant_id, selectedBom.bom_id, qty, selectedLocation.location_id);
    setLoadingAvail(false);
    if (result.success) setAvailability(result.data);
  }, [selectedBom, selectedLocation, quantity, tenant?.tenant_id]);

  useEffect(() => {
    setAvailability(null);
  }, [selectedBom, selectedLocation, quantity]);

  const handleCreate = async () => {
    const qty = parseFloat(String(quantity).replace(',', '.'));
    if (!selectedBom) { Alert.alert('Error', 'Selecciona un BOM.'); return; }
    if (!selectedLocation) { Alert.alert('Error', 'Selecciona una sede.'); return; }
    if (!qty || qty <= 0) { Alert.alert('Error', 'Ingresa una cantidad válida.'); return; }
    if (availability && !availability.all_available) {
      Alert.alert(
        'Stock insuficiente',
        'Algunos componentes no tienen stock suficiente. ¿Crear la orden de todas formas?',
        [
          { text: 'Revisar', style: 'cancel' },
          { text: 'Crear de todas formas', onPress: () => doCreate(qty) },
        ],
      );
      return;
    }
    doCreate(qty);
  };

  const doCreate = async (qty) => {
    setSaving(true);
    const result = await createProductionOrder(tenant.tenant_id, {
      locationId: selectedLocation.location_id,
      bomId: selectedBom.bom_id,
      quantity: qty,
      createdBy: tenant?.user_id || null,
      notes: notes || null,
    });
    setSaving(false);
    if (result.success) {
      setSelectedBom(null);
      setSelectedLocation(null);
      setQuantity('');
      setNotes('');
      setAvailability(null);
      onCreated();
      onClose();
    } else {
      Alert.alert('Error', humanizeAppError(result.error));
    }
  };

  const bomOptions = boms.map((b) => ({
    key: b.bom_id,
    label: `${b.bom_name} — ${b.product?.name || b.variant?.variant_name || 'Sin destino'} (${(b.bom_components || []).length} comp.)`,
    searchText: b.bom_name,
    data: b,
  }));

  const locationOptions = locations.map((l) => ({
    key: l.location_id,
    label: l.name,
    searchText: l.name,
    data: l,
  }));

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={s.modalOverlay}>
        <KeyboardAvoidingView style={s.modalAvoider} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={[s.modalCard, isLight && s.modalCardLight]}>
          <View style={s.modalHeader}>
            <Text style={[s.modalTitle, isLight && s.titleLight]}>Nueva orden de producción</Text>
            <Pressable onPress={onClose} style={s.closeBtn}>
              <Text style={[s.closeBtnText, isLight && { color: '#475569' }]}>✕</Text>
            </Pressable>
          </View>

          <ScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
            <SearchableSelectField
              title="BOM"
              themeMode={isLight ? 'light' : 'dark'}
              valueLabel={selectedBom ? selectedBom.bom_name : 'Seleccionar BOM'}
              clearLabel="Sin seleccionar"
              placeholder="Seleccionar BOM"
              searchPlaceholder="Buscar BOM..."
              options={bomOptions}
              selectedKey={selectedBom?.bom_id || ''}
              onSelect={(key) => {
                const found = boms.find((b) => b.bom_id === key);
                setSelectedBom(found || null);
              }}
            />

            <SearchableSelectField
              title="Sede"
              themeMode={isLight ? 'light' : 'dark'}
              valueLabel={selectedLocation ? selectedLocation.name : 'Seleccionar sede'}
              clearLabel="Sin seleccionar"
              placeholder="Seleccionar sede"
              searchPlaceholder="Buscar sede..."
              options={locationOptions}
              selectedKey={selectedLocation?.location_id || ''}
              onSelect={(key) => {
                const found = locations.find((l) => l.location_id === key);
                setSelectedLocation(found || null);
              }}
            />

            <View style={{ marginTop: 8 }}>
              <Text style={[s.formLabel, isLight && s.metaLight]}>Cantidad a producir</Text>
              <TextInput
                style={[s.input, isLight && s.inputLight]}
                value={quantity}
                onChangeText={setQuantity}
                keyboardType="numeric"
                placeholder="Ej: 50"
                placeholderTextColor="#64748b"
                onEndEditing={checkAvailability}
              />
            </View>

            <View style={{ marginTop: 8 }}>
              <Text style={[s.formLabel, isLight && s.metaLight]}>Notas (opcional)</Text>
              <TextInput
                style={[s.input, s.inputMultiline, isLight && s.inputLight]}
                value={notes}
                onChangeText={setNotes}
                multiline
                numberOfLines={2}
                placeholder="Observaciones..."
                placeholderTextColor="#64748b"
              />
            </View>

            {/* Botón verificar stock */}
            {selectedBom && selectedLocation && quantity ? (
              <Pressable
                style={[s.actionBtn, { backgroundColor: '#475569', marginTop: 8 }, loadingAvail && s.btnDisabled]}
                onPress={checkAvailability}
                disabled={loadingAvail}
              >
                <Text style={s.actionBtnText}>{loadingAvail ? 'Verificando...' : '🔍 Verificar stock'}</Text>
              </Pressable>
            ) : null}

            {/* Resultado de disponibilidad */}
            {availability && (
              <View style={[s.section, isLight && s.sectionLight, { marginTop: 8 }]}>
                <Text style={[s.sectionTitle, { color: availability.all_available ? '#16a34a' : '#ef4444' }]}>
                  {availability.all_available ? '✓ Stock suficiente' : '⚠ Stock insuficiente en algunos componentes'}
                </Text>
                {availability.components.map((comp, idx) => (
                  <AvailabilityRow key={idx} comp={comp} isLight={isLight} />
                ))}
              </View>
            )}

            <Pressable
              style={[s.actionBtn, { backgroundColor: '#235ea9', marginTop: 12 }, saving && s.btnDisabled]}
              onPress={handleCreate}
              disabled={saving}
            >
              <Text style={s.actionBtnText}>{saving ? 'Creando...' : '+ Crear orden'}</Text>
            </Pressable>
          </ScrollView>
        </View>
        </KeyboardAvoidingView>
      </View>
    </Modal>
  );
}

// ─── helper Row ──────────────────────────────────────────────────────────────

function Row({ label, value, color, isLight }) {
  return (
    <View style={s.row}>
      <Text style={[s.rowLabel, isLight && s.metaLight]}>{label}</Text>
      <Text style={[s.rowValue, isLight && s.titleLight, color && { color }]}>{value}</Text>
    </View>
  );
}

// ─── ProductionOrdersScreen ──────────────────────────────────────────────────

export default function ProductionOrdersScreen({ tenant, session, offlineMode, pageSize = 20 }) {
  const themeMode = useThemeMode();
  const isLight = themeMode === 'light';
  const [locations, setLocations] = useState([]);
  const [selectedOrder, setSelectedOrder] = useState(null);
  const [detailVisible, setDetailVisible] = useState(false);
  const [createVisible, setCreateVisible] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);

  const {
    items, page, totalPages, loading, error, cacheInfo, refreshing,
    reload, filters, changePage, updateFilters,
  } = usePaginatedList({
    tenantId: tenant?.tenant_id,
    pageSize,
    offlineMode,
    cacheNamespace: 'inventory-production-orders',
    initialFilters: { location_id: '', status: '' },
    fetchPage: async ({ page: nextPage, pageSize: ps, filters: f, tenantId }) => {
      return listProductionOrders({
        tenantId,
        locationId: f?.location_id || null,
        status: f?.status || null,
        limit: ps,
        offset: (nextPage - 1) * ps,
      });
    },
  });

  useEffect(() => {
    if (!tenant?.tenant_id) return;
    listLocations(tenant.tenant_id, { offlineMode }).then((r) => {
      if (r.success) setLocations(r.data || []);
    });
  }, [tenant?.tenant_id]);

  const openDetail = async (item) => {
    setDetailLoading(true);
    const result = await getProductionOrderById(tenant.tenant_id, item.production_order_id);
    setDetailLoading(false);
    if (result.success) {
      setSelectedOrder(result.data);
      setDetailVisible(true);
    } else {
      Alert.alert('Error', humanizeAppError(result.error));
    }
  };

  return (
    <View style={[s.container, isLight && s.containerLight]}>
      {/* Filtros */}
      <View style={s.filtersBlock}>
        <SearchableSelectField
          title="Sede"
          themeMode={themeMode}
          valueLabel="Todas las sedes"
          clearLabel="Todas las sedes"
          placeholder="Todas las sedes"
          searchPlaceholder="Buscar sede..."
          options={locations.map((loc) => ({ key: loc.location_id, label: loc.name, searchText: loc.name }))}
          selectedKey={filters?.location_id || ''}
          onSelect={(v) => updateFilters({ location_id: v || '' })}
        />
      </View>

      <View style={s.filtersBlock}>
        <SearchableSelectField
          title="Estado"
          themeMode={themeMode}
          valueLabel="Todos"
          clearLabel="Todos"
          placeholder="Todos"
          searchPlaceholder="Buscar estado..."
          options={STATUS_FILTERS.filter(Boolean).map((status) => ({ key: status, label: STATUS_LABELS[status] || status }))}
          selectedKey={filters?.status || ''}
          onSelect={(v) => updateFilters({ status: v || '' })}
        />
      </View>

      {/* Botón nueva orden */}
      {!offlineMode && (
        <Pressable style={[s.newOrderBtn, isLight && s.newOrderBtnLight]} onPress={() => setCreateVisible(true)}>
          <Text style={s.newOrderBtnText}>+ Nueva orden</Text>
        </Pressable>
      )}

      <PaginatedList
        themeMode={themeMode}
        title="Órdenes de Producción"
        loading={loading || detailLoading}
        refreshing={refreshing}
        onRefresh={reload}
        error={error}
        items={items}
        emptyText="No hay órdenes para este filtro."
        page={page}
        totalPages={totalPages}
        onPrev={() => changePage(page - 1)}
        onNext={() => changePage(page + 1)}
        footerMeta={
          cacheInfo?.source === 'cache' && cacheInfo?.cachedAt
            ? `Caché offline: ${new Date(cacheInfo.cachedAt).toLocaleString()}`
            : null
        }
        renderItem={(item) => (
          <Pressable key={item.production_order_id} onPress={() => openDetail(item)}>
            <View style={[s.card, isLight && s.cardLight]}>
              <Text style={[s.title, isLight && s.titleLight]}>{item.order_number || 'Sin número'}</Text>
              <Text style={[s.meta, isLight && s.metaLight]}>{item.location?.name || 'Sin sede'}</Text>
              <Text style={[s.meta, isLight && s.metaLight]}>
                {item.bom?.bom_name || 'Sin BOM'} · {item.bom?.product?.name || item.bom?.variant?.variant_name || '-'}
              </Text>
              <View style={s.badgesRow}>
                <View style={[s.badge, isLight && s.badgeLight, { borderColor: statusColor(item.status) }]}>
                  <Text style={[s.badgeText, isLight && s.badgeTextLight]}>{STATUS_LABELS[item.status] || item.status}</Text>
                </View>
                <View style={[s.badge, isLight && s.badgeLight, { borderColor: '#a78bfa' }]}>
                  <Text style={[s.badgeText, isLight && s.badgeTextLight]}>Plan {fmtQty(item.quantity_planned)}</Text>
                </View>
                <View style={[s.badge, isLight && s.badgeLight, { borderColor: '#16a34a' }]}>
                  <Text style={[s.badgeText, isLight && s.badgeTextLight]}>Prod {fmtQty(item.quantity_produced)}</Text>
                </View>
              </View>
              <Text style={[s.tapHint, isLight && { color: '#94a3b8' }]}>Toca para ver detalle y acciones →</Text>
            </View>
          </Pressable>
        )}
      />

      {/* Modal detalle + acciones */}
      {selectedOrder && (
        <OrderDetailModal
          order={selectedOrder}
          visible={detailVisible}
          onClose={() => { setDetailVisible(false); setSelectedOrder(null); }}
          onRefresh={reload}
          tenant={tenant}
          isLight={isLight}
        />
      )}

      {/* Modal crear orden */}
      <CreateOrderModal
        visible={createVisible}
        onClose={() => setCreateVisible(false)}
        onCreated={reload}
        tenant={tenant}
        locations={locations}
        isLight={isLight}
      />
    </View>
  );
}

// ─── Estilos ─────────────────────────────────────────────────────────────────

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#060b16', padding: 12 },
  containerLight: { backgroundColor: '#edf2fb' },
  filtersBlock: { marginBottom: 8 },
  newOrderBtn: {
    backgroundColor: '#235ea9',
    borderRadius: 8,
    paddingVertical: 10,
    alignItems: 'center',
    marginBottom: 8,
  },
  newOrderBtnLight: { backgroundColor: '#235ea9' },
  newOrderBtnText: { color: '#dbeafe', fontWeight: '700', fontSize: 14 },
  card: {
    backgroundColor: '#111827', borderWidth: 1, borderColor: '#1f2937',
    borderRadius: 12, padding: 12, marginBottom: 8,
  },
  cardLight: { backgroundColor: '#ffffff', borderColor: '#dbe4ef' },
  title: { color: '#f8fafc', fontWeight: '700', fontSize: 15 },
  titleLight: { color: '#0f172a' },
  meta: { color: '#cbd5e1', marginTop: 2, fontSize: 13 },
  metaLight: { color: '#475569' },
  tapHint: { color: '#475569', fontSize: 11, marginTop: 6 },
  badgesRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 8 },
  badge: {
    borderWidth: 1, borderRadius: 999, paddingHorizontal: 8, paddingVertical: 4,
    backgroundColor: '#0f172a',
  },
  badgeLight: { backgroundColor: '#f8fafc' },
  badgeText: { color: '#e2e8f0', fontSize: 11, fontWeight: '700' },
  badgeTextLight: { color: '#334155' },
  // Modal
  modalOverlay: {
    flex: 1, backgroundColor: 'rgba(0,0,0,0.7)',
    justifyContent: 'flex-end',
  },
  modalAvoider: { width: '100%' },
  modalCard: {
    backgroundColor: '#111827', borderTopLeftRadius: 20, borderTopRightRadius: 20,
    padding: 16, maxHeight: '90%',
  },
  modalCardLight: { backgroundColor: '#ffffff' },
  modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
  modalTitle: { color: '#f8fafc', fontWeight: '700', fontSize: 17, flex: 1 },
  closeBtn: { padding: 4 },
  closeBtnText: { color: '#94a3b8', fontSize: 18 },
  section: {
    backgroundColor: '#0f172a', borderRadius: 10, padding: 12, marginBottom: 10,
  },
  sectionLight: { backgroundColor: '#f1f5f9' },
  sectionTitle: { color: '#f8fafc', fontWeight: '700', fontSize: 13, marginBottom: 8 },
  row: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 3 },
  rowLabel: { color: '#94a3b8', fontSize: 13 },
  rowValue: { color: '#e2e8f0', fontSize: 13, fontWeight: '600', textAlign: 'right', flex: 1, marginLeft: 8 },
  compRow: { paddingVertical: 4, borderBottomWidth: 1, borderBottomColor: '#1f2937' },
  compName: { color: '#cbd5e1', fontSize: 13, fontWeight: '600' },
  compQty: { color: '#94a3b8', fontSize: 12, marginTop: 2 },
  actionsBlock: { gap: 8, marginTop: 4, marginBottom: 8 },
  actionBtn: {
    borderRadius: 8, paddingVertical: 12, alignItems: 'center',
  },
  actionBtnText: { color: '#fff', fontWeight: '700', fontSize: 14 },
  btnDisabled: { opacity: 0.5 },
  completeForm: {
    backgroundColor: '#0f172a', borderRadius: 10, padding: 12,
  },
  completeFormLight: { backgroundColor: '#f1f5f9' },
  formLabel: { color: '#94a3b8', fontSize: 12, marginBottom: 4 },
  formButtons: { flexDirection: 'row', gap: 8, marginTop: 8 },
  input: {
    borderWidth: 1, borderColor: '#334155', borderRadius: 8,
    backgroundColor: '#111827', color: '#f8fafc',
    paddingHorizontal: 10, paddingVertical: 8, marginBottom: 8, fontSize: 14,
  },
  inputLight: { borderColor: '#cbd5e1', backgroundColor: '#ffffff', color: '#0f172a' },
  inputMultiline: { minHeight: 60, textAlignVertical: 'top' },
  // Availability
  availRow: {
    flexDirection: 'row', alignItems: 'center', paddingVertical: 4,
    borderBottomWidth: 1, borderBottomColor: '#1f2937',
  },
  availRowLight: { borderBottomColor: '#e2e8f0' },
  availName: { color: '#cbd5e1', fontSize: 12, fontWeight: '600' },
  availOpt: { fontSize: 10 },
  availQty: { fontSize: 11, fontWeight: '700', textAlign: 'right' },
});
