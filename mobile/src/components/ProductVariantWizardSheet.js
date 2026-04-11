import { useEffect, useMemo, useState } from 'react';
import {
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import BottomSheetModal from './BottomSheetModal';
import SearchableSelectField from './SearchableSelectField';
import { humanizeAppError } from '../../../shared/utils/appErrors';
import { generateSeedVariantSku } from '../../../shared/utils/productCreationWizard';
import {
  buildInitialVariantDraft,
  buildVariantPayloadForSave,
  getVariantMinimumAlertSummary,
} from '../../../shared/utils/productVariantWizard';
import { createVariant, updateVariant } from '../services/productsCatalog.service';

const EXPIRATION_OPTIONS = [
  { key: 'inherit', label: 'Heredar del producto', searchText: 'Heredar del producto' },
  { key: 'required', label: 'Sí requiere', searchText: 'Sí requiere' },
  { key: 'not_required', label: 'No requiere', searchText: 'No requiere' },
];

const CODE_TYPE_OPTIONS = [
  { key: 'UNSPSC', label: 'UNSPSC', searchText: 'UNSPSC' },
  { key: 'EAN', label: 'EAN', searchText: 'EAN' },
  { key: 'GTIN', label: 'GTIN', searchText: 'GTIN' },
  { key: 'PARTNUM', label: 'Fabricante', searchText: 'Fabricante PARTNUM' },
];

function buildVariantContext(product) {
  return {
    track_inventory: product?.track_inventory === true,
    can_require_expiration: product?.inventory_behavior === 'RESELL' || product?.inventory_behavior === 'MANUFACTURED',
  };
}

function mapExpirationKeyToValue(key) {
  if (key === 'required') return true;
  if (key === 'not_required') return false;
  return null;
}

function mapExpirationValueToKey(value) {
  if (value === true) return 'required';
  if (value === false) return 'not_required';
  return 'inherit';
}

export default function ProductVariantWizardSheet({
  visible,
  onClose,
  themeMode,
  tenantId,
  product,
  variant = null,
  unitOptions = [],
  onSaved,
}) {
  const isLightTheme = themeMode === 'light';
  const isEditing = Boolean(variant?.variant_id);
  const [step, setStep] = useState(1);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [showAdvancedOptions, setShowAdvancedOptions] = useState(false);
  const [form, setForm] = useState(buildInitialVariantDraft({
    product_id: product?.product_id || null,
    ...variant,
  }, buildVariantContext(product)));

  useEffect(() => {
    if (!visible) return;
    setStep(1);
    setSaving(false);
    setError('');
    setShowAdvancedOptions(false);
    setForm(buildInitialVariantDraft({
      product_id: product?.product_id || null,
      ...variant,
    }, buildVariantContext(product)));
  }, [product, variant, visible]);

  const canTrackInventory = useMemo(() => buildVariantContext(product).track_inventory, [product]);
  const canRequireExpiration = useMemo(() => buildVariantContext(product).can_require_expiration, [product]);
  const minimumAlertSummary = useMemo(
    () => getVariantMinimumAlertSummary(form, buildVariantContext(product)),
    [form, product],
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

  const goNext = () => {
    setError('');
    if (step === 1 && !String(form.sku || '').trim()) {
      setError('El SKU es obligatorio.');
      return;
    }
    setStep((prev) => Math.min(3, prev + 1));
  };

  const autoGenerateSku = () => {
    setForm((prev) => ({
      ...prev,
      sku: generateSeedVariantSku(product?.name || 'PRODUCTO', prev.variant_name || 'VARIANTE'),
    }));
  };

  const submit = async () => {
    if (!tenantId || !product?.product_id) {
      setError('Falta contexto del producto para guardar la variante.');
      return;
    }

    const payload = buildVariantPayloadForSave(form, buildVariantContext(product));
    if (!payload.sku) {
      setError('El SKU es obligatorio.');
      setStep(1);
      return;
    }

    setSaving(true);
    setError('');

    const result = isEditing
      ? await updateVariant(variant.variant_id, tenantId, payload)
      : await createVariant({
          tenant_id: tenantId,
          product_id: product.product_id,
          ...payload,
        });

    if (!result.success) {
      setSaving(false);
      setError(humanizeAppError(result.error, { defaultMessage: 'No se pudo guardar la variante.' }));
      return;
    }

    setSaving(false);
    if (typeof onSaved === 'function') {
      onSaved({
        variant: result.data,
        message: isEditing ? 'Variante actualizada correctamente.' : 'Variante creada correctamente.',
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
              <Text style={styles.primaryBtnText}>{step < 3 ? 'Continuar' : (saving ? 'Guardando...' : (isEditing ? 'Guardar' : 'Crear'))}</Text>
            </View>
          </Pressable>
        </View>
      )}
    >
      <Text style={[styles.title, isLightTheme && styles.titleLight]}>{isEditing ? 'Editar variante guiada' : 'Crear variante guiada'}</Text>
      <Text style={[styles.subtitle, isLightTheme && styles.subtitleLight]}>
        La variante sigue el mismo lenguaje del producto: identidad, precio y control operativo sin ruido innecesario.
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
              {value === 1 ? 'Identidad' : value === 2 ? 'Precio' : 'Operación'}
            </Text>
          </View>
        ))}
      </View>

      {error ? <Text style={[styles.errorText, isLightTheme && styles.errorTextLight]}>{error}</Text> : null}

      {step === 1 ? (
        <>
          <Text style={[styles.sectionTitle, isLightTheme && styles.sectionTitleLight]}>Identidad de la variante</Text>
          <Text style={[styles.sectionHint, isLightTheme && styles.sectionHintLight]}>
            Define cómo reconocerás esta variante dentro del producto {product?.name || 'actual'}.
          </Text>

          <Text style={[styles.fieldLabel, isLightTheme && styles.fieldLabelLight]}>SKU</Text>
          <View style={styles.row}>
            <View style={styles.rowInput}>
              <TextInput
                style={[styles.input, isLightTheme && styles.inputLight]}
                value={form.sku}
                onChangeText={(value) => setForm((prev) => ({ ...prev, sku: value }))}
                placeholder="SKU"
                placeholderTextColor="#64748b"
              />
            </View>
            <Pressable style={[styles.autoBtn, isLightTheme && styles.autoBtnLight]} onPress={autoGenerateSku}>
              <Ionicons name="sparkles-outline" size={16} color={isLightTheme ? '#235ea9' : '#bfdbfe'} />
            </Pressable>
          </View>

          <Text style={[styles.fieldLabel, isLightTheme && styles.fieldLabelLight]}>Nombre de la variante</Text>
          <TextInput
            style={[styles.input, isLightTheme && styles.inputLight]}
            value={form.variant_name}
            onChangeText={(value) => setForm((prev) => ({ ...prev, variant_name: value }))}
            placeholder="Ej: Azul M, 500 ml, Caja x12"
            placeholderTextColor="#64748b"
          />
        </>
      ) : null}

      {step === 2 ? (
        <>
          <Text style={[styles.sectionTitle, isLightTheme && styles.sectionTitleLight]}>Precio y costo</Text>
          <Text style={[styles.sectionHint, isLightTheme && styles.sectionHintLight]}>
            Lo mínimo para que esta variante quede lista para operación.
          </Text>

          <View style={styles.row}>
            <View style={styles.rowInput}>
              <Text style={[styles.fieldLabel, isLightTheme && styles.fieldLabelLight]}>Costo</Text>
              <TextInput
                style={[styles.input, isLightTheme && styles.inputLight]}
                value={String(form.cost ?? '')}
                onChangeText={(value) => setForm((prev) => ({ ...prev, cost: value }))}
                placeholder="0"
                placeholderTextColor="#64748b"
                keyboardType="numeric"
              />
            </View>
            <View style={styles.rowInput}>
              <Text style={[styles.fieldLabel, isLightTheme && styles.fieldLabelLight]}>Precio</Text>
              <TextInput
                style={[styles.input, isLightTheme && styles.inputLight]}
                value={String(form.price ?? '')}
                onChangeText={(value) => setForm((prev) => ({ ...prev, price: value }))}
                placeholder="0"
                placeholderTextColor="#64748b"
                keyboardType="numeric"
              />
            </View>
          </View>

          <Pressable
            style={[
              styles.toggleCard,
              isLightTheme && styles.toggleCardLight,
              form.price_includes_tax && styles.toggleCardActive,
              form.price_includes_tax && isLightTheme && styles.toggleCardActiveLight,
            ]}
            onPress={() => setForm((prev) => ({ ...prev, price_includes_tax: !prev.price_includes_tax }))}
          >
            <Text style={[styles.toggleTitle, isLightTheme && styles.toggleTitleLight]}>
              El precio ya incluye impuesto
            </Text>
            <Text style={[styles.toggleDescription, isLightTheme && styles.toggleDescriptionLight]}>
              {form.price_includes_tax ? 'Sí' : 'No'}
            </Text>
          </Pressable>
        </>
      ) : null}

      {step === 3 ? (
        <>
          <Text style={[styles.sectionTitle, isLightTheme && styles.sectionTitleLight]}>Control operativo</Text>
          <Text style={[styles.sectionHint, isLightTheme && styles.sectionHintLight]}>
            Solo mostramos lo que realmente aplica según la configuración del producto.
          </Text>

          {!canTrackInventory ? (
            <View style={[styles.summaryCard, isLightTheme && styles.summaryCardLight]}>
              <Text style={[styles.summaryText, isLightTheme && styles.summaryTextLight]}>
                Este producto no controla inventario en este momento, así que la variante no necesita alerta mínima ni sobreventa.
              </Text>
            </View>
          ) : null}

          {canTrackInventory ? (
            <>
              <Text style={[styles.fieldLabel, isLightTheme && styles.fieldLabelLight]}>Alerta mínima de stock</Text>
              <TextInput
                style={[styles.input, isLightTheme && styles.inputLight]}
                value={String(form.min_stock ?? '')}
                onChangeText={(value) => setForm((prev) => ({ ...prev, min_stock: value }))}
                placeholder="0"
                placeholderTextColor="#64748b"
                keyboardType="numeric"
              />
              <Text style={[styles.fieldHint, isLightTheme && styles.fieldHintLight]}>0 = sin alerta mínima</Text>

              <Pressable
                style={[
                  styles.toggleCard,
                  isLightTheme && styles.toggleCardLight,
                  form.allow_backorder && styles.toggleCardActive,
                  form.allow_backorder && isLightTheme && styles.toggleCardActiveLight,
                ]}
                onPress={() => setForm((prev) => ({ ...prev, allow_backorder: !prev.allow_backorder }))}
              >
                <Text style={[styles.toggleTitle, isLightTheme && styles.toggleTitleLight]}>
                  Permitir sobreventa
                </Text>
                <Text style={[styles.toggleDescription, isLightTheme && styles.toggleDescriptionLight]}>
                  {form.allow_backorder ? 'Sí' : 'No'}
                </Text>
              </Pressable>
            </>
          ) : null}

          {canRequireExpiration ? (
            <SearchableSelectField
              title="Control de vencimiento"
              themeMode={themeMode}
              valueLabel={EXPIRATION_OPTIONS.find((item) => item.key === mapExpirationValueToKey(form.requires_expiration))?.label || 'Heredar del producto'}
              placeholder="Seleccionar regla"
              searchPlaceholder="Buscar regla..."
              options={EXPIRATION_OPTIONS}
              selectedKey={mapExpirationValueToKey(form.requires_expiration)}
              onSelect={(nextValue) => setForm((prev) => ({ ...prev, requires_expiration: mapExpirationKeyToValue(nextValue) }))}
              allowClear={false}
            />
          ) : null}

          <Pressable
            style={[
              styles.toggleCard,
              isLightTheme && styles.toggleCardLight,
              form.is_active && styles.toggleCardActive,
              form.is_active && isLightTheme && styles.toggleCardActiveLight,
            ]}
            onPress={() => setForm((prev) => ({ ...prev, is_active: !prev.is_active }))}
          >
            <Text style={[styles.toggleTitle, isLightTheme && styles.toggleTitleLight]}>
              Variante activa
            </Text>
            <Text style={[styles.toggleDescription, isLightTheme && styles.toggleDescriptionLight]}>
              {form.is_active ? 'Sí' : 'No'}
            </Text>
          </Pressable>

          <View style={[styles.summaryCard, isLightTheme && styles.summaryCardLight]}>
            <Text style={[styles.summaryTitle, isLightTheme && styles.summaryTitleLight]}>Resumen final</Text>
            <Text style={[styles.summaryText, isLightTheme && styles.summaryTextLight]}>
              Variante: {form.variant_name || 'Sin nombre específico'}
            </Text>
            <Text style={[styles.summaryText, isLightTheme && styles.summaryTextLight]}>
              SKU: {form.sku || 'Pendiente'}
            </Text>
            <Text style={[styles.summaryText, isLightTheme && styles.summaryTextLight]}>
              Inventario: {canTrackInventory ? 'Controlado' : 'No aplica'}
            </Text>
            {canTrackInventory ? (
              <Text style={[styles.summaryText, isLightTheme && styles.summaryTextLight]}>
                Alerta mínima: {minimumAlertSummary}
              </Text>
            ) : null}
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
                {showAdvancedOptions ? 'Ocultar ajustes especiales' : 'Necesito más detalle'}
              </Text>
            </View>
          </Pressable>

          {showAdvancedOptions ? (
            <View style={[styles.advancedCard, isLightTheme && styles.advancedCardLight]}>
              <Text style={[styles.advancedTitle, isLightTheme && styles.advancedTitleLight]}>Facturación y códigos</Text>
              <Text style={[styles.advancedHint, isLightTheme && styles.advancedHintLight]}>
                Completa esto solo si tu operación o facturación lo necesita.
              </Text>

              <SearchableSelectField
                title="Unidad de medida DIAN"
                themeMode={themeMode}
                valueLabel={unitSelectOptions.find((item) => item.key === form.unit_id)?.label || 'Sin unidad'}
                clearLabel="Sin unidad"
                placeholder="Seleccionar unidad"
                searchPlaceholder="Buscar unidad..."
                options={unitSelectOptions}
                selectedKey={form.unit_id}
                onSelect={(nextValue) => setForm((prev) => ({ ...prev, unit_id: nextValue }))}
              />

              <Text style={[styles.fieldLabel, isLightTheme && styles.fieldLabelLight]}>Código estándar</Text>
              <TextInput
                style={[styles.input, isLightTheme && styles.inputLight]}
                value={form.standard_code}
                onChangeText={(value) => setForm((prev) => ({ ...prev, standard_code: value }))}
                placeholder="UNSPSC / EAN / GTIN"
                placeholderTextColor="#64748b"
              />

              <SearchableSelectField
                title="Tipo de código"
                themeMode={themeMode}
                valueLabel={CODE_TYPE_OPTIONS.find((item) => item.key === form.standard_code_type)?.label || 'UNSPSC'}
                placeholder="Seleccionar tipo"
                searchPlaceholder="Buscar tipo..."
                options={CODE_TYPE_OPTIONS}
                selectedKey={form.standard_code_type || 'UNSPSC'}
                onSelect={(nextValue) => setForm((prev) => ({ ...prev, standard_code_type: nextValue || 'UNSPSC' }))}
                allowClear={false}
              />
            </View>
          ) : null}
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
  fieldLabel: {
    color: '#cbd5e1',
    fontSize: 13,
    fontWeight: '700',
    marginBottom: 6,
  },
  fieldLabelLight: { color: '#334155' },
  fieldHint: {
    color: '#94a3b8',
    fontSize: 12,
    marginTop: -4,
    marginBottom: 10,
  },
  fieldHintLight: { color: '#64748b' },
  row: { flexDirection: 'row', gap: 10, alignItems: 'center' },
  rowInput: { flex: 1 },
  autoBtn: {
    width: 44,
    height: 44,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#2563eb',
    backgroundColor: '#172554',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 10,
  },
  autoBtnLight: {
    backgroundColor: '#dbeafe',
    borderColor: '#93c5fd',
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
  toggleTitle: { color: '#f8fafc', fontWeight: '800', marginBottom: 4 },
  toggleTitleLight: { color: '#0f172a' },
  toggleDescription: { color: '#cbd5e1', fontSize: 13 },
  toggleDescriptionLight: { color: '#475569' },
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
  inlineLinkTextLight: { color: '#235ea9' },
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
  advancedTitleLight: { color: '#0f172a' },
  advancedHint: {
    color: '#94a3b8',
    fontSize: 13,
    marginBottom: 10,
  },
  advancedHintLight: { color: '#475569' },
  footer: {
    flexDirection: 'row',
    gap: 8,
    width: '100%',
  },
  footerBtn: {
    flex: 1,
    minHeight: 42,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 12,
  },
  primaryBtn: { backgroundColor: '#86efac' },
  primaryBtnText: { color: '#062915', fontWeight: '800' },
  secondaryBtn: { backgroundColor: '#1d4ed8' },
  secondaryBtnText: { color: '#dbeafe', fontWeight: '700' },
  closeBtn: { backgroundColor: '#475569' },
  closeBtnText: { color: '#fff', fontWeight: '700' },
  btnContentRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  actionBtnDisabled: { opacity: 0.5 },
  errorText: {
    color: '#fecaca',
    backgroundColor: '#7f1d1d',
    padding: 10,
    borderRadius: 10,
    marginBottom: 12,
  },
  errorTextLight: {
    color: '#991b1b',
    backgroundColor: '#fee2e2',
  },
});
