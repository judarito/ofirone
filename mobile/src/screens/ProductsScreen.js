import { useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import BottomSheetModal from '../components/BottomSheetModal';
import ListHeaderActionButton from '../components/ListHeaderActionButton';
import PaginatedList from '../components/PaginatedList';
import ProductCreationWizardSheet from '../components/ProductCreationWizardSheet';
import ProductVariantWizardSheet from '../components/ProductVariantWizardSheet';
import SearchableSelectField from '../components/SearchableSelectField';
import { COMMON_TEXT } from '../constants/uiText';
import { usePaginatedList } from '../hooks/usePaginatedList';
import { useAndroidBottomInset } from '../lib/useAndroidBottomInset';
import { useThemeMode } from '../lib/themeMode';
import { createCategory } from '../services/categories.service';
import {
  deleteProductPhoto,
  listProductMedia,
  MAX_PRODUCT_PHOTOS,
  setProductCover,
  uploadProductPhoto,
} from '../services/productMedia.service';
import {
  createProduct,
  getProductById,
  listCategoryOptions,
  listProducts,
  removeVariant,
  removeProduct,
  updateProduct,
} from '../services/productsCatalog.service';
import { listActiveUnits } from '../services/units.service';

const PRODUCT_TAB_OPTIONS = [
  { key: 'products', label: 'Productos para venta', value: false },
  { key: 'components', label: 'Insumos/componentes', value: true },
];

const EMPTY_FORM = {
  product_id: null,
  name: '',
  description: '',
  category_id: null,
  unit_id: null,
  is_active: true,
  track_inventory: true,
  requires_expiration: false,
  inventory_behavior: 'RESELL',
  is_component: false,
};

function boolText(value, yes, no) {
  return value ? yes : no;
}

function normalizeText(value) {
  return String(value || '').trim();
}

function formatBytes(value) {
  const bytes = Number(value || 0);
  if (!bytes) return 'Tamano no disponible';
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

function sortByName(items) {
  return [...(items || [])].sort((a, b) => String(a?.name || '').localeCompare(String(b?.name || ''), 'es', { sensitivity: 'base' }));
}

function buildAiDescription(currentDescription, media) {
  const current = normalizeText(currentDescription);
  if (current) return current;

  const suggested = normalizeText(media?.ai_suggested_description);
  if (suggested) return suggested;

  const brand = normalizeText(media?.ai_detected_brand);
  if (brand) return `Marca sugerida por IA: ${brand}`;

  return currentDescription;
}

function hasApplicableAiSuggestion(media) {
  return Boolean(
    normalizeText(media?.ai_detected_name)
    || normalizeText(media?.ai_detected_category)
    || normalizeText(media?.ai_detected_brand)
    || normalizeText(media?.ai_suggested_description),
  );
}

export default function ProductsScreen({ tenant, offlineMode, pageSize = 20 }) {
  const themeMode = useThemeMode();
  const isLightTheme = themeMode === 'light';
  const androidBottomInset = useAndroidBottomInset();
  const [saving, setSaving] = useState(false);
  const [search, setSearch] = useState('');
  const [createWizardOpen, setCreateWizardOpen] = useState(false);
  const [editWizardOpen, setEditWizardOpen] = useState(false);
  const [editingProduct, setEditingProduct] = useState(null);
  const [variantWizardOpen, setVariantWizardOpen] = useState(false);
  const [variantWizardProduct, setVariantWizardProduct] = useState(null);
  const [variantWizardVariant, setVariantWizardVariant] = useState(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [categoryOptions, setCategoryOptions] = useState([]);
  const [unitOptions, setUnitOptions] = useState([]);
  const [expandedVariants, setExpandedVariants] = useState({});
  const [productMedia, setProductMedia] = useState([]);
  const [mediaLoading, setMediaLoading] = useState(false);
  const [mediaBusy, setMediaBusy] = useState(false);
  const [mediaError, setMediaError] = useState('');
  const [mediaNotice, setMediaNotice] = useState('');
  const [selectedMediaId, setSelectedMediaId] = useState(null);

  const categorySelectOptions = useMemo(
    () =>
      (categoryOptions || []).map((cat) => ({
        key: cat.category_id,
        label: cat.name,
        searchText: cat.name,
      })),
    [categoryOptions],
  );

  const unitSelectOptions = useMemo(
    () =>
      (unitOptions || []).map((unit) => ({
        key: unit.unit_id,
        label: `${unit.code} - ${unit.name}${unit.is_system ? ' (sistema)' : ''}`,
        searchText: `${unit.code} ${unit.name}`,
      })),
    [unitOptions],
  );

  const selectedMedia = useMemo(
    () => productMedia.find((item) => item.media_id === selectedMediaId) || productMedia[0] || null,
    [productMedia, selectedMediaId],
  );

  const {
    items: rows,
    page,
    totalPages,
    loading,
    error,
    cacheInfo,
    refreshing,
    reload,
    filters,
    setError,
    changePage,
    updateFilters,
    loadPage,
  } = usePaginatedList({
    tenantId: tenant?.tenant_id,
    pageSize,
    offlineMode,
    cacheNamespace: 'catalog-products',
    initialFilters: { search: '', isComponent: false },
    fetchPage: async ({ page: nextPage, pageSize: nextPageSize, filters: nextFilters, tenantId }) => {
      const offset = (nextPage - 1) * nextPageSize;
      return listProducts({
        tenantId,
        search: nextFilters?.search || '',
        limit: nextPageSize,
        offset,
        isComponent: nextFilters?.isComponent,
      });
    },
  });

  useEffect(() => {
    const loadLookups = async () => {
      if (!tenant?.tenant_id) return;
      const [cats, units] = await Promise.all([
        listCategoryOptions(tenant.tenant_id),
        listActiveUnits(tenant.tenant_id),
      ]);

      if (cats.success) setCategoryOptions(cats.data || []);
      if (units.success) setUnitOptions(units.data || []);
    };

    loadLookups();
  }, [tenant?.tenant_id]);

  useEffect(() => {
    if (!modalOpen || !form.product_id || !tenant?.tenant_id) {
      if (!modalOpen || !form.product_id) {
        setProductMedia([]);
        setSelectedMediaId(null);
        setMediaError('');
        setMediaNotice('');
      }
      return;
    }

    const loadMedia = async () => {
      setMediaLoading(true);
      setMediaError('');
      const result = await listProductMedia({
        tenantId: tenant.tenant_id,
        productId: form.product_id,
      });

      if (!result.success) {
        setProductMedia([]);
        setSelectedMediaId(null);
        setMediaError(result.error || 'No se pudieron cargar las fotos del producto.');
        setMediaLoading(false);
        return;
      }

      setProductMedia(result.data || []);
      setSelectedMediaId((prev) => prev || result.data?.[0]?.media_id || null);
      setMediaLoading(false);
    };

    loadMedia();
  }, [form.product_id, modalOpen, tenant?.tenant_id]);

  useEffect(() => {
    if (!selectedMediaId && productMedia.length) {
      setSelectedMediaId(productMedia[0].media_id);
      return;
    }

    if (selectedMediaId && !productMedia.some((item) => item.media_id === selectedMediaId)) {
      setSelectedMediaId(productMedia[0]?.media_id || null);
    }
  }, [productMedia, selectedMediaId]);

  const closeModal = () => {
    setModalOpen(false);
    setForm({ ...EMPTY_FORM });
    setProductMedia([]);
    setSelectedMediaId(null);
    setMediaBusy(false);
    setMediaError('');
    setMediaNotice('');
  };

  const openCreate = () => {
    setCreateWizardOpen(true);
  };

  const openAdvancedEditor = (item) => {
    setForm({
      product_id: item.product_id,
      name: item.name || '',
      description: item.description || '',
      category_id: item.category_id || null,
      unit_id: item.unit_id || null,
      is_active: item.is_active !== false,
      track_inventory: item.track_inventory !== false,
      requires_expiration: item.requires_expiration === true,
      inventory_behavior: item.inventory_behavior || 'RESELL',
      is_component: item.is_component === true,
    });
    setProductMedia([]);
    setSelectedMediaId(null);
    setMediaError('');
    setMediaNotice('');
    setModalOpen(true);
  };

  const openEdit = async (item) => {
    if (!tenant?.tenant_id || !item?.product_id) return;
    const result = await getProductById(item.product_id, tenant.tenant_id);
    if (!result.success) {
      setError(result.error || 'No se pudo cargar el producto para editar.');
      return;
    }

    setEditingProduct(result.data);
    setEditWizardOpen(true);
  };

  const refreshEditingProduct = async (productId = editingProduct?.product_id) => {
    if (!tenant?.tenant_id || !productId) return;
    const result = await getProductById(productId, tenant.tenant_id);
    if (result.success) {
      setEditingProduct(result.data);
    }
  };

  const refreshRows = async () => {
    await loadPage(page, filters);
  };

  const handleVariantSaved = async ({ message }) => {
    await refreshRows();
    await refreshEditingProduct(variantWizardProduct?.product_id);
    Alert.alert('Variante guardada', message || 'La variante fue guardada correctamente.');
  };

  const openCreateVariantForEditingProduct = () => {
    if (!editingProduct) return;
    setVariantWizardProduct(editingProduct);
    setVariantWizardVariant(null);
    setVariantWizardOpen(true);
  };

  const openEditVariantForEditingProduct = (variant) => {
    if (!editingProduct || !variant) return;
    setVariantWizardProduct(editingProduct);
    setVariantWizardVariant(variant);
    setVariantWizardOpen(true);
  };

  const removeVariantFromEditingProduct = (variant) => {
    if (!tenant?.tenant_id || !variant?.variant_id) return;

    Alert.alert('Eliminar variante', `Se eliminará ${variant.variant_name || 'esta variante'}.`, [
      { text: 'Cancelar', style: 'cancel' },
      {
        text: 'Eliminar',
        style: 'destructive',
        onPress: async () => {
          const result = await removeVariant(variant.variant_id, tenant.tenant_id);
          if (!result.success) {
            setError(result.error || 'No se pudo eliminar la variante.');
            return;
          }

          await refreshRows();
          await refreshEditingProduct(editingProduct?.product_id);
        },
      },
    ]);
  };

  const save = async () => {
    if (offlineMode) {
      setError('Productos no permite escritura en modo offline.');
      return;
    }

    const name = normalizeText(form.name);
    if (!name) {
      setError('Nombre del producto es obligatorio.');
      return;
    }

    setSaving(true);
    setError('');

    const payload = {
      tenant_id: tenant?.tenant_id,
      name,
      description: normalizeText(form.description) || null,
      category_id: form.category_id || null,
      unit_id: form.unit_id || null,
      is_active: form.is_active !== false,
      track_inventory: form.track_inventory !== false,
      requires_expiration: form.requires_expiration === true,
      inventory_behavior: form.inventory_behavior || 'RESELL',
      is_component: form.is_component === true,
    };

    const result = form.product_id
      ? await updateProduct(form.product_id, tenant?.tenant_id, payload)
      : await createProduct(payload);

    if (!result.success) {
      setError(result.error || 'No se pudo guardar producto');
      setSaving(false);
      return;
    }

    await refreshRows();
    setSaving(false);
    closeModal();
  };

  const remove = (item) => {
    Alert.alert('Eliminar producto', `Se eliminara ${item.name}.`, [
      { text: 'Cancelar', style: 'cancel' },
      {
        text: 'Eliminar',
        style: 'destructive',
        onPress: async () => {
          if (offlineMode) {
            setError('No puedes eliminar productos en modo offline.');
            return;
          }

          const result = await removeProduct(item.product_id, tenant?.tenant_id);
          if (!result.success) {
            setError(result.error || 'No se pudo eliminar producto');
            return;
          }

          await refreshRows();
        },
      },
    ]);
  };

  const handleAddPhoto = async (source = 'library') => {
    if (offlineMode) {
      setMediaError('Las fotos del producto requieren conexión online.');
      return;
    }
    if (!form.product_id || !tenant?.tenant_id) {
      setMediaError('Guarda el producto primero para poder adjuntar fotos.');
      return;
    }

    setMediaBusy(true);
    setMediaError('');
    setMediaNotice('');

    const result = await uploadProductPhoto({
      tenantId: tenant.tenant_id,
      productId: form.product_id,
      source,
      currentCount: productMedia.length,
      analyzeWithAi: true,
    });

    if (result.cancelled) {
      setMediaBusy(false);
      return;
    }

    if (!result.success) {
      setMediaError(result.error || 'No se pudo subir la foto.');
      setMediaBusy(false);
      return;
    }

    const refreshed = await listProductMedia({
      tenantId: tenant.tenant_id,
      productId: form.product_id,
    });

    if (refreshed.success) {
      setProductMedia(refreshed.data || []);
    }
    setSelectedMediaId(result.data?.media_id || null);
    setMediaNotice(
      result.data?.ai_status === 'READY'
        ? 'Foto cargada y analizada por IA.'
        : 'Foto cargada. La sugerencia IA no estuvo disponible para esta imagen.',
    );
    await refreshRows();
    setMediaBusy(false);
  };

  const handleSetCover = async (mediaId) => {
    if (!tenant?.tenant_id || !form.product_id || !mediaId) return;
    setMediaBusy(true);
    setMediaError('');
    setMediaNotice('');

    const result = await setProductCover({
      tenantId: tenant.tenant_id,
      productId: form.product_id,
      mediaId,
    });

    if (!result.success) {
      setMediaError(result.error || 'No se pudo marcar la foto como portada.');
      setMediaBusy(false);
      return;
    }

    const refreshed = await listProductMedia({
      tenantId: tenant.tenant_id,
      productId: form.product_id,
    });

    if (refreshed.success) {
      setProductMedia(refreshed.data || []);
    }
    setSelectedMediaId(mediaId);
    setMediaNotice('Portada actualizada.');
    await refreshRows();
    setMediaBusy(false);
  };

  const handleDeletePhoto = (media) => {
    if (!media?.media_id || !tenant?.tenant_id) return;

    Alert.alert('Eliminar foto', 'Esta foto se eliminara del producto.', [
      { text: 'Cancelar', style: 'cancel' },
      {
        text: 'Eliminar',
        style: 'destructive',
        onPress: async () => {
          setMediaBusy(true);
          setMediaError('');
          setMediaNotice('');

          const result = await deleteProductPhoto({
            tenantId: tenant.tenant_id,
            mediaId: media.media_id,
          });

          if (!result.success) {
            setMediaError(result.error || 'No se pudo eliminar la foto.');
            setMediaBusy(false);
            return;
          }

          const refreshed = await listProductMedia({
            tenantId: tenant.tenant_id,
            productId: form.product_id,
          });

          if (refreshed.success) {
            setProductMedia(refreshed.data || []);
          } else {
            setProductMedia([]);
          }

          setSelectedMediaId(null);
          setMediaNotice(result.warning || 'Foto eliminada.');
          await refreshRows();
          setMediaBusy(false);
        },
      },
    ]);
  };

  const applyAiSuggestion = async (media) => {
    if (!media) return;

    let nextCategoryId = form.category_id;
    const suggestedCategory = normalizeText(media.ai_detected_category);
    let createdCategory = null;

    if (suggestedCategory) {
      const existing = categoryOptions.find(
        (item) => normalizeText(item.name).toLowerCase() === suggestedCategory.toLowerCase(),
      );

      if (existing) {
        nextCategoryId = existing.category_id;
      } else if (!offlineMode && tenant?.tenant_id) {
        const result = await createCategory({
          tenant_id: tenant.tenant_id,
          name: suggestedCategory,
          parent_category_id: null,
        });

        if (result.success && result.data?.category_id) {
          createdCategory = result.data;
          nextCategoryId = result.data.category_id;
          setCategoryOptions((prev) => sortByName([...prev, result.data]));
        }
      }
    }

    setForm((prev) => ({
      ...prev,
      name: normalizeText(media.ai_detected_name) || prev.name,
      category_id: nextCategoryId,
      description: buildAiDescription(prev.description, media),
    }));

    setMediaNotice(
      createdCategory
        ? `Sugerencia IA aplicada. También se creó la categoría "${createdCategory.name}".`
        : 'Sugerencia IA aplicada al formulario. Revisa y guarda el producto.',
    );
  };

  const mediaLimitReached = productMedia.length >= MAX_PRODUCT_PHOTOS;
  const editingVariants = editingProduct?.product_variants || [];

  const renderEditWizardSupplementary = () => (
    <View style={[styles.summaryCard, isLightTheme && styles.summaryCardLight]}>
      <Text style={[styles.summaryTitle, isLightTheme && styles.summaryTitleLight]}>Complementos del producto</Text>
      <Text style={[styles.summaryText, isLightTheme && styles.summaryTextLight]}>
        Variantes y fotos siguen disponibles, pero ya no te sacan del flujo guiado principal.
      </Text>

      <View style={styles.editSupplementaryActions}>
        <Pressable style={styles.secondaryBtn} onPress={openCreateVariantForEditingProduct}>
          <View style={styles.btnContentRow}>
            <Ionicons name="add-outline" size={15} color="#dbeafe" />
            <Text style={styles.secondaryBtnText}>Agregar variante</Text>
          </View>
        </Pressable>
        <Pressable style={styles.secondaryBtn} onPress={() => openAdvancedEditor(editingProduct)}>
          <View style={styles.btnContentRow}>
            <Ionicons name="images-outline" size={15} color="#dbeafe" />
            <Text style={styles.secondaryBtnText}>Fotos e IA</Text>
          </View>
        </Pressable>
      </View>

      {editingVariants.length ? (
        <View style={styles.editSupplementaryList}>
          {editingVariants.map((variant) => (
            <View key={variant.variant_id} style={[styles.variantRow, isLightTheme && styles.variantRowLight]}>
              <Text style={[styles.variantName, isLightTheme && styles.variantNameLight]}>
                {variant.variant_name || 'Predeterminada'}
              </Text>
              <Text style={[styles.variantMeta, isLightTheme && styles.variantMetaLight]}>
                SKU: {variant.sku || '-'} · Precio: {Number(variant.price || 0).toLocaleString('es-CO')} · Costo: {Number(variant.cost || 0).toLocaleString('es-CO')}
              </Text>
              <Text style={[styles.variantMeta, isLightTheme && styles.variantMetaLight]}>
                Alerta mínima: {variant.min_stock ?? 0}
              </Text>
              <View style={styles.actions}>
                <Pressable style={styles.secondaryBtn} onPress={() => openEditVariantForEditingProduct(variant)}>
                  <View style={styles.btnContentRow}>
                    <Ionicons name="create-outline" size={15} color="#dbeafe" />
                    <Text style={styles.secondaryBtnText}>Editar</Text>
                  </View>
                </Pressable>
                <Pressable style={styles.dangerBtn} onPress={() => removeVariantFromEditingProduct(variant)}>
                  <View style={styles.btnContentRow}>
                    <Ionicons name="trash-outline" size={15} color="#fee2e2" />
                    <Text style={styles.dangerBtnText}>Eliminar</Text>
                  </View>
                </Pressable>
              </View>
            </View>
          ))}
        </View>
      ) : (
        <Text style={[styles.summaryText, isLightTheme && styles.summaryTextLight]}>
          Aún no hay variantes registradas para este producto.
        </Text>
      )}
    </View>
  );

  return (
    <View style={[styles.container, isLightTheme && styles.containerLight]}>
      <ProductCreationWizardSheet
        visible={createWizardOpen}
        onClose={() => setCreateWizardOpen(false)}
        themeMode={themeMode}
        tenantId={tenant?.tenant_id}
        categoryOptions={categoryOptions}
        unitOptions={unitOptions}
        defaultProfileId={filters?.isComponent ? 'component' : 'sale_simple'}
        onSaved={async ({ message, color }) => {
          await refreshRows();
          Alert.alert(
            color === 'warning' ? 'Producto creado con pendiente' : 'Producto creado',
            message || 'El producto fue creado correctamente.',
          );
        }}
      />

      <ProductCreationWizardSheet
        visible={editWizardOpen}
        onClose={() => setEditWizardOpen(false)}
        themeMode={themeMode}
        tenantId={tenant?.tenant_id}
        categoryOptions={categoryOptions}
        unitOptions={unitOptions}
        mode="edit"
        initialProduct={editingProduct}
        onSaved={async ({ product, message, color }) => {
          setEditingProduct(product || editingProduct);
          await refreshRows();
          Alert.alert(
            color === 'warning' ? 'Producto actualizado con pendiente' : 'Producto actualizado',
            message || 'El producto fue actualizado correctamente.',
          );
        }}
        renderSupplementary={renderEditWizardSupplementary}
      />

      <ProductVariantWizardSheet
        visible={variantWizardOpen}
        onClose={() => setVariantWizardOpen(false)}
        themeMode={themeMode}
        tenantId={tenant?.tenant_id}
        product={variantWizardProduct}
        variant={variantWizardVariant}
        unitOptions={unitOptions}
        onSaved={handleVariantSaved}
      />

      <View style={styles.filtersBlock}>
        <SearchableSelectField
          title="Tipo de catalogo"
          themeMode={themeMode}
          valueLabel={Boolean(filters?.isComponent) ? 'Insumos/componentes' : 'Productos para venta'}
          placeholder="Seleccionar tipo"
          searchPlaceholder="Buscar tipo..."
          options={PRODUCT_TAB_OPTIONS.map((entry) => ({ key: entry.key, label: entry.label, searchText: entry.label }))}
          selectedKey={Boolean(filters?.isComponent) ? 'components' : 'products'}
          onSelect={(nextValue) =>
            updateFilters({ isComponent: PRODUCT_TAB_OPTIONS.find((entry) => entry.key === nextValue)?.value === true })
          }
          allowClear={false}
        />
      </View>

      <View style={styles.toolbar}>
        <TextInput
          style={[styles.searchInput, isLightTheme && styles.searchInputLight]}
          value={search}
          onChangeText={setSearch}
          placeholder="Buscar por nombre o descripcion"
          placeholderTextColor="#64748b"
          onSubmitEditing={() => updateFilters({ search })}
        />
        <Pressable style={styles.searchBtn} onPress={() => updateFilters({ search })}>
          <View style={styles.btnContentRow}>
            <Ionicons name="search-outline" size={16} color="#dbeafe" />
            <Text style={styles.searchBtnText}>Buscar</Text>
          </View>
        </Pressable>
      </View>

      <PaginatedList
        themeMode={themeMode}
        title={filters?.isComponent ? 'Insumos / Componentes' : 'Productos'}
        loading={loading}
        refreshing={refreshing}
        onRefresh={reload}
        error={error}
        items={rows}
        emptyText="No hay productos registrados."
        page={page}
        totalPages={totalPages}
        onPrev={() => changePage(page - 1)}
        onNext={() => changePage(page + 1)}
        footerMeta={
          cacheInfo?.source === 'cache' && cacheInfo?.cachedAt
            ? `Caché offline: ${new Date(cacheInfo.cachedAt).toLocaleString()}`
            : null
        }
        bottomInset={androidBottomInset}
        headerRight={<ListHeaderActionButton themeMode={themeMode} label="Nuevo" onPress={openCreate} />}
        renderItem={(item) => (
          <View key={item.product_id} style={[styles.card, isLightTheme && styles.cardLight]}>
            <View style={styles.cardHeader}>
              {item.cover_image_url ? (
                <Image source={{ uri: item.cover_image_url }} style={styles.cardThumb} resizeMode="cover" />
              ) : (
                <View style={[styles.cardThumbPlaceholder, isLightTheme && styles.cardThumbPlaceholderLight]}>
                  <Ionicons name="image-outline" size={24} color={isLightTheme ? '#64748b' : '#93c5fd'} />
                </View>
              )}

              <View style={styles.cardContent}>
                <Text style={[styles.title, isLightTheme && styles.titleLight]}>{item.name}</Text>
                <Text style={[styles.meta, isLightTheme && styles.metaLight]}>{item.category?.name || 'Sin categoria'}</Text>
                <Text style={[styles.meta, isLightTheme && styles.metaLight]}>
                  {item.unit ? `${item.unit.code} - ${item.unit.name}` : 'Sin unidad'}
                </Text>
              </View>
            </View>

            <View style={styles.badgesRow}>
              <View style={[styles.badge, item.is_active ? styles.badgeGreen : styles.badgeRed]}>
                <Text style={styles.badgeText}>{item.is_active ? 'Activo' : 'Inactivo'}</Text>
              </View>
              <View style={[styles.badge, styles.badgeBlue]}>
                <Text style={styles.badgeText}>{item.product_variants?.length || 0} variante(s)</Text>
              </View>
              {item.track_inventory ? (
                <View style={[styles.badge, styles.badgeSky]}>
                  <Text style={styles.badgeText}>Inventario</Text>
                </View>
              ) : null}
              {item.media_count ? (
                <View style={[styles.badge, styles.badgeAmber]}>
                  <Text style={styles.badgeText}>{item.media_count} foto(s)</Text>
                </View>
              ) : null}
            </View>

            {(item.product_variants || []).length > 0 ? (
              <Pressable
                style={[styles.variantToggleBtn, isLightTheme && styles.variantToggleBtnLight]}
                onPress={() =>
                  setExpandedVariants((prev) => ({
                    ...prev,
                    [item.product_id]: !prev[item.product_id],
                  }))
                }
              >
                <View style={styles.btnContentRow}>
                  <Ionicons
                    name={expandedVariants[item.product_id] ? 'eye-off-outline' : 'eye-outline'}
                    size={14}
                    color={isLightTheme ? '#235ea9' : '#eff6ff'}
                  />
                  <Text style={[styles.variantToggleText, isLightTheme && styles.variantToggleTextLight]}>
                    {expandedVariants[item.product_id] ? 'Ocultar variantes' : 'Ver variantes'}
                  </Text>
                </View>
              </Pressable>
            ) : null}

            {expandedVariants[item.product_id] ? (
              <View style={[styles.variantsBox, isLightTheme && styles.variantsBoxLight]}>
                {(item.product_variants || []).map((variant) => (
                  <View key={variant.variant_id} style={[styles.variantRow, isLightTheme && styles.variantRowLight]}>
                    <Text style={[styles.variantName, isLightTheme && styles.variantNameLight]}>
                      {variant.variant_name || 'Variante sin nombre'}
                    </Text>
                    <Text style={[styles.variantMeta, isLightTheme && styles.variantMetaLight]}>
                      SKU: {variant.sku || '-'} · Precio: {Number(variant.price || 0).toLocaleString('es-CO')} · Costo: {Number(variant.cost || 0).toLocaleString('es-CO')}
                    </Text>
                    <Text style={[styles.variantMeta, isLightTheme && styles.variantMetaLight]}>
                      Min stock: {variant.min_stock ?? '-'} · {variant.is_active ? 'Activa' : 'Inactiva'}
                    </Text>
                  </View>
                ))}
              </View>
            ) : null}

            <View style={styles.actions}>
              <Pressable style={styles.secondaryBtn} onPress={() => openEdit(item)}>
                <View style={styles.btnContentRow}>
                  <Ionicons name="create-outline" size={15} color="#dbeafe" />
                  <Text style={styles.secondaryBtnText}>Editar</Text>
                </View>
              </Pressable>
              <Pressable style={styles.dangerBtn} onPress={() => remove(item)}>
                <View style={styles.btnContentRow}>
                  <Ionicons name="trash-outline" size={15} color="#fee2e2" />
                  <Text style={styles.dangerBtnText}>Eliminar</Text>
                </View>
              </Pressable>
            </View>
          </View>
        )}
      />

      <BottomSheetModal
        visible={modalOpen}
        onClose={closeModal}
        themeMode={themeMode}
        maxHeight="94%"
        footer={(
          <View style={styles.modalFooter}>
            <Pressable style={[styles.modalFooterBtn, styles.primaryBtn]} onPress={save} disabled={saving}>
              <View style={styles.btnContentRow}>
                <Ionicons name={saving ? 'hourglass-outline' : 'save-outline'} size={16} color="#062915" />
                <Text style={styles.primaryBtnText}>{saving ? 'Guardando...' : 'Guardar'}</Text>
              </View>
            </Pressable>
            <Pressable style={[styles.modalFooterBtn, styles.closeBtn]} onPress={closeModal}>
              <View style={styles.btnContentRow}>
                <Ionicons name="close-circle-outline" size={16} color="#fff" />
                <Text style={styles.closeBtnText}>Cerrar</Text>
              </View>
            </Pressable>
          </View>
        )}
      >
        <Text style={[styles.modalTitle, isLightTheme && styles.modalTitleLight]}>
          Fotos y detalles avanzados
        </Text>

        <TextInput
          style={[styles.input, isLightTheme && styles.inputLight]}
          value={form.name}
          onChangeText={(v) => setForm((prev) => ({ ...prev, name: v }))}
          placeholder="Nombre *"
          placeholderTextColor="#64748b"
        />

        <TextInput
          style={[styles.input, isLightTheme && styles.inputLight, styles.descriptionInput]}
          value={form.description}
          onChangeText={(v) => setForm((prev) => ({ ...prev, description: v }))}
          placeholder="Descripcion"
          placeholderTextColor="#64748b"
          multiline
        />

        <Text style={[styles.groupTitle, isLightTheme && styles.groupTitleLight]}>Tipo</Text>
        <View style={styles.toggleRow}>
          <Pressable
            style={[
              styles.toggleBtn,
              isLightTheme && styles.toggleBtnLight,
              !form.is_component && styles.toggleBtnActive,
              !form.is_component && isLightTheme && styles.toggleBtnActiveLight,
            ]}
            onPress={() =>
              setForm((prev) => ({ ...prev, is_component: false, inventory_behavior: 'RESELL' }))
            }
          >
            <Text style={[styles.toggleBtnText, isLightTheme && styles.toggleBtnTextLight, !form.is_component && styles.toggleBtnTextActive]}>
              Producto para venta
            </Text>
          </Pressable>
          <Pressable
            style={[
              styles.toggleBtn,
              isLightTheme && styles.toggleBtnLight,
              form.is_component && styles.toggleBtnActive,
              form.is_component && isLightTheme && styles.toggleBtnActiveLight,
            ]}
            onPress={() =>
              setForm((prev) => ({ ...prev, is_component: true, inventory_behavior: 'RESELL', track_inventory: true }))
            }
          >
            <Text style={[styles.toggleBtnText, isLightTheme && styles.toggleBtnTextLight, form.is_component && styles.toggleBtnTextActive]}>
              Componente
            </Text>
          </Pressable>
        </View>

        <SearchableSelectField
          title="Categoría"
          themeMode={themeMode}
          valueLabel="Sin categoria"
          clearLabel="Sin categoria"
          placeholder="Seleccionar categoria"
          searchPlaceholder="Buscar categoria..."
          options={categorySelectOptions}
          selectedKey={form.category_id}
          onSelect={(nextValue) => setForm((prev) => ({ ...prev, category_id: nextValue }))}
        />

        <SearchableSelectField
          title="Unidad de medida"
          themeMode={themeMode}
          valueLabel="Sin unidad"
          clearLabel="Sin unidad"
          placeholder="Seleccionar unidad"
          searchPlaceholder="Buscar unidad..."
          options={unitSelectOptions}
          selectedKey={form.unit_id}
          onSelect={(nextValue) => setForm((prev) => ({ ...prev, unit_id: nextValue }))}
        />

        <Text style={[styles.groupTitle, isLightTheme && styles.groupTitleLight]}>Configuracion</Text>
        <View style={styles.switchRowWrap}>
          <Pressable
            style={[
              styles.switchCard,
              isLightTheme && styles.switchCardLight,
              form.is_active && styles.switchCardActive,
              form.is_active && isLightTheme && styles.switchCardActiveLight,
            ]}
            onPress={() => setForm((prev) => ({ ...prev, is_active: !prev.is_active }))}
          >
            <Text style={[styles.switchTitle, isLightTheme && styles.switchTitleLight]}>Producto activo</Text>
            <Text style={[styles.switchDesc, isLightTheme && styles.switchDescLight]}>{boolText(form.is_active, COMMON_TEXT.yes, COMMON_TEXT.no)}</Text>
          </Pressable>

          <Pressable
            style={[
              styles.switchCard,
              isLightTheme && styles.switchCardLight,
              form.track_inventory && styles.switchCardActive,
              form.track_inventory && isLightTheme && styles.switchCardActiveLight,
            ]}
            onPress={() => setForm((prev) => ({ ...prev, track_inventory: !prev.track_inventory }))}
          >
            <Text style={[styles.switchTitle, isLightTheme && styles.switchTitleLight]}>Controla inventario</Text>
            <Text style={[styles.switchDesc, isLightTheme && styles.switchDescLight]}>{boolText(form.track_inventory, COMMON_TEXT.yes, COMMON_TEXT.no)}</Text>
          </Pressable>

          <Pressable
            style={[
              styles.switchCard,
              isLightTheme && styles.switchCardLight,
              form.requires_expiration && styles.switchCardActive,
              form.requires_expiration && isLightTheme && styles.switchCardActiveLight,
            ]}
            onPress={() =>
              setForm((prev) => ({ ...prev, requires_expiration: !prev.requires_expiration }))
            }
          >
            <Text style={[styles.switchTitle, isLightTheme && styles.switchTitleLight]}>Maneja vencimiento</Text>
            <Text style={[styles.switchDesc, isLightTheme && styles.switchDescLight]}>{boolText(form.requires_expiration, COMMON_TEXT.yes, COMMON_TEXT.no)}</Text>
          </Pressable>
        </View>

        <Text style={[styles.groupTitle, isLightTheme && styles.groupTitleLight]}>Fotos del producto</Text>
        {form.product_id ? (
          <View style={[styles.mediaPanel, isLightTheme && styles.mediaPanelLight]}>
            <View style={styles.mediaHeader}>
              <View style={styles.mediaHeaderTextWrap}>
                <Text style={[styles.mediaTitle, isLightTheme && styles.mediaTitleLight]}>
                  {productMedia.length}/{MAX_PRODUCT_PHOTOS} fotos
                </Text>
                <Text style={[styles.mediaHint, isLightTheme && styles.mediaHintLight]}>
                  JPG optimizado, máximo 2MB por imagen.
                </Text>
              </View>
              <View style={styles.mediaActionRow}>
                <Pressable
                  style={[
                    styles.mediaActionBtn,
                    styles.mediaActionBtnPrimary,
                    (mediaBusy || mediaLimitReached) && styles.actionBtnDisabled,
                  ]}
                  onPress={() => handleAddPhoto('camera')}
                  disabled={mediaBusy || mediaLimitReached}
                >
                  <Ionicons name="camera-outline" size={15} color="#e0f2fe" />
                  <Text style={styles.mediaActionBtnText}>Camara</Text>
                </Pressable>
                <Pressable
                  style={[
                    styles.mediaActionBtn,
                    styles.mediaActionBtnSecondary,
                    (mediaBusy || mediaLimitReached) && styles.actionBtnDisabled,
                  ]}
                  onPress={() => handleAddPhoto('library')}
                  disabled={mediaBusy || mediaLimitReached}
                >
                  <Ionicons name="images-outline" size={15} color="#dbeafe" />
                  <Text style={styles.mediaActionBtnText}>Galeria</Text>
                </Pressable>
              </View>
            </View>

            {mediaLimitReached ? (
              <Text style={[styles.limitText, isLightTheme && styles.limitTextLight]}>
                Límite alcanzado. Elimina una foto si quieres reemplazarla.
              </Text>
            ) : null}

            {mediaBusy ? (
              <Text style={[styles.noticeText, isLightTheme && styles.noticeTextLight]}>
                Procesando foto, subiendo archivo y preparando sugerencias IA...
              </Text>
            ) : null}
            {mediaNotice ? (
              <Text style={[styles.noticeText, isLightTheme && styles.noticeTextLight]}>{mediaNotice}</Text>
            ) : null}
            {mediaError ? (
              <Text style={[styles.errorText, isLightTheme && styles.errorTextLight]}>{mediaError}</Text>
            ) : null}

            {mediaLoading ? (
              <View style={[styles.mediaEmptyState, isLightTheme && styles.mediaEmptyStateLight]}>
                <Ionicons name="refresh-outline" size={20} color={isLightTheme ? '#235ea9' : '#93c5fd'} />
                <Text style={[styles.mediaEmptyText, isLightTheme && styles.mediaEmptyTextLight]}>
                  Cargando fotos del producto...
                </Text>
              </View>
            ) : productMedia.length ? (
              <>
                <ScrollView
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  contentContainerStyle={styles.mediaThumbsRow}
                >
                  {productMedia.map((media) => {
                    const active = media.media_id === selectedMedia?.media_id;
                    return (
                      <Pressable
                        key={media.media_id}
                        style={[
                          styles.mediaThumbCard,
                          isLightTheme && styles.mediaThumbCardLight,
                          active && styles.mediaThumbCardActive,
                        ]}
                        onPress={() => setSelectedMediaId(media.media_id)}
                      >
                        {media.signed_url ? (
                          <Image source={{ uri: media.signed_url }} style={styles.mediaThumbImage} resizeMode="cover" />
                        ) : (
                          <View style={[styles.mediaThumbPlaceholder, isLightTheme && styles.mediaThumbPlaceholderLight]}>
                            <Ionicons name="image-outline" size={20} color={isLightTheme ? '#64748b' : '#93c5fd'} />
                          </View>
                        )}
                        <View style={styles.mediaThumbBadges}>
                          {media.is_cover ? (
                            <View style={[styles.miniBadge, styles.miniBadgeGreen]}>
                              <Text style={styles.miniBadgeText}>Portada</Text>
                            </View>
                          ) : null}
                          {media.ai_status === 'READY' ? (
                            <View style={[styles.miniBadge, styles.miniBadgeBlue]}>
                              <Text style={styles.miniBadgeText}>IA</Text>
                            </View>
                          ) : null}
                        </View>
                      </Pressable>
                    );
                  })}
                </ScrollView>

                {selectedMedia ? (
                  <View style={[styles.selectedMediaCard, isLightTheme && styles.selectedMediaCardLight]}>
                    {selectedMedia.signed_url ? (
                      <Image source={{ uri: selectedMedia.signed_url }} style={styles.selectedMediaImage} resizeMode="cover" />
                    ) : (
                      <View style={[styles.selectedMediaPlaceholder, isLightTheme && styles.selectedMediaPlaceholderLight]}>
                        <Ionicons name="image-outline" size={28} color={isLightTheme ? '#64748b' : '#93c5fd'} />
                      </View>
                    )}

                    <Text style={[styles.mediaMeta, isLightTheme && styles.mediaMetaLight]}>
                      {formatBytes(selectedMedia.size_bytes)}
                      {selectedMedia.width && selectedMedia.height ? ` · ${selectedMedia.width}x${selectedMedia.height}` : ''}
                    </Text>

                    <View style={styles.selectedMediaActions}>
                      {!selectedMedia.is_cover ? (
                        <Pressable
                          style={[styles.secondaryBtn, mediaBusy && styles.actionBtnDisabled]}
                          onPress={() => handleSetCover(selectedMedia.media_id)}
                          disabled={mediaBusy}
                        >
                          <View style={styles.btnContentRow}>
                            <Ionicons name="star-outline" size={15} color="#dbeafe" />
                            <Text style={styles.secondaryBtnText}>Usar como portada</Text>
                          </View>
                        </Pressable>
                      ) : (
                        <View style={[styles.coverIndicator, isLightTheme && styles.coverIndicatorLight]}>
                          <Ionicons name="star" size={14} color={isLightTheme ? '#1d4ed8' : '#fde68a'} />
                          <Text style={[styles.coverIndicatorText, isLightTheme && styles.coverIndicatorTextLight]}>Esta es la portada actual</Text>
                        </View>
                      )}

                      <Pressable
                        style={[styles.dangerBtn, mediaBusy && styles.actionBtnDisabled]}
                        onPress={() => handleDeletePhoto(selectedMedia)}
                        disabled={mediaBusy}
                      >
                        <View style={styles.btnContentRow}>
                          <Ionicons name="trash-outline" size={15} color="#fee2e2" />
                          <Text style={styles.dangerBtnText}>Eliminar foto</Text>
                        </View>
                      </Pressable>
                    </View>

                    {selectedMedia.ai_status === 'READY' || selectedMedia.ai_status === 'FAILED' ? (
                      <View style={[styles.aiCard, isLightTheme && styles.aiCardLight]}>
                        <Text style={[styles.aiTitle, isLightTheme && styles.aiTitleLight]}>Asistente IA de producto</Text>

                        {selectedMedia.ai_summary ? (
                          <Text style={[styles.aiText, isLightTheme && styles.aiTextLight]}>{selectedMedia.ai_summary}</Text>
                        ) : null}

                        {normalizeText(selectedMedia.ai_detected_name) ? (
                          <Text style={[styles.aiText, isLightTheme && styles.aiTextLight]}>
                            Nombre sugerido: {selectedMedia.ai_detected_name}
                          </Text>
                        ) : null}
                        {normalizeText(selectedMedia.ai_detected_category) ? (
                          <Text style={[styles.aiText, isLightTheme && styles.aiTextLight]}>
                            Categoría sugerida: {selectedMedia.ai_detected_category}
                          </Text>
                        ) : null}
                        {normalizeText(selectedMedia.ai_detected_brand) ? (
                          <Text style={[styles.aiText, isLightTheme && styles.aiTextLight]}>
                            Marca detectada: {selectedMedia.ai_detected_brand}
                          </Text>
                        ) : null}
                        {normalizeText(selectedMedia.ai_suggested_description) ? (
                          <Text style={[styles.aiText, isLightTheme && styles.aiTextLight]}>
                            Descripción sugerida: {selectedMedia.ai_suggested_description}
                          </Text>
                        ) : null}

                        {Array.isArray(selectedMedia.ai_labels) && selectedMedia.ai_labels.length ? (
                          <Text style={[styles.aiMeta, isLightTheme && styles.aiMetaLight]}>
                            Etiquetas: {selectedMedia.ai_labels.join(', ')}
                          </Text>
                        ) : null}
                        {Array.isArray(selectedMedia.ai_warnings) && selectedMedia.ai_warnings.length ? (
                          <Text style={[styles.aiWarning, isLightTheme && styles.aiWarningLight]}>
                            {selectedMedia.ai_warnings.join(' · ')}
                          </Text>
                        ) : null}

                        {hasApplicableAiSuggestion(selectedMedia) ? (
                          <Pressable
                            style={[styles.secondaryBtn, mediaBusy && styles.actionBtnDisabled]}
                            onPress={() => applyAiSuggestion(selectedMedia)}
                            disabled={mediaBusy}
                          >
                            <View style={styles.btnContentRow}>
                              <Ionicons name="sparkles-outline" size={15} color="#dbeafe" />
                              <Text style={styles.secondaryBtnText}>Aplicar al formulario</Text>
                            </View>
                          </Pressable>
                        ) : null}
                      </View>
                    ) : null}
                  </View>
                ) : null}
              </>
            ) : (
              <View style={[styles.mediaEmptyState, isLightTheme && styles.mediaEmptyStateLight]}>
                <Ionicons name="images-outline" size={22} color={isLightTheme ? '#235ea9' : '#93c5fd'} />
                <Text style={[styles.mediaEmptyText, isLightTheme && styles.mediaEmptyTextLight]}>
                  Este producto aún no tiene fotos. Puedes tomar una o elegir desde galería.
                </Text>
              </View>
            )}
          </View>
        ) : (
          <View style={[styles.mediaEmptyState, isLightTheme && styles.mediaEmptyStateLight]}>
            <Ionicons name="save-outline" size={22} color={isLightTheme ? '#235ea9' : '#93c5fd'} />
            <Text style={[styles.mediaEmptyText, isLightTheme && styles.mediaEmptyTextLight]}>
              Guarda el producto primero para habilitar carga de fotos, portada y sugerencias IA.
            </Text>
          </View>
        )}
      </BottomSheetModal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#060b16', padding: 12 },
  containerLight: { backgroundColor: '#edf2fb' },
  filtersBlock: { marginBottom: 8 },
  toolbar: { flexDirection: 'row', gap: 8, marginBottom: 8 },
  searchInput: {
    flex: 1,
    minHeight: 42,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#334155',
    backgroundColor: '#111827',
    color: '#f8fafc',
    paddingHorizontal: 10,
  },
  searchInputLight: {
    borderColor: '#cbd5e1',
    backgroundColor: '#ffffff',
    color: '#0f172a',
  },
  searchBtn: {
    backgroundColor: '#235ea9',
    borderRadius: 8,
    paddingHorizontal: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  searchBtnText: { color: '#dbeafe', fontWeight: '700' },
  btnContentRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6 },
  card: {
    backgroundColor: '#111827',
    borderWidth: 1,
    borderColor: '#1f2937',
    borderRadius: 12,
    padding: 12,
    marginBottom: 8,
  },
  cardLight: { backgroundColor: '#ffffff', borderColor: '#dbe4ef' },
  cardHeader: { flexDirection: 'row', gap: 12, alignItems: 'flex-start' },
  cardThumb: { width: 72, height: 72, borderRadius: 12, backgroundColor: '#0f172a' },
  cardThumbPlaceholder: {
    width: 72,
    height: 72,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#334155',
    backgroundColor: '#0f172a',
    alignItems: 'center',
    justifyContent: 'center',
  },
  cardThumbPlaceholderLight: { borderColor: '#dbe4ef', backgroundColor: '#eff6ff' },
  cardContent: { flex: 1 },
  title: { color: '#f8fafc', fontWeight: '700', fontSize: 15 },
  titleLight: { color: '#0f172a' },
  meta: { color: '#cbd5e1', marginTop: 2, fontSize: 13 },
  metaLight: { color: '#475569' },
  badgesRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 10 },
  badge: {
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 4,
    backgroundColor: '#0f172a',
  },
  badgeGreen: { borderColor: '#16a34a' },
  badgeRed: { borderColor: '#ef4444' },
  badgeBlue: { borderColor: '#3b82f6' },
  badgeSky: { borderColor: '#235ea9' },
  badgeAmber: { borderColor: '#f59e0b' },
  badgeText: { color: '#e2e8f0', fontSize: 11, fontWeight: '700' },
  variantToggleBtn: {
    marginTop: 8,
    borderWidth: 1,
    borderColor: '#334155',
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 6,
    alignSelf: 'flex-start',
    backgroundColor: '#0f172a',
  },
  variantToggleBtnLight: { borderColor: '#cbd5e1', backgroundColor: '#f8fafc' },
  variantToggleText: { color: '#eff6ff', fontSize: 12, fontWeight: '700' },
  variantToggleTextLight: { color: '#235ea9' },
  variantsBox: {
    marginTop: 8,
    borderWidth: 1,
    borderColor: '#334155',
    borderRadius: 10,
    backgroundColor: '#0f172a',
    padding: 8,
    gap: 6,
  },
  variantsBoxLight: { borderColor: '#dbe4ef', backgroundColor: '#f8fafc' },
  summaryCard: {
    marginTop: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#1d4ed8',
    backgroundColor: '#0f172a',
    padding: 12,
    gap: 8,
  },
  summaryCardLight: { backgroundColor: '#eff6ff', borderColor: '#93c5fd' },
  summaryTitle: { color: '#eff6ff', fontWeight: '800' },
  summaryTitleLight: { color: '#1e3a8a' },
  summaryText: { color: '#cbd5e1', fontSize: 13 },
  summaryTextLight: { color: '#1f2937' },
  variantRow: {
    borderWidth: 1,
    borderColor: '#1e293b',
    borderRadius: 8,
    padding: 8,
    backgroundColor: '#111827',
  },
  variantRowLight: { borderColor: '#dbe4ef', backgroundColor: '#ffffff' },
  variantName: { color: '#f8fafc', fontWeight: '700', fontSize: 13, marginBottom: 2 },
  variantNameLight: { color: '#0f172a' },
  variantMeta: { color: '#94a3b8', fontSize: 12, marginTop: 1 },
  variantMetaLight: { color: '#475569' },
  editSupplementaryActions: { flexDirection: 'row', gap: 8, marginTop: 4, marginBottom: 6 },
  editSupplementaryList: { gap: 8 },
  actions: { flexDirection: 'row', gap: 8, marginTop: 10 },
  secondaryBtn: {
    flex: 1,
    backgroundColor: '#235ea9',
    borderRadius: 8,
    paddingVertical: 8,
    paddingHorizontal: 10,
    alignItems: 'center',
  },
  secondaryBtnText: { color: '#dbeafe', fontWeight: '700' },
  dangerBtn: {
    flex: 1,
    backgroundColor: '#7f1d1d',
    borderRadius: 8,
    paddingVertical: 8,
    paddingHorizontal: 10,
    alignItems: 'center',
  },
  dangerBtnText: { color: '#fee2e2', fontWeight: '700' },
  modalTitle: { color: '#f8fafc', fontSize: 18, fontWeight: '700', marginBottom: 8 },
  modalTitleLight: { color: '#0f172a' },
  groupTitle: {
    color: '#93c5fd',
    marginTop: 12,
    marginBottom: 6,
    fontWeight: '700',
    fontSize: 13,
    textTransform: 'uppercase',
  },
  groupTitleLight: { color: '#235ea9' },
  input: {
    minHeight: 42,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#334155',
    paddingHorizontal: 10,
    color: '#f8fafc',
    marginTop: 8,
    backgroundColor: '#111827',
  },
  inputLight: { borderColor: '#cbd5e1', color: '#0f172a', backgroundColor: '#ffffff' },
  descriptionInput: { minHeight: 78, textAlignVertical: 'top', paddingTop: 10 },
  toggleRow: { flexDirection: 'row', gap: 8, marginTop: 8 },
  toggleBtn: {
    flex: 1,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#334155',
    paddingVertical: 8,
    alignItems: 'center',
    backgroundColor: '#111827',
  },
  toggleBtnLight: { borderColor: '#cbd5e1', backgroundColor: '#ffffff' },
  toggleBtnActive: { borderColor: '#235ea9', backgroundColor: '#172554' },
  toggleBtnActiveLight: { borderColor: '#235ea9', backgroundColor: '#235ea9' },
  toggleBtnText: { color: '#cbd5e1', fontSize: 12, fontWeight: '700' },
  toggleBtnTextLight: { color: '#334155' },
  toggleBtnTextActive: { color: '#eff6ff' },
  switchRowWrap: { gap: 8, marginTop: 8 },
  switchCard: {
    borderWidth: 1,
    borderColor: '#334155',
    borderRadius: 10,
    padding: 10,
    backgroundColor: '#111827',
  },
  switchCardLight: { borderColor: '#cbd5e1', backgroundColor: '#ffffff' },
  switchCardActive: { borderColor: '#235ea9', backgroundColor: '#0f1f35' },
  switchCardActiveLight: { borderColor: '#235ea9', backgroundColor: '#eff6ff' },
  switchTitle: { color: '#e2e8f0', fontSize: 13, fontWeight: '700' },
  switchTitleLight: { color: '#0f172a' },
  switchDesc: { color: '#93c5fd', fontSize: 12, marginTop: 4 },
  switchDescLight: { color: '#235ea9' },
  mediaPanel: {
    marginTop: 2,
    borderWidth: 1,
    borderColor: '#1e293b',
    borderRadius: 12,
    backgroundColor: '#0f172a',
    padding: 12,
    gap: 10,
  },
  mediaPanelLight: { borderColor: '#dbe4ef', backgroundColor: '#f8fafc' },
  mediaHeader: { gap: 10 },
  mediaHeaderTextWrap: { gap: 2 },
  mediaTitle: { color: '#e2e8f0', fontWeight: '800', fontSize: 14 },
  mediaTitleLight: { color: '#0f172a' },
  mediaHint: { color: '#93c5fd', fontSize: 12 },
  mediaHintLight: { color: '#235ea9' },
  mediaActionRow: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
  mediaActionBtn: {
    borderRadius: 10,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 9,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  mediaActionBtnPrimary: {
    borderColor: '#0f766e',
    backgroundColor: '#0f3b39',
  },
  mediaActionBtnSecondary: {
    borderColor: '#235ea9',
    backgroundColor: '#173057',
  },
  mediaActionBtnText: { color: '#dbeafe', fontWeight: '700' },
  actionBtnDisabled: { opacity: 0.55 },
  limitText: { color: '#fbbf24', fontSize: 12, fontWeight: '600' },
  limitTextLight: { color: '#b45309' },
  noticeText: { color: '#93c5fd', fontSize: 12, lineHeight: 18 },
  noticeTextLight: { color: '#235ea9' },
  errorText: { color: '#fca5a5', fontSize: 12, lineHeight: 18 },
  errorTextLight: { color: '#b91c1c' },
  mediaEmptyState: {
    borderWidth: 1,
    borderColor: '#1e293b',
    borderRadius: 12,
    backgroundColor: '#111827',
    padding: 14,
    gap: 8,
    alignItems: 'center',
  },
  mediaEmptyStateLight: { borderColor: '#dbe4ef', backgroundColor: '#ffffff' },
  mediaEmptyText: { color: '#cbd5e1', textAlign: 'center', lineHeight: 18 },
  mediaEmptyTextLight: { color: '#475569' },
  mediaThumbsRow: { gap: 10, paddingRight: 4 },
  mediaThumbCard: {
    width: 112,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#334155',
    backgroundColor: '#111827',
    padding: 6,
    gap: 6,
  },
  mediaThumbCardLight: { borderColor: '#dbe4ef', backgroundColor: '#ffffff' },
  mediaThumbCardActive: { borderColor: '#38bdf8' },
  mediaThumbImage: { width: '100%', height: 92, borderRadius: 8, backgroundColor: '#0f172a' },
  mediaThumbPlaceholder: {
    width: '100%',
    height: 92,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#0f172a',
  },
  mediaThumbPlaceholderLight: { backgroundColor: '#eff6ff' },
  mediaThumbBadges: { flexDirection: 'row', gap: 4, flexWrap: 'wrap' },
  miniBadge: {
    borderRadius: 999,
    paddingHorizontal: 7,
    paddingVertical: 3,
  },
  miniBadgeGreen: { backgroundColor: '#14532d' },
  miniBadgeBlue: { backgroundColor: '#1d4ed8' },
  miniBadgeText: { color: '#eff6ff', fontSize: 10, fontWeight: '700' },
  selectedMediaCard: {
    borderWidth: 1,
    borderColor: '#334155',
    borderRadius: 12,
    backgroundColor: '#111827',
    padding: 10,
    gap: 10,
  },
  selectedMediaCardLight: { borderColor: '#dbe4ef', backgroundColor: '#ffffff' },
  selectedMediaImage: { width: '100%', height: 220, borderRadius: 10, backgroundColor: '#0f172a' },
  selectedMediaPlaceholder: {
    width: '100%',
    height: 220,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#0f172a',
  },
  selectedMediaPlaceholderLight: { backgroundColor: '#eff6ff' },
  mediaMeta: { color: '#94a3b8', fontSize: 12 },
  mediaMetaLight: { color: '#475569' },
  selectedMediaActions: { gap: 8 },
  coverIndicator: {
    borderWidth: 1,
    borderColor: '#f59e0b',
    borderRadius: 10,
    backgroundColor: '#3f2d0e',
    paddingHorizontal: 12,
    paddingVertical: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  coverIndicatorLight: {
    borderColor: '#93c5fd',
    backgroundColor: '#eff6ff',
  },
  coverIndicatorText: { color: '#fef3c7', fontWeight: '700' },
  coverIndicatorTextLight: { color: '#1d4ed8' },
  aiCard: {
    borderWidth: 1,
    borderColor: '#1d4ed8',
    borderRadius: 12,
    backgroundColor: '#102040',
    padding: 12,
    gap: 8,
  },
  aiCardLight: { borderColor: '#93c5fd', backgroundColor: '#eff6ff' },
  aiTitle: { color: '#dbeafe', fontWeight: '800', fontSize: 14 },
  aiTitleLight: { color: '#1d4ed8' },
  aiText: { color: '#e2e8f0', fontSize: 12, lineHeight: 18 },
  aiTextLight: { color: '#1e293b' },
  aiMeta: { color: '#93c5fd', fontSize: 12, lineHeight: 18 },
  aiMetaLight: { color: '#235ea9' },
  aiWarning: { color: '#fbbf24', fontSize: 12, lineHeight: 18 },
  aiWarningLight: { color: '#b45309' },
  modalFooter: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 12,
  },
  modalFooterBtn: { flex: 1 },
  primaryBtn: {
    backgroundColor: '#57d65a',
    borderRadius: 8,
    paddingVertical: 11,
    alignItems: 'center',
  },
  primaryBtnText: { color: '#062915', fontWeight: '700' },
  closeBtn: {
    backgroundColor: '#235ea9',
    paddingHorizontal: 14,
    paddingVertical: 11,
    borderRadius: 8,
    alignItems: 'center',
  },
  closeBtnText: { color: '#fff', fontWeight: '700' },
});
