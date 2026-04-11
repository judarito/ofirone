import { useEffect, useMemo, useState } from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import BottomSheetModal from './BottomSheetModal';
import SearchableSelectField from './SearchableSelectField';
import { humanizeAppError } from '../../../shared/utils/appErrors';
import {
  PRODUCT_CREATION_PROFILES,
  applyProductCreationProfile,
  buildProductDraftFromProduct,
  buildProductPayloadForSave,
  buildSeedVariantPayload,
  getProductCreationProfile,
  sanitizeProductDraft,
  shouldAllowExpirationControl,
  shouldAskSeedVariant,
  shouldTrackInventoryForDraft,
} from '../../../shared/utils/productCreationWizard';
import { createProduct, createVariant, updateProduct, updateVariant } from '../services/productsCatalog.service';

const PROFILE_ICONS = {
  sale_simple: 'cube-outline',
  sale_variants: 'layers-outline',
  component: 'construct-outline',
  manufactured: 'build-outline',
  bundle: 'albums-outline',
  service: 'hand-left-outline',
};

const PRODUCTION_TYPE_OPTIONS = [
  { key: 'ON_DEMAND', label: 'Bajo demanda', searchText: 'Bajo demanda' },
  { key: 'TO_STOCK', label: 'Para stock', searchText: 'Para stock' },
];

const INVENTORY_BEHAVIOR_OPTIONS = [
  { key: 'RESELL', label: 'Reventa', searchText: 'Reventa' },
  { key: 'MANUFACTURED', label: 'Manufacturado', searchText: 'Manufacturado' },
  { key: 'BUNDLE', label: 'Combo / Bundle', searchText: 'Combo Bundle' },
  { key: 'SERVICE', label: 'Servicio', searchText: 'Servicio' },
];

function buildInitialForm(profileId = 'sale_simple') {
  return applyProductCreationProfile({
    name: '',
    description: '',
    category_id: null,
    unit_id: null,
    is_active: true,
    base_cost: 0,
    base_price: 0,
    base_min_stock: 0,
    requires_expiration: false,
    seed_variant_name: '',
    seed_variant_sku: '',
    seed_variant_cost: 0,
    seed_variant_price: 0,
    seed_variant_min_stock: 0,
  }, profileId);
}

function normalizeText(value) {
  return String(value || '').trim();
}

function parseAmount(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function boolText(value) {
  return value ? 'Sí' : 'No';
}

export default function ProductCreationWizardSheet({
  visible,
  onClose,
  themeMode,
  tenantId,
  categoryOptions = [],
  unitOptions = [],
  defaultProfileId = 'sale_simple',
  mode = 'create',
  initialProduct = null,
  onSaved,
  renderSupplementary,
}) {
  const isLightTheme = themeMode === 'light';
  const isEditMode = mode === 'edit';
  const [step, setStep] = useState(1);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [showAdvancedOptions, setShowAdvancedOptions] = useState(false);
  const [form, setForm] = useState(
    isEditMode && initialProduct
      ? buildProductDraftFromProduct(initialProduct)
      : buildInitialForm(defaultProfileId),
  );

  useEffect(() => {
    if (!visible) return;
    setStep(1);
    setSaving(false);
    setError('');
    setShowAdvancedOptions(false);
    setForm(
      mode === 'edit' && initialProduct
        ? buildProductDraftFromProduct(initialProduct)
        : buildInitialForm(defaultProfileId),
    );
  }, [defaultProfileId, initialProduct, mode, visible]);

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

  const profiles = useMemo(
    () => PRODUCT_CREATION_PROFILES.map((profile) => ({
      ...profile,
      icon: PROFILE_ICONS[profile.id] || 'cube-outline',
    })),
    [],
  );

  const previewDraft = useMemo(() => sanitizeProductDraft(form), [form]);
  const selectedProfile = useMemo(
    () => getProductCreationProfile(form.product_profile),
    [form.product_profile],
  );
  const needsSeedVariant = useMemo(() => shouldAskSeedVariant(form), [form]);
  const shouldCreateSeedVariant = useMemo(() => !isEditMode && needsSeedVariant, [isEditMode, needsSeedVariant]);
  const tracksInventory = useMemo(() => shouldTrackInventoryForDraft(form), [form]);
  const canControlExpiration = useMemo(() => shouldAllowExpirationControl(form), [form]);
  const canToggleInventory = useMemo(
    () => form.inventory_behavior === 'RESELL' || form.inventory_behavior === 'MANUFACTURED',
    [form.inventory_behavior],
  );
  const behaviorLabel = useMemo(
    () => INVENTORY_BEHAVIOR_OPTIONS.find((option) => option.key === form.inventory_behavior)?.label || 'Reventa',
    [form.inventory_behavior],
  );
  const minimumAlertSummary = useMemo(() => {
    if (!tracksInventory) return 'No aplica';
    if (previewDraft.variant_mode === 'multiple' && !shouldCreateSeedVariant) {
      return 'Se gestiona por variante';
    }
    const threshold = shouldCreateSeedVariant
      ? Number(previewDraft.seed_variant_min_stock || 0)
      : Number(previewDraft.base_min_stock || 0);
    return threshold > 0 ? `Activa desde ${threshold}` : 'Sin alerta mínima';
  }, [previewDraft, shouldCreateSeedVariant, tracksInventory]);

  const profileSummary = useMemo(() => {
    if (selectedProfile.id === 'sale_variants') return 'Crearemos el producto y su primera variante inicial.';
    if (selectedProfile.id === 'component') return 'Quedará como insumo físico para usar en fórmulas y manufactura.';
    if (selectedProfile.id === 'manufactured') return 'Quedará como producto fabricado y luego podrás completar su BOM.';
    if (selectedProfile.id === 'bundle') return 'Se guardará como combo comercial sin stock directo.';
    if (selectedProfile.id === 'service') return 'Se guardará sin control de inventario ni vencimiento.';
    return 'Se creará con una variante predeterminada y configuración simple de venta.';
  }, [selectedProfile.id]);

  const goNext = () => {
    setError('');
    if (step === 1 && !normalizeText(form.name)) {
      setError('El nombre del producto es obligatorio.');
      return;
    }
    setStep((prev) => Math.min(3, prev + 1));
  };

  const selectProfile = (profileId) => {
    setForm((prev) => applyProductCreationProfile(prev, profileId));
  };

  const submit = async () => {
    if (!tenantId) {
      setError(`No hay tenant activo para ${isEditMode ? 'actualizar' : 'crear'} el producto.`);
      return;
    }

    const payload = buildProductPayloadForSave({
      ...form,
      name: normalizeText(form.name),
      description: normalizeText(form.description),
      base_cost: parseAmount(form.base_cost),
      base_price: parseAmount(form.base_price),
      base_min_stock: parseAmount(form.base_min_stock),
      seed_variant_cost: parseAmount(form.seed_variant_cost),
      seed_variant_price: parseAmount(form.seed_variant_price),
      seed_variant_min_stock: parseAmount(form.seed_variant_min_stock),
    });

    if (!payload.name) {
      setError('El nombre del producto es obligatorio.');
      setStep(1);
      return;
    }

    setSaving(true);
    setError('');
    let savedProduct = initialProduct;
    let message = 'Producto actualizado correctamente.';
    let color = 'success';

    if (isEditMode) {
      const updateResult = await updateProduct(initialProduct?.product_id || form.product_id, tenantId, {
        tenant_id: tenantId,
        ...payload,
      });

      if (!updateResult.success) {
        setSaving(false);
        setError(humanizeAppError(updateResult.error, { defaultMessage: 'No se pudo actualizar el producto.' }));
        return;
      }

      savedProduct = updateResult.data;
    } else {
      const createResult = await createProduct({
        tenant_id: tenantId,
        ...payload,
      });

      if (!createResult.success) {
        setSaving(false);
        setError(humanizeAppError(createResult.error, { defaultMessage: 'No se pudo crear el producto.' }));
        return;
      }

      savedProduct = createResult.data;
      message = shouldCreateSeedVariant
        ? 'Producto creado con su primera variante.'
        : 'Producto creado correctamente.';

      if (shouldCreateSeedVariant) {
        const firstVariant = buildSeedVariantPayload({
          ...form,
          name: payload.name,
          description: payload.description,
        });
        const defaultVariant = Array.isArray(createResult.data?.product_variants)
          ? createResult.data.product_variants[0]
          : null;
        const variantResult = defaultVariant?.variant_id
          ? await updateVariant(defaultVariant.variant_id, tenantId, firstVariant)
          : await createVariant({
              tenant_id: tenantId,
              product_id: createResult.data?.product_id,
              ...firstVariant,
            });

        if (!variantResult.success) {
          message = 'Producto creado, pero no se pudo crear la primera variante. Revísalo desde edición.';
          color = 'warning';
        }
      }
    }

    setSaving(false);
    if (typeof onSaved === 'function') {
      onSaved({
        product: savedProduct,
        message,
        color,
      });
    }
    onClose();
  };

  return (
    <BottomSheetModal
      visible={visible}
      onClose={onClose}
      themeMode={themeMode}
      maxHeight="94%"
      footer={(
        <View style={styles.footer}>
          <Pressable
            style={[styles.footerBtn, styles.secondaryBtn, step === 1 && styles.actionBtnDisabled]}
            onPress={() => setStep((prev) => Math.max(1, prev - 1))}
            disabled={step === 1}
          >
            <View style={styles.btnContentRow}>
              <Ionicons name="arrow-back-outline" size={16} color="#dbeafe" />
              <Text style={styles.secondaryBtnText}>Atrás</Text>
            </View>
          </Pressable>
          <Pressable style={[styles.footerBtn, styles.closeBtn]} onPress={onClose}>
            <View style={styles.btnContentRow}>
              <Ionicons name="close-outline" size={16} color="#fff" />
              <Text style={styles.closeBtnText}>Cerrar</Text>
            </View>
          </Pressable>
          <Pressable
            style={[styles.footerBtn, styles.primaryBtn, saving && styles.actionBtnDisabled]}
            onPress={step < 3 ? goNext : submit}
            disabled={saving}
          >
            <View style={styles.btnContentRow}>
              <Ionicons
                name={step < 3 ? 'arrow-forward-outline' : (saving ? 'hourglass-outline' : 'save-outline')}
                size={16}
                color="#062915"
              />
              <Text style={styles.primaryBtnText}>{step < 3 ? 'Continuar' : (saving ? 'Guardando...' : (isEditMode ? 'Guardar' : 'Crear'))}</Text>
            </View>
          </Pressable>
        </View>
      )}
    >
      <Text style={[styles.title, isLightTheme && styles.titleLight]}>{isEditMode ? 'Editar producto guiado' : 'Crear producto guiado'}</Text>
      <Text style={[styles.subtitle, isLightTheme && styles.subtitleLight]}>
        {isEditMode
          ? 'Mantenemos la misma guía del alta para que editar no se sienta como otro sistema distinto.'
          : 'Vamos por pasos para pedirte solo lo necesario y dejar el producto bien creado desde el inicio.'}
      </Text>

      <View style={styles.stepRow}>
        {[1, 2, 3].map((value) => (
          <View
            key={value}
            style={[
              styles.stepBadge,
              isLightTheme && styles.stepBadgeLight,
              step >= value && styles.stepBadgeActive,
            ]}
          >
            <Text style={[styles.stepBadgeText, step >= value && styles.stepBadgeTextActive]}>
              {value === 1 ? 'Básicos' : value === 2 ? 'Tipo' : 'Configurar'}
            </Text>
          </View>
        ))}
      </View>

      {error ? <Text style={[styles.errorText, isLightTheme && styles.errorTextLight]}>{error}</Text> : null}

      {step === 1 ? (
        <>
          <TextInput
            style={[styles.input, isLightTheme && styles.inputLight]}
            value={form.name}
            onChangeText={(value) => setForm((prev) => ({ ...prev, name: value }))}
            placeholder="Nombre del producto *"
            placeholderTextColor="#64748b"
          />

          <SearchableSelectField
            title="Categoría"
            themeMode={themeMode}
            valueLabel="Sin categoría"
            clearLabel="Sin categoría"
            placeholder="Seleccionar categoría"
            searchPlaceholder="Buscar categoría..."
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

          <TextInput
            style={[styles.input, isLightTheme && styles.inputLight, styles.textarea]}
            value={form.description}
            onChangeText={(value) => setForm((prev) => ({ ...prev, description: value }))}
            placeholder="Descripción"
            placeholderTextColor="#64748b"
            multiline
          />
        </>
      ) : null}

      {step === 2 ? (
        <>
          <Text style={[styles.sectionTitle, isLightTheme && styles.sectionTitleLight]}>{isEditMode ? '¿Qué estás editando?' : '¿Qué vas a crear?'}</Text>
          <Text style={[styles.sectionHint, isLightTheme && styles.sectionHintLight]}>
            Elige el uso principal. El wizard deduce automáticamente si lleva una sola variante, si sirve como componente y cómo se comporta en inventario.
          </Text>

          <ScrollView style={styles.profileList}>
            {profiles.map((profile) => {
              const active = form.product_profile === profile.id;
              return (
                <Pressable
                  key={profile.id}
                  style={[
                    styles.profileCard,
                    isLightTheme && styles.profileCardLight,
                    active && styles.profileCardActive,
                    active && isLightTheme && styles.profileCardActiveLight,
                  ]}
                  onPress={() => selectProfile(profile.id)}
                >
                  <View style={styles.profileHeader}>
                    <Ionicons
                      name={profile.icon}
                      size={18}
                      color={active ? '#bfdbfe' : (isLightTheme ? '#235ea9' : '#93c5fd')}
                    />
                    <Text style={[styles.profileTitle, isLightTheme && styles.profileTitleLight]}>
                      {profile.title}
                    </Text>
                  </View>
                  <Text style={[styles.profileDescription, isLightTheme && styles.profileDescriptionLight]}>
                    {profile.description}
                  </Text>
                </Pressable>
              );
            })}
          </ScrollView>

          <View style={[styles.summaryCard, isLightTheme && styles.summaryCardLight]}>
            <Text style={[styles.summaryTitle, isLightTheme && styles.summaryTitleLight]}>
              Selección actual: {selectedProfile.title}
            </Text>
            <Text style={[styles.summaryText, isLightTheme && styles.summaryTextLight]}>{profileSummary}</Text>
          </View>
        </>
      ) : null}

      {step === 3 ? (
        <>
          <Text style={[styles.sectionTitle, isLightTheme && styles.sectionTitleLight]}>{isEditMode ? 'Configuración actual' : 'Configuración mínima'}</Text>
          <Text style={[styles.sectionHint, isLightTheme && styles.sectionHintLight]}>
            {isEditMode
              ? 'Ajusta lo esencial sin salirte del flujo guiado. Lo más especializado queda como complemento.'
              : 'Solo te pedimos lo necesario para dejar el producto operativo desde el inicio.'}
          </Text>

          {shouldCreateSeedVariant ? (
            <>
              <View style={[styles.summaryCard, isLightTheme && styles.summaryCardLight]}>
                <Text style={[styles.summaryText, isLightTheme && styles.summaryTextLight]}>
                  Crearemos el producto y enseguida le agregaremos su primera variante.
                </Text>
              </View>

              <Text style={[styles.fieldLabel, isLightTheme && styles.fieldLabelLight]}>Nombre de la primera variante</Text>
              <TextInput
                style={[styles.input, isLightTheme && styles.inputLight]}
                value={form.seed_variant_name}
                onChangeText={(value) => setForm((prev) => ({ ...prev, seed_variant_name: value }))}
                placeholder="Nombre de la primera variante"
                placeholderTextColor="#64748b"
              />
              <Text style={[styles.fieldLabel, isLightTheme && styles.fieldLabelLight]}>SKU inicial</Text>
              <TextInput
                style={[styles.input, isLightTheme && styles.inputLight]}
                value={String(form.seed_variant_sku || '')}
                onChangeText={(value) => setForm((prev) => ({ ...prev, seed_variant_sku: value }))}
                placeholder="SKU inicial (opcional)"
                placeholderTextColor="#64748b"
              />
              <View style={styles.row}>
                <View style={styles.rowInput}>
                  <Text style={[styles.fieldLabel, isLightTheme && styles.fieldLabelLight]}>Costo</Text>
                  <TextInput
                    style={[styles.input, isLightTheme && styles.inputLight]}
                    value={String(form.seed_variant_cost ?? '')}
                    onChangeText={(value) => setForm((prev) => ({ ...prev, seed_variant_cost: value }))}
                    placeholder="0"
                    placeholderTextColor="#64748b"
                    keyboardType="numeric"
                  />
                </View>
                <View style={styles.rowInput}>
                  <Text style={[styles.fieldLabel, isLightTheme && styles.fieldLabelLight]}>Precio</Text>
                  <TextInput
                    style={[styles.input, isLightTheme && styles.inputLight]}
                    value={String(form.seed_variant_price ?? '')}
                    onChangeText={(value) => setForm((prev) => ({ ...prev, seed_variant_price: value }))}
                    placeholder="0"
                    placeholderTextColor="#64748b"
                    keyboardType="numeric"
                  />
                </View>
              </View>
              {tracksInventory ? (
                <>
                  <Text style={[styles.fieldLabel, isLightTheme && styles.fieldLabelLight]}>Alerta mínima de stock</Text>
                  <TextInput
                    style={[styles.input, isLightTheme && styles.inputLight]}
                    value={String(form.seed_variant_min_stock ?? '')}
                    onChangeText={(value) => setForm((prev) => ({ ...prev, seed_variant_min_stock: value }))}
                    placeholder="0"
                    placeholderTextColor="#64748b"
                    keyboardType="numeric"
                  />
                  <Text style={[styles.fieldHint, isLightTheme && styles.fieldHintLight]}>
                    0 = sin alerta mínima. El inventario se sigue controlando para este perfil.
                  </Text>
                </>
              ) : null}
            </>
          ) : previewDraft.variant_mode === 'single' ? (
            <>
              <View style={styles.row}>
                <View style={styles.rowInput}>
                  <Text style={[styles.fieldLabel, isLightTheme && styles.fieldLabelLight]}>Costo base</Text>
                  <TextInput
                    style={[styles.input, isLightTheme && styles.inputLight]}
                    value={String(form.base_cost ?? '')}
                    onChangeText={(value) => setForm((prev) => ({ ...prev, base_cost: value }))}
                    placeholder="0"
                    placeholderTextColor="#64748b"
                    keyboardType="numeric"
                  />
                </View>
                <View style={styles.rowInput}>
                  <Text style={[styles.fieldLabel, isLightTheme && styles.fieldLabelLight]}>Precio base</Text>
                  <TextInput
                    style={[styles.input, isLightTheme && styles.inputLight]}
                    value={String(form.base_price ?? '')}
                    onChangeText={(value) => setForm((prev) => ({ ...prev, base_price: value }))}
                    placeholder="0"
                    placeholderTextColor="#64748b"
                    keyboardType="numeric"
                  />
                </View>
              </View>
              {tracksInventory ? (
                <>
                  <Text style={[styles.fieldLabel, isLightTheme && styles.fieldLabelLight]}>Alerta mínima de stock</Text>
                  <TextInput
                    style={[styles.input, isLightTheme && styles.inputLight]}
                    value={String(form.base_min_stock ?? '')}
                    onChangeText={(value) => setForm((prev) => ({ ...prev, base_min_stock: value }))}
                    placeholder="0"
                    placeholderTextColor="#64748b"
                    keyboardType="numeric"
                  />
                  <Text style={[styles.fieldHint, isLightTheme && styles.fieldHintLight]}>
                    0 = sin alerta mínima. El inventario se sigue controlando para este perfil.
                  </Text>
                </>
              ) : null}
            </>
          ) : (
            <View style={[styles.summaryCard, isLightTheme && styles.summaryCardLight]}>
              <Text style={[styles.summaryText, isLightTheme && styles.summaryTextLight]}>
                Este producto maneja varias variantes. Los precios, SKUs y alertas mínimas se ajustan desde cada variante.
              </Text>
            </View>
          )}

          <View style={[styles.summaryCard, isLightTheme && styles.summaryCardLight]}>
            <Text style={[styles.summaryTitle, isLightTheme && styles.summaryTitleLight]}>Resumen final</Text>
            <Text style={[styles.summaryText, isLightTheme && styles.summaryTextLight]}>
              Perfil: {selectedProfile.title}
            </Text>
            <Text style={[styles.summaryText, isLightTheme && styles.summaryTextLight]}>
              Variantes: {shouldCreateSeedVariant ? 'Con primera variante guiada' : (previewDraft.variant_mode === 'multiple' ? 'Múltiples variantes existentes' : 'Variante única predeterminada')}
            </Text>
            <Text style={[styles.summaryText, isLightTheme && styles.summaryTextLight]}>
              Inventario: {tracksInventory ? 'Controlado' : 'No aplica'}
            </Text>
            {tracksInventory ? (
              <Text style={[styles.summaryText, isLightTheme && styles.summaryTextLight]}>
                Alerta mínima: {minimumAlertSummary}
              </Text>
            ) : null}
            {previewDraft.is_component ? (
              <Text style={[styles.summaryText, isLightTheme && styles.summaryTextLight]}>
                Uso: Se utilizará como componente de otros productos
              </Text>
            ) : null}
            <Text style={[styles.summaryText, isLightTheme && styles.summaryTextLight]}>
              Comportamiento: {behaviorLabel}
            </Text>
          </View>

          <Pressable
            style={[styles.inlineLinkBtn, isLightTheme && styles.inlineLinkBtnLight]}
            onPress={() => setShowAdvancedOptions((prev) => !prev)}
          >
            <View style={styles.btnContentRow}>
              <Ionicons
                name={showAdvancedOptions ? 'chevron-up-outline' : 'options-outline'}
                size={16}
                color={isLightTheme ? '#235ea9' : '#93c5fd'}
              />
              <Text style={[styles.inlineLinkText, isLightTheme && styles.inlineLinkTextLight]}>
                {showAdvancedOptions ? 'Ocultar ajustes especiales' : 'Necesito una configuración especial'}
              </Text>
            </View>
          </Pressable>

          {showAdvancedOptions ? (
            <View style={[styles.advancedCard, isLightTheme && styles.advancedCardLight]}>
              <Text style={[styles.advancedTitle, isLightTheme && styles.advancedTitleLight]}>Opciones avanzadas</Text>
              <Text style={[styles.advancedHint, isLightTheme && styles.advancedHintLight]}>
                Úsalas solo si necesitas salirte del perfil elegido. Aquí puedes sobreescribir las decisiones automáticas del wizard.
              </Text>

              <Text style={[styles.fieldLabel, isLightTheme && styles.fieldLabelLight]}>Presentación del producto</Text>
              <View style={styles.toggleRow}>
                <Pressable
                  style={[
                    styles.toggleBtn,
                    isLightTheme && styles.toggleBtnLight,
                    form.variant_mode === 'single' && styles.toggleBtnActive,
                    form.variant_mode === 'single' && isLightTheme && styles.toggleBtnActiveLight,
                  ]}
                  onPress={() => setForm((prev) => ({ ...prev, variant_mode: 'single' }))}
                >
                  <Text style={[styles.toggleBtnText, isLightTheme && styles.toggleBtnTextLight, form.variant_mode === 'single' && styles.toggleBtnTextActive]}>
                    Variante única
                  </Text>
                </Pressable>
                <Pressable
                  style={[
                    styles.toggleBtn,
                    isLightTheme && styles.toggleBtnLight,
                    form.variant_mode === 'multiple' && styles.toggleBtnActive,
                    form.variant_mode === 'multiple' && isLightTheme && styles.toggleBtnActiveLight,
                  ]}
                  onPress={() => setForm((prev) => ({ ...prev, variant_mode: 'multiple' }))}
                >
                  <Text style={[styles.toggleBtnText, isLightTheme && styles.toggleBtnTextLight, form.variant_mode === 'multiple' && styles.toggleBtnTextActive]}>
                    Con variantes
                  </Text>
                </Pressable>
              </View>

              <SearchableSelectField
                title="Comportamiento de inventario"
                themeMode={themeMode}
                valueLabel={behaviorLabel}
                placeholder="Seleccionar comportamiento"
                searchPlaceholder="Buscar comportamiento..."
                options={INVENTORY_BEHAVIOR_OPTIONS}
                selectedKey={form.inventory_behavior}
                onSelect={(nextValue) => setForm((prev) => ({ ...prev, inventory_behavior: nextValue || 'RESELL' }))}
                allowClear={false}
              />

              {canToggleInventory ? (
                <Pressable
                  style={[
                    styles.toggleCard,
                    isLightTheme && styles.toggleCardLight,
                    form.track_inventory && styles.toggleCardActive,
                    form.track_inventory && isLightTheme && styles.toggleCardActiveLight,
                  ]}
                  onPress={() => setForm((prev) => ({ ...prev, track_inventory: !prev.track_inventory }))}
                >
                  <Text style={[styles.toggleTitle, isLightTheme && styles.toggleTitleLight]}>
                    Controlar inventario
                  </Text>
                  <Text style={[styles.toggleDescription, isLightTheme && styles.toggleDescriptionLight]}>
                    {boolText(form.track_inventory)}
                  </Text>
                </Pressable>
              ) : null}

              {form.inventory_behavior === 'RESELL' ? (
                <Pressable
                  style={[
                    styles.toggleCard,
                    isLightTheme && styles.toggleCardLight,
                    form.is_component && styles.toggleCardActive,
                    form.is_component && isLightTheme && styles.toggleCardActiveLight,
                  ]}
                  onPress={() => setForm((prev) => ({ ...prev, is_component: !prev.is_component }))}
                >
                  <Text style={[styles.toggleTitle, isLightTheme && styles.toggleTitleLight]}>
                    Es componente de otros productos
                  </Text>
                  <Text style={[styles.toggleDescription, isLightTheme && styles.toggleDescriptionLight]}>
                    {boolText(form.is_component)}
                  </Text>
                </Pressable>
              ) : null}

              {canControlExpiration ? (
                <Pressable
                  style={[
                    styles.toggleCard,
                    isLightTheme && styles.toggleCardLight,
                    form.requires_expiration && styles.toggleCardActive,
                    form.requires_expiration && isLightTheme && styles.toggleCardActiveLight,
                  ]}
                  onPress={() => setForm((prev) => ({ ...prev, requires_expiration: !prev.requires_expiration }))}
                >
                  <Text style={[styles.toggleTitle, isLightTheme && styles.toggleTitleLight]}>
                    Requiere control de vencimiento
                  </Text>
                  <Text style={[styles.toggleDescription, isLightTheme && styles.toggleDescriptionLight]}>
                    {boolText(form.requires_expiration)}
                  </Text>
                </Pressable>
              ) : null}

              {form.inventory_behavior === 'MANUFACTURED' ? (
                <SearchableSelectField
                  title="Tipo de producción"
                  themeMode={themeMode}
                  valueLabel={form.production_type === 'TO_STOCK' ? 'Para stock' : 'Bajo demanda'}
                  placeholder="Seleccionar tipo"
                  searchPlaceholder="Buscar tipo..."
                  options={PRODUCTION_TYPE_OPTIONS}
                  selectedKey={form.production_type || 'ON_DEMAND'}
                  onSelect={(nextValue) => setForm((prev) => ({ ...prev, production_type: nextValue || 'ON_DEMAND' }))}
                  allowClear={false}
                />
              ) : null}
            </View>
          ) : null}

          {isEditMode && typeof renderSupplementary === 'function'
            ? renderSupplementary({
                draft: previewDraft,
                product: initialProduct,
                tracksInventory,
                behaviorLabel,
              })
            : null}
        </>
      ) : null}
    </BottomSheetModal>
  );
}

const styles = StyleSheet.create({
  title: { color: '#f8fafc', fontSize: 20, fontWeight: '800', marginBottom: 6 },
  titleLight: { color: '#0f172a' },
  subtitle: { color: '#cbd5e1', fontSize: 13, marginBottom: 12 },
  subtitleLight: { color: '#475569' },
  stepRow: { flexDirection: 'row', gap: 8, marginBottom: 12 },
  stepBadge: {
    flex: 1,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#334155',
    paddingVertical: 7,
    paddingHorizontal: 8,
    backgroundColor: '#0f172a',
    alignItems: 'center',
  },
  stepBadgeLight: { borderColor: '#dbe4ef', backgroundColor: '#ffffff' },
  stepBadgeActive: { borderColor: '#2563eb', backgroundColor: '#1d4ed8' },
  stepBadgeText: { color: '#cbd5e1', fontWeight: '700', fontSize: 12 },
  stepBadgeTextActive: { color: '#eff6ff' },
  sectionTitle: { color: '#f8fafc', fontSize: 16, fontWeight: '800', marginBottom: 4 },
  sectionTitleLight: { color: '#0f172a' },
  sectionHint: { color: '#94a3b8', marginBottom: 12, fontSize: 13 },
  sectionHintLight: { color: '#475569' },
  input: {
    minHeight: 44,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#334155',
    backgroundColor: '#111827',
    color: '#f8fafc',
    paddingHorizontal: 12,
    marginBottom: 10,
  },
  inputLight: {
    borderColor: '#cbd5e1',
    backgroundColor: '#ffffff',
    color: '#0f172a',
  },
  textarea: {
    minHeight: 88,
    paddingTop: 10,
    textAlignVertical: 'top',
  },
  fieldLabel: {
    color: '#cbd5e1',
    fontSize: 13,
    fontWeight: '700',
    marginBottom: 6,
  },
  fieldLabelLight: {
    color: '#334155',
  },
  fieldHint: {
    color: '#94a3b8',
    fontSize: 12,
    marginTop: -4,
    marginBottom: 10,
  },
  fieldHintLight: {
    color: '#64748b',
  },
  row: { flexDirection: 'row', gap: 10 },
  rowInput: { flex: 1 },
  toggleRow: { flexDirection: 'row', gap: 8, marginBottom: 12 },
  toggleBtn: {
    flex: 1,
    borderWidth: 1,
    borderColor: '#334155',
    borderRadius: 10,
    backgroundColor: '#0f172a',
    paddingVertical: 12,
    paddingHorizontal: 12,
    alignItems: 'center',
  },
  toggleBtnLight: {
    borderColor: '#dbe4ef',
    backgroundColor: '#ffffff',
  },
  toggleBtnActive: {
    borderColor: '#2563eb',
    backgroundColor: '#1d4ed8',
  },
  toggleBtnActiveLight: {
    borderColor: '#2563eb',
    backgroundColor: '#dbeafe',
  },
  toggleBtnText: { color: '#cbd5e1', fontWeight: '700' },
  toggleBtnTextLight: { color: '#334155' },
  toggleBtnTextActive: { color: '#eff6ff' },
  profileList: { maxHeight: 360 },
  profileCard: {
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#334155',
    backgroundColor: '#111827',
    padding: 12,
    marginBottom: 10,
  },
  profileCardLight: {
    borderColor: '#dbe4ef',
    backgroundColor: '#ffffff',
  },
  profileCardActive: {
    borderColor: '#2563eb',
    backgroundColor: '#172554',
  },
  profileCardActiveLight: {
    borderColor: '#2563eb',
    backgroundColor: '#dbeafe',
  },
  profileHeader: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 6 },
  profileTitle: { color: '#f8fafc', fontSize: 15, fontWeight: '800' },
  profileTitleLight: { color: '#0f172a' },
  profileDescription: { color: '#cbd5e1', fontSize: 13, lineHeight: 18 },
  profileDescriptionLight: { color: '#475569' },
  summaryCard: {
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#1d4ed8',
    backgroundColor: '#0f172a',
    padding: 12,
    marginBottom: 12,
  },
  summaryCardLight: { backgroundColor: '#eff6ff', borderColor: '#93c5fd' },
  summaryTitle: { color: '#eff6ff', fontWeight: '800', marginBottom: 4 },
  summaryTitleLight: { color: '#1e3a8a' },
  summaryText: { color: '#cbd5e1', fontSize: 13 },
  summaryTextLight: { color: '#1f2937' },
  inlineLinkBtn: {
    marginTop: 10,
    marginBottom: 12,
    alignSelf: 'flex-start',
    paddingVertical: 6,
  },
  inlineLinkBtnLight: {},
  inlineLinkText: {
    color: '#93c5fd',
    fontWeight: '700',
    fontSize: 13,
  },
  inlineLinkTextLight: {
    color: '#235ea9',
  },
  advancedCard: {
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#334155',
    backgroundColor: '#0f172a',
    padding: 12,
    marginBottom: 12,
  },
  advancedCardLight: {
    borderColor: '#dbe4ef',
    backgroundColor: '#ffffff',
  },
  advancedTitle: {
    color: '#f8fafc',
    fontWeight: '800',
    fontSize: 14,
    marginBottom: 4,
  },
  advancedTitleLight: {
    color: '#0f172a',
  },
  advancedHint: {
    color: '#94a3b8',
    fontSize: 13,
    marginBottom: 10,
  },
  advancedHintLight: {
    color: '#475569',
  },
  toggleCard: {
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#334155',
    backgroundColor: '#111827',
    padding: 12,
    marginBottom: 10,
  },
  toggleCardLight: {
    borderColor: '#dbe4ef',
    backgroundColor: '#ffffff',
  },
  toggleCardActive: {
    borderColor: '#f59e0b',
    backgroundColor: '#3f2c0c',
  },
  toggleCardActiveLight: {
    borderColor: '#f59e0b',
    backgroundColor: '#fef3c7',
  },
  toggleTitle: { color: '#f8fafc', fontWeight: '700' },
  toggleTitleLight: { color: '#0f172a' },
  toggleDescription: { color: '#cbd5e1', marginTop: 4 },
  toggleDescriptionLight: { color: '#475569' },
  errorText: {
    color: '#fecaca',
    backgroundColor: '#451a1a',
    borderWidth: 1,
    borderColor: '#7f1d1d',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginBottom: 12,
  },
  errorTextLight: {
    color: '#991b1b',
    backgroundColor: '#fee2e2',
    borderColor: '#fecaca',
  },
  footer: { flexDirection: 'row', gap: 8 },
  footerBtn: { flex: 1 },
  btnContentRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6 },
  primaryBtn: {
    backgroundColor: '#86efac',
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: 'center',
  },
  primaryBtnText: { color: '#062915', fontWeight: '800' },
  secondaryBtn: {
    backgroundColor: '#1e3a8a',
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: 'center',
  },
  secondaryBtnText: { color: '#dbeafe', fontWeight: '700' },
  closeBtn: {
    backgroundColor: '#334155',
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: 'center',
  },
  closeBtnText: { color: '#ffffff', fontWeight: '700' },
  actionBtnDisabled: { opacity: 0.55 },
});
