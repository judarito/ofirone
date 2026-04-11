import { useEffect, useMemo, useState } from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import BottomSheetModal from './BottomSheetModal';
import SearchableSelectField from './SearchableSelectField';
import {
  DOCUMENT_TYPE_CODES,
  TAX_REGIME_OPTIONS_MOBILE,
} from '../../../shared/constants/thirdParty';
import {
  THIRD_PARTY_WIZARD_TYPES,
  buildInitialThirdPartyDraft,
  buildThirdPartyDraftFromExisting,
  buildThirdPartyPayloadForSave,
  getThirdPartyTypeHelpText,
  getThirdPartyWizardType,
  sanitizeThirdPartyDraft,
} from '../../../shared/utils/thirdPartyWizard';
import { createThirdParty, updateThirdParty } from '../services/thirdParties.service';

const DOCUMENT_TYPE_OPTIONS = DOCUMENT_TYPE_CODES.map((code) => ({
  key: code,
  label: code,
  searchText: code,
}));

function boolText(value) {
  return value ? 'Sí' : 'No';
}

export default function ThirdPartyWizardSheet({
  visible,
  onClose,
  themeMode,
  tenantId,
  mode = 'create',
  initialThirdParty = null,
  forcedType = '',
  onSaved,
}) {
  const isLightTheme = themeMode === 'light';
  const isEditMode = mode === 'edit';
  const [step, setStep] = useState(1);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [showAdvancedOptions, setShowAdvancedOptions] = useState(false);
  const [form, setForm] = useState(
    isEditMode && initialThirdParty
      ? buildThirdPartyDraftFromExisting(initialThirdParty, { forcedType })
      : buildInitialThirdPartyDraft(forcedType),
  );

  useEffect(() => {
    if (!visible) return;
    setStep(1);
    setSaving(false);
    setError('');
    setShowAdvancedOptions(false);
    setForm(
      mode === 'edit' && initialThirdParty
        ? buildThirdPartyDraftFromExisting(initialThirdParty, { forcedType })
        : buildInitialThirdPartyDraft(forcedType),
    );
  }, [forcedType, initialThirdParty, mode, visible]);

  const previewDraft = useMemo(() => sanitizeThirdPartyDraft(form, { forcedType }), [form, forcedType]);
  const selectedType = useMemo(() => getThirdPartyWizardType(form.type, forcedType), [forcedType, form.type]);
  const typeHelpText = useMemo(() => getThirdPartyTypeHelpText(form.type, forcedType), [forcedType, form.type]);
  const summaryContact = useMemo(
    () => [previewDraft.phone, previewDraft.email].filter(Boolean).join(' · ') || 'Sin datos de contacto',
    [previewDraft],
  );

  const goNext = () => {
    setError('');
    if (!String(form.legal_name || '').trim() || !String(form.document_number || '').trim()) {
      setError('Nombre y documento son obligatorios.');
      return;
    }
    setStep((prev) => Math.min(3, prev + 1));
  };

  const submit = async () => {
    if (!tenantId) {
      setError('No hay tenant activo para guardar el tercero.');
      return;
    }

    const payload = buildThirdPartyPayloadForSave(form, { tenantId, forcedType });
    if (!payload.legal_name || !payload.document_number) {
      setError('Nombre y documento son obligatorios.');
      setStep(1);
      return;
    }

    setSaving(true);
    setError('');

    const result = isEditMode
      ? await updateThirdParty(initialThirdParty.third_party_id, payload)
      : await createThirdParty(payload);

    if (!result.success) {
      setSaving(false);
      setError(result.error || 'No fue posible guardar el tercero.');
      return;
    }

    setSaving(false);
    if (typeof onSaved === 'function') {
      onSaved({
        message: isEditMode ? 'Tercero actualizado correctamente.' : 'Tercero creado correctamente.',
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
            <Text style={styles.secondaryBtnText}>Atrás</Text>
          </Pressable>
          <Pressable style={[styles.footerBtn, styles.closeBtn]} onPress={onClose}>
            <Text style={styles.closeBtnText}>Cerrar</Text>
          </Pressable>
          <Pressable
            style={[styles.footerBtn, styles.primaryBtn, saving && styles.actionBtnDisabled]}
            onPress={step < 3 ? goNext : submit}
            disabled={saving}
          >
            <Text style={styles.primaryBtnText}>{step < 3 ? 'Continuar' : (saving ? 'Guardando...' : (isEditMode ? 'Guardar' : 'Crear'))}</Text>
          </Pressable>
        </View>
      )}
    >
      <Text style={[styles.title, isLightTheme && styles.titleLight]}>{isEditMode ? 'Editar tercero guiado' : 'Crear tercero guiado'}</Text>
      <Text style={[styles.subtitle, isLightTheme && styles.subtitleLight]}>
        Empezamos por rol, identificación y contacto. Lo fiscal y comercial queda disponible solo si hace falta.
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
              {value === 1 ? 'Identidad' : value === 2 ? 'Contacto' : 'Ajustes'}
            </Text>
          </View>
        ))}
      </View>

      {error ? <Text style={[styles.errorText, isLightTheme && styles.errorTextLight]}>{error}</Text> : null}

      {step === 1 ? (
        <>
          <Text style={[styles.sectionTitle, isLightTheme && styles.sectionTitleLight]}>{isEditMode ? '¿Qué tercero estás editando?' : '¿Qué tercero vas a crear?'}</Text>
          <Text style={[styles.sectionHint, isLightTheme && styles.sectionHintLight]}>
            Escoge el rol principal y registra la identidad fiscal.
          </Text>

          <ScrollView style={styles.profileList}>
            {THIRD_PARTY_WIZARD_TYPES.map((typeOption) => {
              const active = previewDraft.type === typeOption.id;
              return (
                <Pressable
                  key={typeOption.id}
                  style={[
                    styles.profileCard,
                    isLightTheme && styles.profileCardLight,
                    active && styles.profileCardActive,
                    active && isLightTheme && styles.profileCardActiveLight,
                    forcedType && styles.actionBtnDisabled,
                  ]}
                  onPress={() => {
                    if (forcedType) return;
                    setForm((prev) => ({ ...prev, type: typeOption.id }));
                  }}
                >
                  <Text style={[styles.profileTitle, isLightTheme && styles.profileTitleLight]}>
                    {typeOption.title}
                  </Text>
                  <Text style={[styles.profileDescription, isLightTheme && styles.profileDescriptionLight]}>
                    {typeOption.description}
                  </Text>
                </Pressable>
              );
            })}
          </ScrollView>

          <View style={[styles.summaryCard, isLightTheme && styles.summaryCardLight]}>
            <Text style={[styles.summaryTitle, isLightTheme && styles.summaryTitleLight]}>
              Selección actual: {selectedType.title}
            </Text>
            <Text style={[styles.summaryText, isLightTheme && styles.summaryTextLight]}>{typeHelpText}</Text>
          </View>

          <TextInput
            style={[styles.input, isLightTheme && styles.inputLight]}
            value={form.legal_name}
            onChangeText={(value) => setForm((prev) => ({ ...prev, legal_name: value }))}
            placeholder="Razón social / nombre completo *"
            placeholderTextColor="#64748b"
          />
          <TextInput
            style={[styles.input, isLightTheme && styles.inputLight]}
            value={form.trade_name}
            onChangeText={(value) => setForm((prev) => ({ ...prev, trade_name: value }))}
            placeholder="Nombre comercial"
            placeholderTextColor="#64748b"
          />

          <SearchableSelectField
            title="Tipo de documento"
            themeMode={themeMode}
            valueLabel={form.document_type || 'CC'}
            placeholder="Seleccionar tipo"
            searchPlaceholder="Buscar tipo..."
            options={DOCUMENT_TYPE_OPTIONS}
            selectedKey={form.document_type}
            onSelect={(nextValue) => setForm((prev) => ({ ...prev, document_type: nextValue || 'CC' }))}
            allowClear={false}
          />

          <View style={styles.row}>
            <View style={styles.rowInput}>
              <TextInput
                style={[styles.input, isLightTheme && styles.inputLight]}
                value={form.document_number}
                onChangeText={(value) => setForm((prev) => ({ ...prev, document_number: value }))}
                placeholder="Número documento *"
                placeholderTextColor="#64748b"
              />
            </View>
            <View style={styles.shortInputWrap}>
              <TextInput
                style={[styles.input, isLightTheme && styles.inputLight]}
                value={form.dv}
                onChangeText={(value) => setForm((prev) => ({ ...prev, dv: value }))}
                placeholder="DV"
                placeholderTextColor="#64748b"
              />
            </View>
          </View>
        </>
      ) : null}

      {step === 2 ? (
        <>
          <Text style={[styles.sectionTitle, isLightTheme && styles.sectionTitleLight]}>Contacto y ubicación</Text>
          <Text style={[styles.sectionHint, isLightTheme && styles.sectionHintLight]}>
            Lo mínimo para poder ubicar y usar este tercero en la operación.
          </Text>

          <TextInput
            style={[styles.input, isLightTheme && styles.inputLight]}
            value={form.phone}
            onChangeText={(value) => setForm((prev) => ({ ...prev, phone: value }))}
            placeholder="Teléfono"
            placeholderTextColor="#64748b"
          />
          <TextInput
            style={[styles.input, isLightTheme && styles.inputLight]}
            value={form.email}
            onChangeText={(value) => setForm((prev) => ({ ...prev, email: value }))}
            placeholder="Correo electrónico"
            placeholderTextColor="#64748b"
            autoCapitalize="none"
          />
          <TextInput
            style={[styles.input, isLightTheme && styles.inputLight]}
            value={form.fiscal_email}
            onChangeText={(value) => setForm((prev) => ({ ...prev, fiscal_email: value }))}
            placeholder="Correo fiscal / facturación"
            placeholderTextColor="#64748b"
            autoCapitalize="none"
          />
          <View style={styles.row}>
            <View style={styles.rowInput}>
              <TextInput
                style={[styles.input, isLightTheme && styles.inputLight]}
                value={form.department}
                onChangeText={(value) => setForm((prev) => ({ ...prev, department: value }))}
                placeholder="Departamento"
                placeholderTextColor="#64748b"
              />
            </View>
            <View style={styles.rowInput}>
              <TextInput
                style={[styles.input, isLightTheme && styles.inputLight]}
                value={form.city}
                onChangeText={(value) => setForm((prev) => ({ ...prev, city: value }))}
                placeholder="Ciudad / municipio"
                placeholderTextColor="#64748b"
              />
            </View>
          </View>
          <TextInput
            style={[styles.input, isLightTheme && styles.inputLight]}
            value={form.city_code}
            onChangeText={(value) => setForm((prev) => ({ ...prev, city_code: value }))}
            placeholder="Código DANE"
            placeholderTextColor="#64748b"
          />
          <TextInput
            style={[styles.input, isLightTheme && styles.inputLight, styles.textarea]}
            value={form.address_text}
            onChangeText={(value) => setForm((prev) => ({ ...prev, address_text: value }))}
            placeholder="Dirección"
            placeholderTextColor="#64748b"
            multiline
          />
        </>
      ) : null}

      {step === 3 ? (
        <>
          <Text style={[styles.sectionTitle, isLightTheme && styles.sectionTitleLight]}>Resumen y ajustes</Text>
          <Text style={[styles.sectionHint, isLightTheme && styles.sectionHintLight]}>
            Con lo anterior el tercero ya queda usable. Si hace falta, aquí activas lo fiscal y comercial.
          </Text>

          <View style={[styles.summaryCard, isLightTheme && styles.summaryCardLight]}>
            <Text style={[styles.summaryTitle, isLightTheme && styles.summaryTitleLight]}>Resumen final</Text>
            <Text style={[styles.summaryText, isLightTheme && styles.summaryTextLight]}>
              Tipo: {selectedType.title}
            </Text>
            <Text style={[styles.summaryText, isLightTheme && styles.summaryTextLight]}>
              Nombre: {previewDraft.legal_name || 'Pendiente'}
            </Text>
            <Text style={[styles.summaryText, isLightTheme && styles.summaryTextLight]}>
              Documento: {[previewDraft.document_type, previewDraft.document_number].filter(Boolean).join(' ') || 'Pendiente'}
            </Text>
            <Text style={[styles.summaryText, isLightTheme && styles.summaryTextLight]}>
              Contacto: {summaryContact}
            </Text>
          </View>

          <Pressable
            style={[styles.inlineLinkBtn, isLightTheme && styles.inlineLinkBtnLight]}
            onPress={() => setShowAdvancedOptions((prev) => !prev)}
          >
            <Text style={[styles.inlineLinkText, isLightTheme && styles.inlineLinkTextLight]}>
              {showAdvancedOptions ? 'Ocultar ajustes especiales' : 'Necesito configuración fiscal o comercial'}
            </Text>
          </Pressable>

          {showAdvancedOptions ? (
            <View style={[styles.advancedCard, isLightTheme && styles.advancedCardLight]}>
              <TextInput
                style={[styles.input, isLightTheme && styles.inputLight]}
                value={String(form.max_credit_amount ?? '')}
                onChangeText={(value) => setForm((prev) => ({ ...prev, max_credit_amount: value }))}
                placeholder="Cupo de crédito"
                placeholderTextColor="#64748b"
                keyboardType="numeric"
              />
              <TextInput
                style={[styles.input, isLightTheme && styles.inputLight]}
                value={String(form.default_payment_terms ?? '')}
                onChangeText={(value) => setForm((prev) => ({ ...prev, default_payment_terms: value }))}
                placeholder="Días de pago"
                placeholderTextColor="#64748b"
                keyboardType="numeric"
              />
              <TextInput
                style={[styles.input, isLightTheme && styles.inputLight]}
                value={form.default_currency}
                onChangeText={(value) => setForm((prev) => ({ ...prev, default_currency: value }))}
                placeholder="Moneda"
                placeholderTextColor="#64748b"
              />

              <SearchableSelectField
                title="Régimen tributario"
                themeMode={themeMode}
                valueLabel={TAX_REGIME_OPTIONS_MOBILE.find((entry) => entry.value === form.tax_regime)?.label || 'Sin régimen'}
                clearLabel="Sin régimen"
                placeholder="Seleccionar régimen"
                searchPlaceholder="Buscar régimen..."
                options={TAX_REGIME_OPTIONS_MOBILE.map((entry) => ({ key: entry.value, label: entry.label, searchText: entry.label }))}
                selectedKey={form.tax_regime}
                onSelect={(nextValue) => setForm((prev) => ({ ...prev, tax_regime: nextValue || '' }))}
              />

              <TextInput
                style={[styles.input, isLightTheme && styles.inputLight]}
                value={form.ciiu_code}
                onChangeText={(value) => setForm((prev) => ({ ...prev, ciiu_code: value }))}
                placeholder="Código CIIU"
                placeholderTextColor="#64748b"
              />

              {[
                ['is_responsible_for_iva', 'Responsable de IVA'],
                ['obligated_accounting', 'Obligado a llevar contabilidad'],
                ['electronic_invoicing_enabled', 'Acepta factura electrónica'],
                ['is_active', 'Activo'],
              ].map(([key, label]) => (
                <Pressable
                  key={key}
                  style={[
                    styles.toggleCard,
                    isLightTheme && styles.toggleCardLight,
                    previewDraft[key] && styles.toggleCardActive,
                    previewDraft[key] && isLightTheme && styles.toggleCardActiveLight,
                  ]}
                  onPress={() => setForm((prev) => ({ ...prev, [key]: !prev[key] }))}
                >
                  <Text style={[styles.toggleTitle, isLightTheme && styles.toggleTitleLight]}>{label}</Text>
                  <Text style={[styles.toggleDescription, isLightTheme && styles.toggleDescriptionLight]}>{boolText(previewDraft[key])}</Text>
                </Pressable>
              ))}
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
  profileList: { maxHeight: 260 },
  profileCard: {
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#334155',
    backgroundColor: '#111827',
    padding: 12,
    marginBottom: 10,
  },
  profileCardLight: { borderColor: '#dbe4ef', backgroundColor: '#ffffff' },
  profileCardActive: { borderColor: '#2563eb', backgroundColor: '#172554' },
  profileCardActiveLight: { borderColor: '#2563eb', backgroundColor: '#dbeafe' },
  profileTitle: { color: '#f8fafc', fontSize: 15, fontWeight: '800', marginBottom: 6 },
  profileTitleLight: { color: '#0f172a' },
  profileDescription: { color: '#cbd5e1', fontSize: 13, lineHeight: 18 },
  profileDescriptionLight: { color: '#475569' },
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
  inputLight: { borderColor: '#cbd5e1', backgroundColor: '#ffffff', color: '#0f172a' },
  textarea: { minHeight: 80, paddingTop: 10, textAlignVertical: 'top' },
  row: { flexDirection: 'row', gap: 10 },
  rowInput: { flex: 1 },
  shortInputWrap: { width: 90 },
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
  inlineLinkBtn: { marginTop: 10, marginBottom: 12, alignSelf: 'flex-start', paddingVertical: 6 },
  inlineLinkBtnLight: {},
  inlineLinkText: { color: '#93c5fd', fontWeight: '700', fontSize: 13 },
  inlineLinkTextLight: { color: '#235ea9' },
  advancedCard: {
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#334155',
    backgroundColor: '#0f172a',
    padding: 12,
    marginBottom: 12,
  },
  advancedCardLight: { borderColor: '#dbe4ef', backgroundColor: '#ffffff' },
  toggleCard: {
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#334155',
    backgroundColor: '#111827',
    padding: 12,
    marginBottom: 10,
  },
  toggleCardLight: { borderColor: '#dbe4ef', backgroundColor: '#ffffff' },
  toggleCardActive: { borderColor: '#f59e0b', backgroundColor: '#3f2c0c' },
  toggleCardActiveLight: { borderColor: '#f59e0b', backgroundColor: '#fef3c7' },
  toggleTitle: { color: '#f8fafc', fontWeight: '800', marginBottom: 4 },
  toggleTitleLight: { color: '#0f172a' },
  toggleDescription: { color: '#cbd5e1', fontSize: 13 },
  toggleDescriptionLight: { color: '#475569' },
  footer: { flexDirection: 'row', gap: 8, width: '100%' },
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
  actionBtnDisabled: { opacity: 0.5 },
  errorText: {
    color: '#fecaca',
    backgroundColor: '#7f1d1d',
    padding: 10,
    borderRadius: 10,
    marginBottom: 12,
  },
  errorTextLight: { color: '#991b1b', backgroundColor: '#fee2e2' },
});
