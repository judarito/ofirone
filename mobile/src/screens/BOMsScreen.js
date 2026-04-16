import { useState } from 'react';
import {
  Alert,
  Modal,
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
import { getBomComponentLineCost, getBomEstimatedCost } from '../../../shared/utils/manufacturing';
import { getBOMById, listBoms } from '../services/inventoryCatalog.service';

const TYPE_FILTER_OPTIONS = [
  { key: 'product', label: 'Producto' },
  { key: 'variant', label: 'Variante' },
];

function fmtQty(value) {
  return Number(value || 0).toLocaleString('es-CO');
}

function fmtCost(value) {
  return `$${Number(value || 0).toLocaleString('es-CO')}`;
}

// ─── BOMDetailModal ──────────────────────────────────────────────────────────

function BOMDetailModal({ bom, visible, onClose, isLight }) {
  const components = bom?.bom_components || [];

  // Costo total estimado (suma unit_cost × qty × (1 + waste%))
  const totalCost = getBomEstimatedCost(components);

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={s.modalOverlay}>
        <View style={[s.modalCard, isLight && s.modalCardLight]}>
          <View style={s.modalHeader}>
            <Text style={[s.modalTitle, isLight && s.titleLight]} numberOfLines={2}>
              {bom?.bom_name || 'BOM'}
            </Text>
            <Pressable onPress={onClose} style={s.closeBtn}>
              <Text style={[s.closeBtnText, isLight && { color: '#475569' }]}>✕</Text>
            </Pressable>
          </View>

          <ScrollView showsVerticalScrollIndicator={false}>
            {/* Info general */}
            <View style={[s.section, isLight && s.sectionLight]}>
              <Row label="Destino" value={bom?.product?.name || bom?.variant?.variant_name || '-'} isLight={isLight} />
              {bom?.variant?.sku && <Row label="SKU" value={bom.variant.sku} isLight={isLight} />}
              <Row label="Versión" value={String(bom?.version || 1)} isLight={isLight} />
              <Row label="Estado" value={bom?.is_active ? 'Activo' : 'Inactivo'} color={bom?.is_active ? '#16a34a' : '#ef4444'} isLight={isLight} />
              {components.length > 0 && (
                <Row label="Costo estimado (x1)" value={fmtCost(totalCost)} isLight={isLight} />
              )}
              {bom?.notes ? <Row label="Notas" value={bom.notes} isLight={isLight} /> : null}
            </View>

            {/* Componentes */}
            {components.length === 0 ? (
              <Text style={[s.emptyText, isLight && s.metaLight]}>Este BOM no tiene componentes registrados.</Text>
            ) : (
              <View style={[s.section, isLight && s.sectionLight]}>
                <Text style={[s.sectionTitle, isLight && s.titleLight]}>
                  Componentes ({components.length})
                </Text>
                {components.map((comp, idx) => {
                  const lineCost = getBomComponentLineCost(
                    comp.component_variant?.cost || 0,
                    comp.quantity_required,
                    comp.waste_percentage || 0,
                  );
                  return (
                    <View key={comp.component_id || idx} style={[s.compRow, isLight && s.compRowLight]}>
                      <View style={{ flex: 1 }}>
                        <Text style={[s.compName, isLight && s.titleLight]}>
                          {comp.component_variant?.sku
                            ? `${comp.component_variant.sku} — ${comp.component_variant.variant_name || ''}`
                            : comp.component_variant?.variant_name || 'Componente'}
                          {comp.is_optional ? ' (Opcional)' : ''}
                        </Text>
                        <Text style={[s.compMeta, isLight && s.metaLight]}>
                          Cant: {fmtQty(comp.quantity_required)} {comp.unit?.code || comp.unit?.name || ''}
                          {comp.waste_percentage > 0 ? ` · Desperdicio: ${comp.waste_percentage}%` : ''}
                        </Text>
                        {comp.component_variant?.cost > 0 && (
                          <Text style={[s.compCost, isLight && s.metaLight]}>
                            Costo unitario: {fmtCost(comp.component_variant.cost)} · Línea: {fmtCost(lineCost)}
                          </Text>
                        )}
                        {comp.notes ? <Text style={[s.compMeta, isLight && s.metaLight]}>{comp.notes}</Text> : null}
                      </View>
                    </View>
                  );
                })}

                {totalCost > 0 && (
                  <View style={[s.totalRow, isLight && s.totalRowLight]}>
                    <Text style={[s.totalLabel, isLight && s.titleLight]}>Costo total estimado (x1 unidad)</Text>
                    <Text style={[s.totalValue, isLight && s.titleLight]}>{fmtCost(totalCost)}</Text>
                  </View>
                )}
              </View>
            )}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

function Row({ label, value, color, isLight }) {
  return (
    <View style={s.row}>
      <Text style={[s.rowLabel, isLight && s.metaLight]}>{label}</Text>
      <Text style={[s.rowValue, isLight && s.titleLight, color && { color }]}>{value}</Text>
    </View>
  );
}

// ─── BOMsScreen ──────────────────────────────────────────────────────────────

export default function BOMsScreen({ tenant, offlineMode, pageSize = 20 }) {
  const themeMode = useThemeMode();
  const isLight = themeMode === 'light';
  const [search, setSearch] = useState('');
  const [selectedBom, setSelectedBom] = useState(null);
  const [detailVisible, setDetailVisible] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);

  const {
    items, page, totalPages, loading, error, cacheInfo,
    refreshing, reload, filters, changePage, updateFilters,
  } = usePaginatedList({
    tenantId: tenant?.tenant_id,
    pageSize,
    offlineMode,
    cacheNamespace: 'inventory-boms',
    initialFilters: { search: '', type: '' },
    fetchPage: async ({ page: nextPage, pageSize: ps, filters: f, tenantId }) => {
      return listBoms({
        tenantId,
        search: f?.search || '',
        type: f?.type || null,
        limit: ps,
        offset: (nextPage - 1) * ps,
      });
    },
  });

  const openDetail = async (item) => {
    setDetailLoading(true);
    const result = await getBOMById(tenant.tenant_id, item.bom_id);
    setDetailLoading(false);
    if (result.success) {
      setSelectedBom(result.data);
      setDetailVisible(true);
    } else {
      Alert.alert('Error', humanizeAppError(result.error));
    }
  };

  return (
    <View style={[s.container, isLight && s.containerLight]}>
      <View style={s.toolbar}>
        <TextInput
          style={[s.searchInput, isLight && s.searchInputLight]}
          value={search}
          onChangeText={setSearch}
          placeholder="Buscar BOM"
          placeholderTextColor="#64748b"
          onSubmitEditing={() => updateFilters({ search })}
        />
        <Pressable style={s.searchBtn} onPress={() => updateFilters({ search })}>
          <Text style={s.searchBtnText}>Buscar</Text>
        </Pressable>
      </View>

      <View style={s.filtersBlock}>
        <SearchableSelectField
          title="Tipo de BOM"
          themeMode={themeMode}
          valueLabel="Todos"
          clearLabel="Todos"
          placeholder="Todos"
          searchPlaceholder="Buscar tipo..."
          options={TYPE_FILTER_OPTIONS}
          selectedKey={filters?.type || ''}
          onSelect={(v) => updateFilters({ type: v || '' })}
        />
      </View>

      <PaginatedList
        themeMode={themeMode}
        title="Listas de Materiales (BOMs)"
        loading={loading || detailLoading}
        refreshing={refreshing}
        onRefresh={reload}
        error={error}
        items={items}
        emptyText="No hay BOMs para este filtro."
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
          <Pressable key={item.bom_id} onPress={() => openDetail(item)}>
            <View style={[s.card, isLight && s.cardLight]}>
              <Text style={[s.title, isLight && s.titleLight]}>{item.bom_name || 'BOM sin nombre'}</Text>
              <Text style={[s.meta, isLight && s.metaLight]}>
                {item.product
                  ? `Producto: ${item.product.name}`
                  : item.variant
                    ? `Variante: ${item.variant.sku || ''} — ${item.variant.variant_name || ''}`
                    : 'Sin destino'}
              </Text>
              <View style={s.badgesRow}>
                <View style={[s.badge, isLight && s.badgeLight, { borderColor: '#235ea9' }]}>
                  <Text style={[s.badgeText, isLight && s.badgeTextLight]}>{(item.bom_components || []).length} componente(s)</Text>
                </View>
                <View style={[s.badge, isLight && s.badgeLight, { borderColor: '#a78bfa' }]}>
                  <Text style={[s.badgeText, isLight && s.badgeTextLight]}>v{item.version || 1}</Text>
                </View>
                <View style={[s.badge, isLight && s.badgeLight, { borderColor: item.is_active ? '#16a34a' : '#ef4444' }]}>
                  <Text style={[s.badgeText, isLight && s.badgeTextLight]}>{item.is_active ? 'Activo' : 'Inactivo'}</Text>
                </View>
              </View>
              {item.notes ? <Text style={[s.note, isLight && s.metaLight]}>{item.notes}</Text> : null}
              <Text style={[s.tapHint, isLight && { color: '#94a3b8' }]}>Toca para ver componentes →</Text>
            </View>
          </Pressable>
        )}
      />

      {selectedBom && (
        <BOMDetailModal
          bom={selectedBom}
          visible={detailVisible}
          onClose={() => { setDetailVisible(false); setSelectedBom(null); }}
          isLight={isLight}
        />
      )}
    </View>
  );
}

// ─── Estilos ──────────────────────────────────────────────────────────────────

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#060b16', padding: 12 },
  containerLight: { backgroundColor: '#edf2fb' },
  toolbar: { flexDirection: 'row', gap: 8, marginBottom: 8 },
  searchInput: {
    flex: 1, minHeight: 42, borderRadius: 8, borderWidth: 1,
    borderColor: '#334155', backgroundColor: '#111827', color: '#f8fafc', paddingHorizontal: 10,
  },
  searchInputLight: { borderColor: '#cbd5e1', backgroundColor: '#ffffff', color: '#0f172a' },
  searchBtn: { backgroundColor: '#235ea9', borderRadius: 8, paddingHorizontal: 12, alignItems: 'center', justifyContent: 'center' },
  searchBtnText: { color: '#dbeafe', fontWeight: '700' },
  filtersBlock: { marginBottom: 8 },
  card: {
    backgroundColor: '#111827', borderWidth: 1, borderColor: '#1f2937',
    borderRadius: 12, padding: 12, marginBottom: 8,
  },
  cardLight: { backgroundColor: '#ffffff', borderColor: '#dbe4ef' },
  title: { color: '#f8fafc', fontWeight: '700', fontSize: 15 },
  titleLight: { color: '#0f172a' },
  meta: { color: '#cbd5e1', marginTop: 2, fontSize: 13 },
  metaLight: { color: '#475569' },
  note: { color: '#94a3b8', marginTop: 8, fontSize: 12 },
  tapHint: { color: '#475569', fontSize: 11, marginTop: 6 },
  badgesRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 8 },
  badge: {
    borderWidth: 1, borderRadius: 999, paddingHorizontal: 8, paddingVertical: 4,
    backgroundColor: '#0f172a',
  },
  badgeLight: { backgroundColor: '#f8fafc' },
  badgeText: { color: '#e2e8f0', fontSize: 11, fontWeight: '700' },
  badgeTextLight: { color: '#334155' },
  emptyText: { color: '#64748b', textAlign: 'center', marginTop: 12 },
  // Modal
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.7)', justifyContent: 'flex-end' },
  modalCard: {
    backgroundColor: '#111827', borderTopLeftRadius: 20, borderTopRightRadius: 20,
    padding: 16, maxHeight: '88%',
  },
  modalCardLight: { backgroundColor: '#ffffff' },
  modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
  modalTitle: { color: '#f8fafc', fontWeight: '700', fontSize: 17, flex: 1 },
  closeBtn: { padding: 4 },
  closeBtnText: { color: '#94a3b8', fontSize: 18 },
  section: { backgroundColor: '#0f172a', borderRadius: 10, padding: 12, marginBottom: 10 },
  sectionLight: { backgroundColor: '#f1f5f9' },
  sectionTitle: { color: '#f8fafc', fontWeight: '700', fontSize: 13, marginBottom: 8 },
  row: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 3 },
  rowLabel: { color: '#94a3b8', fontSize: 13 },
  rowValue: { color: '#e2e8f0', fontSize: 13, fontWeight: '600', textAlign: 'right', flex: 1, marginLeft: 8 },
  compRow: {
    paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: '#1f2937',
  },
  compRowLight: { borderBottomColor: '#e2e8f0' },
  compName: { color: '#f8fafc', fontSize: 13, fontWeight: '600' },
  compMeta: { color: '#94a3b8', fontSize: 12, marginTop: 2 },
  compCost: { color: '#64748b', fontSize: 11, marginTop: 2 },
  totalRow: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    marginTop: 10, paddingTop: 10, borderTopWidth: 1, borderTopColor: '#334155',
  },
  totalRowLight: { borderTopColor: '#cbd5e1' },
  totalLabel: { color: '#94a3b8', fontSize: 13 },
  totalValue: { color: '#f8fafc', fontSize: 15, fontWeight: '700' },
});
