import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Platform, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import BottomSheetModal from '../components/BottomSheetModal';
import ListHeaderActionButton from '../components/ListHeaderActionButton';
import PaginatedList from '../components/PaginatedList';
import SearchableSelectField from '../components/SearchableSelectField';
import { usePaginatedList } from '../hooks/usePaginatedList';
import { useAndroidBottomInset } from '../lib/useAndroidBottomInset';
import { useThemeMode } from '../lib/themeMode';
import { extractTextWithNativeOcr, getNativeOcrStatus } from '../services/commandEngine';
import { analyzeInvoiceWithImage, analyzeInvoiceWithText, matchInvoiceLinesToCatalog } from '../services/invoiceAgent.service';
import { listCatalogCandidatesForMatching } from '../services/pos.service';
import { suggestCatalogProductFromInvoiceLine } from '../services/purchaseInvoiceAssistant.service';
import { listLocations, listPurchases } from '../services/inventoryCatalog.service';
import {
  createCatalogVariantForPurchase,
  createPurchase,
  createPurchaseOrder,
  createSupplierPayable,
  generatePurchaseBatchNumber,
  getPurchaseDetail,
  getSupplierPayableByPurchase,
  listPurchaseSuppliers,
  registerSupplierPayment,
  searchPurchaseVariants,
} from '../services/purchases.service';

function buildLineId() {
  return `purchase-line-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
}

function createPurchaseLine(payload = {}) {
  return {
    line_id: payload.line_id || buildLineId(),
    variant_id: payload.variant_id || '',
    variant_label: payload.variant_label || '',
    sku: payload.sku || '',
    qty: payload.qty !== undefined ? String(payload.qty) : '1',
    unit_cost: payload.unit_cost !== undefined ? String(payload.unit_cost) : '',
    requires_expiration: Boolean(payload.requires_expiration),
    batch_number: payload.batch_number || '',
    expiration_date: payload.expiration_date || '',
    physical_location: payload.physical_location || '',
  };
}

function createPurchaseForm(defaultLocationId = '') {
  return {
    location_id: defaultLocationId || '',
    supplier_id: '',
    supplier_label: '',
    note: '',
    lines: [createPurchaseLine()],
  };
}

function createPayableForm() {
  return {
    invoice_number: '',
    due_date: '',
    note: '',
  };
}

const OCR_MAX_BYTES = 980 * 1024;

function estimateBase64Bytes(base64) {
  const raw = String(base64 || '');
  if (!raw) return 0;
  return Math.ceil((raw.length * 3) / 4);
}

function createPaymentForm(balance = '') {
  return {
    amount: balance ? String(balance) : '',
    payment_method: '',
    note: '',
  };
}

function normalizeDateInput(value) {
  if (!value) return null;
  const raw = String(value).trim();
  if (!raw) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;

  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString().slice(0, 10);
}

function parseDecimalInput(value) {
  const normalized = String(value ?? '')
    .replace(/\s+/g, '')
    .replace(',', '.');
  return Number(normalized);
}

function normalizeLookupText(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase();
}

async function buildOptimizedImageForOcr(asset) {
  if (!asset?.uri) {
    return { success: false, error: 'No se pudo obtener URI de imagen.' };
  }

  let ImageManipulator;
  try {
    ImageManipulator = require('expo-image-manipulator');
  } catch (_error) {
    return {
      success: false,
      error: 'Falta expo-image-manipulator. Instala dependencia o toma una foto mas cercana.',
    };
  }

  const widths = [1400, 1200, 1000, 800];
  const qualities = [0.35, 0.22, 0.14, 0.1];

  for (const width of widths) {
    for (const quality of qualities) {
      const result = await ImageManipulator.manipulateAsync(
        asset.uri,
        [{ resize: { width } }],
        {
          compress: quality,
          format: ImageManipulator.SaveFormat.JPEG,
          base64: true,
        },
      );

      if (result?.base64 && estimateBase64Bytes(result.base64) <= OCR_MAX_BYTES) {
        return {
          success: true,
          data: { base64: result.base64, mimeType: 'image/jpeg' },
        };
      }
    }
  }

  return {
    success: false,
    error: 'No se pudo reducir la foto por debajo de 1MB para OCR. Acerca mas la camara y evita fondo extra.',
  };
}

async function buildEnhancedImageForNativeOcr(asset) {
  if (!asset?.uri) {
    return { success: false, error: 'No se pudo obtener URI de imagen para OCR nativo.' };
  }

  let ImageManipulator;
  try {
    ImageManipulator = require('expo-image-manipulator');
  } catch (_error) {
    return {
      success: false,
      error: 'Falta expo-image-manipulator para mejorar OCR nativo.',
    };
  }

  try {
    const result = await ImageManipulator.manipulateAsync(
      asset.uri,
      [{ resize: { width: 2000 } }],
      {
        compress: 1,
        format: ImageManipulator.SaveFormat.JPEG,
        base64: false,
      },
    );
    return { success: true, data: { uri: result?.uri || asset.uri } };
  } catch (error) {
    return {
      success: false,
      error: error?.message || 'No se pudo mejorar la imagen para OCR nativo.',
    };
  }
}

function scoreOcrTextForInvoice(text) {
  const normalized = String(text || '').replace(/\r/g, '\n');
  const lines = normalized
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
  if (!lines.length) return 0;

  const usefulLines = lines.filter((line) => /[a-zA-ZáéíóúÁÉÍÓÚñÑ]{3,}/.test(line)).length;
  const itemSignals = lines.filter((line) => /\b(cant|cantidad|descripcion|descripción|talla)\b/i.test(line)).length;
  const qtySignals = lines.filter((line) => /^\d+\s+/.test(line)).length;
  const longWords = lines.filter((line) => /\b[a-zA-ZáéíóúÁÉÍÓÚñÑ]{5,}\b/.test(line)).length;
  const charScore = Math.min(2000, normalized.length) * 0.005;

  return usefulLines + itemSignals * 2 + qtySignals * 2 + longWords * 0.8 + charScore;
}

function createInvoiceImportLine(line, index) {
  return {
    import_id: `purchase-invoice-line-${Date.now()}-${index}-${Math.random().toString(16).slice(2, 7)}`,
    raw_name: String(line?.raw_name || line?.name || '').trim(),
    sku: line?.sku ? String(line.sku).trim() : null,
    quantity: Math.max(1, Number(line?.quantity || 1)),
    unit_price: line?.unit_price == null ? null : Number(line.unit_price || 0),
    line_total: line?.line_total == null ? null : Number(line.line_total || 0),
  };
}

function resolveInvoiceUnitCost(line, variant) {
  const qty = Math.max(1, Number(line?.quantity || 1));
  if (line?.unit_price != null && Number.isFinite(Number(line.unit_price))) {
    return Math.max(0, Number(line.unit_price));
  }
  if (line?.line_total != null && Number.isFinite(Number(line.line_total))) {
    return Math.max(0, Number(line.line_total) / qty);
  }
  return Math.max(0, Number(variant?.cost || 0));
}

function buildPurchaseLineFromInvoiceMatch(match) {
  const variant = match?.variant || {};
  const line = match?.line || {};
  const unitCost = resolveInvoiceUnitCost(line, variant);
  return createPurchaseLine({
    line_id: buildLineId(),
    variant_id: variant.variant_id || '',
    variant_label: variant._displayName || `${variant?.product?.name || 'Producto'}${variant?.variant_name ? ` - ${variant.variant_name}` : ''}`,
    sku: variant.sku || line?.sku || '',
    qty: String(Math.max(1, Number(line?.quantity || 1))),
    unit_cost: Number.isFinite(unitCost) ? String(unitCost) : '',
    requires_expiration: Boolean(variant.requires_expiration),
    batch_number: '',
    expiration_date: '',
    physical_location: '',
  });
}

function findBestSupplierCandidate(searchText, suppliers) {
  const normalizedSearch = normalizeLookupText(searchText);
  if (!normalizedSearch) return null;

  return (suppliers || []).find((item) => {
    const candidates = [
      item?._displayName,
      item?.trade_name,
      item?.legal_name,
      item?.document_number,
    ].map(normalizeLookupText).filter(Boolean);
    return candidates.some((candidate) => (
      candidate === normalizedSearch
      || candidate.includes(normalizedSearch)
      || normalizedSearch.includes(candidate)
    ));
  }) || null;
}

function lineHasAnyContent(line) {
  const qtyValue = String(line?.qty || '').trim();
  return Boolean(
    line?.variant_id ||
      (qtyValue && qtyValue !== '1') ||
      String(line?.unit_cost || '').trim() ||
      String(line?.batch_number || '').trim() ||
      String(line?.expiration_date || '').trim() ||
      String(line?.physical_location || '').trim(),
  );
}

function formatDisplayDate(value) {
  if (!value) return '-';
  const dateValue = /^\d{4}-\d{2}-\d{2}$/.test(String(value))
    ? new Date(`${value}T00:00:00`)
    : new Date(value);
  if (Number.isNaN(dateValue.getTime())) return String(value);
  return dateValue.toLocaleDateString('es-CO');
}

function formatDisplayDateTime(value) {
  if (!value) return '-';
  const dateValue = new Date(value);
  if (Number.isNaN(dateValue.getTime())) return String(value);
  return dateValue.toLocaleString('es-CO');
}

function getPayableStatusMeta(status) {
  const map = {
    OPEN: {
      label: 'Abierta',
      borderColor: '#f59e0b',
      backgroundColor: '#3f2b05',
      textColor: '#fcd34d',
    },
    PARTIAL: {
      label: 'Parcial',
      borderColor: '#2563eb',
      backgroundColor: '#0b255a',
      textColor: '#bfdbfe',
    },
    PAID: {
      label: 'Pagada',
      borderColor: '#16a34a',
      backgroundColor: '#052e16',
      textColor: '#bbf7d0',
    },
    CANCELLED: {
      label: 'Cancelada',
      borderColor: '#64748b',
      backgroundColor: '#111827',
      textColor: '#cbd5e1',
    },
  };
  return map[status] || map.OPEN;
}

export default function PurchasesScreen({
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
  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [form, setForm] = useState(() => createPurchaseForm(''));
  const [formError, setFormError] = useState('');
  const [supplierOptions, setSupplierOptions] = useState([]);
  const [suppliersLoading, setSuppliersLoading] = useState(false);
  const [variantOptions, setVariantOptions] = useState([]);
  const [variantsLoading, setVariantsLoading] = useState(false);
  const [savingPurchase, setSavingPurchase] = useState(false);
  const [savingDraft, setSavingDraft] = useState(false);
  const [processingInvoice, setProcessingInvoice] = useState(false);
  const [creatingMissingCatalog, setCreatingMissingCatalog] = useState(false);
  const [creatingMissingIds, setCreatingMissingIds] = useState([]);
  const [invoiceImportSummary, setInvoiceImportSummary] = useState(null);
  const [generatingLineId, setGeneratingLineId] = useState('');
  const [detailModalOpen, setDetailModalOpen] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState('');
  const [payableError, setPayableError] = useState('');
  const [selectedPurchaseDetail, setSelectedPurchaseDetail] = useState(null);
  const [purchasePayable, setPurchasePayable] = useState(null);
  const [createPayableModalOpen, setCreatePayableModalOpen] = useState(false);
  const [payableForm, setPayableForm] = useState(() => createPayableForm());
  const [payableFormError, setPayableFormError] = useState('');
  const [savingPayable, setSavingPayable] = useState(false);
  const [paymentModalOpen, setPaymentModalOpen] = useState(false);
  const [paymentForm, setPaymentForm] = useState(() => createPaymentForm(''));
  const [paymentFormError, setPaymentFormError] = useState('');
  const [savingPayment, setSavingPayment] = useState(false);
  const mountedRef = useRef(true);
  const supplierSearchRequestRef = useRef(0);
  const variantSearchRequestRef = useRef(0);
  const detailRequestRef = useRef(0);

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
    setError,
    changePage,
    updateFilters,
  } = usePaginatedList({
    tenantId: tenant?.tenant_id,
    pageSize,
    offlineMode,
    cacheNamespace: 'inventory-purchases-v2',
    initialFilters: { location_id: '' },
    fetchPage: async ({ page: nextPage, pageSize: nextPageSize, filters: nextFilters, tenantId }) => {
      const offset = (nextPage - 1) * nextPageSize;
      return listPurchases({
        tenantId,
        locationId: nextFilters?.location_id || null,
        limit: nextPageSize,
        offset,
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
    if (!createModalOpen || !defaultLocationId || form.location_id) return;
    setForm((prev) => ({ ...prev, location_id: defaultLocationId }));
  }, [createModalOpen, defaultLocationId, form.location_id]);

  const money =
    formatMoney ||
    ((value) => `$ ${Math.round(Number(value || 0)).toLocaleString('es-CO')}`);

  const locationSelectOptions = useMemo(
    () =>
      (locations || []).map((loc) => ({
        key: loc.location_id,
        label: loc.name,
        searchText: loc.name,
      })),
    [locations],
  );

  const supplierSelectOptions = useMemo(
    () =>
      (supplierOptions || []).map((supplier) => ({
        key: supplier.third_party_id,
        label: supplier._displayName || supplier.trade_name || supplier.legal_name || 'Proveedor',
        searchText: [
          supplier.trade_name,
          supplier.legal_name,
          supplier.document_number,
          supplier.phone,
        ]
          .filter(Boolean)
          .join(' '),
      })),
    [supplierOptions],
  );

  const variantSelectOptions = useMemo(
    () =>
      (variantOptions || []).map((variant) => ({
        key: variant.variant_id,
        label: variant._displayName || 'Producto',
        searchText: [
          variant.product?.name,
          variant.variant_name,
          variant.sku,
          variant._displayName,
        ]
          .filter(Boolean)
          .join(' '),
        raw: variant,
      })),
    [variantOptions],
  );

  const estimatedTotal = useMemo(
    () =>
      (form.lines || []).reduce(
        (sum, line) => sum + (parseDecimalInput(line.qty) || 0) * (parseDecimalInput(line.unit_cost) || 0),
        0,
      ),
    [form.lines],
  );

  const loadSuppliers = useCallback(async (search = '') => {
    if (offlineMode) return;
    const requestId = supplierSearchRequestRef.current + 1;
    supplierSearchRequestRef.current = requestId;
    setSuppliersLoading(true);
    try {
      const result = await listPurchaseSuppliers({ search, limit: 60 });
      if (!mountedRef.current || requestId !== supplierSearchRequestRef.current) return;
      if (result.success) {
        setSupplierOptions(result.data || []);
      }
    } finally {
      if (mountedRef.current && requestId === supplierSearchRequestRef.current) {
        setSuppliersLoading(false);
      }
    }
  }, [offlineMode]);

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

  const loadPurchaseBundle = useCallback(async (purchaseId) => {
    if (!tenant?.tenant_id || !purchaseId) return;
    const requestId = detailRequestRef.current + 1;
    detailRequestRef.current = requestId;

    setDetailLoading(true);
    setDetailError('');
    setPayableError('');

    try {
      const [detailResult, payableResult] = await Promise.all([
        getPurchaseDetail(tenant.tenant_id, purchaseId),
        getSupplierPayableByPurchase(tenant.tenant_id, purchaseId),
      ]);

      if (!mountedRef.current || requestId !== detailRequestRef.current) return;

      if (!detailResult?.success) {
        setSelectedPurchaseDetail(null);
        setPurchasePayable(null);
        setDetailError(detailResult?.error || 'No fue posible cargar el detalle de la compra.');
        return;
      }

      setSelectedPurchaseDetail(detailResult.data || null);

      if (!payableResult?.success) {
        setPurchasePayable(null);
        setPayableError(payableResult?.error || 'No fue posible cargar la cuenta por pagar.');
      } else {
        setPurchasePayable(payableResult.data || null);
        setPayableError('');
      }
    } finally {
      if (mountedRef.current && requestId === detailRequestRef.current) {
        setDetailLoading(false);
      }
    }
  }, [tenant?.tenant_id]);

  const refreshCurrentPurchaseBundle = useCallback(async () => {
    if (!selectedPurchaseDetail?.purchase_id) return;
    await loadPurchaseBundle(selectedPurchaseDetail.purchase_id);
  }, [loadPurchaseBundle, selectedPurchaseDetail?.purchase_id]);

  const openCreateModal = async () => {
    if (offlineMode) {
      setError('Compras no permite registros en modo offline.');
      return;
    }
    if (!tenant?.tenant_id || !userProfile?.user_id) {
      setError('Necesitas un tenant y usuario validos para registrar compras.');
      return;
    }

    setError('');
    setFormError('');
    setForm(createPurchaseForm(defaultLocationId));
    setInvoiceImportSummary(null);
    setCreatingMissingCatalog(false);
    setCreatingMissingIds([]);
    setCreateModalOpen(true);
    await Promise.all([loadSuppliers(''), loadVariants('')]);
  };

  const closeCreateModal = () => {
    setCreateModalOpen(false);
    setFormError('');
    setGeneratingLineId('');
    setProcessingInvoice(false);
    setCreatingMissingCatalog(false);
    setCreatingMissingIds([]);
    setInvoiceImportSummary(null);
  };

  const closeDetailModal = () => {
    detailRequestRef.current += 1;
    setDetailModalOpen(false);
    setDetailLoading(false);
    setDetailError('');
    setPayableError('');
    setCreatePayableModalOpen(false);
    setPaymentModalOpen(false);
    setPayableFormError('');
    setPaymentFormError('');
    setSelectedPurchaseDetail(null);
    setPurchasePayable(null);
  };

  const openPurchaseDetail = async (item) => {
    if (offlineMode) {
      setError('El detalle de compra y la cuenta por pagar requieren conexion por ahora.');
      return;
    }

    const purchaseId = item?.source_purchase_id || item?.purchase_id;
    if (!purchaseId) {
      setError('No se encontro el identificador de la compra.');
      return;
    }

    setError('');
    setDetailModalOpen(true);
    await loadPurchaseBundle(purchaseId);
  };

  const openCreatePayableModal = () => {
    if (!selectedPurchaseDetail?.purchase_id) {
      setPayableError('No se pudo identificar la compra.');
      return;
    }
    if (!selectedPurchaseDetail?.supplier) {
      setPayableError('La compra no tiene proveedor. No se puede crear cuenta por pagar.');
      return;
    }

    setPayableForm(createPayableForm());
    setPayableFormError('');
    setCreatePayableModalOpen(true);
  };

  const openPaymentModal = () => {
    if (!purchasePayable?.payable_id) {
      setPayableError('No se encontro la cuenta por pagar.');
      return;
    }

    setPaymentForm(createPaymentForm(purchasePayable.balance || ''));
    setPaymentFormError('');
    setPaymentModalOpen(true);
  };

  const updateLine = (lineId, patch) => {
    setForm((prev) => ({
      ...prev,
      lines: (prev.lines || []).map((line) => (line.line_id === lineId ? { ...line, ...patch } : line)),
    }));
  };

  const handleSelectSupplier = (nextSupplierId) => {
    if (!nextSupplierId) {
      setForm((prev) => ({ ...prev, supplier_id: '', supplier_label: '' }));
      return;
    }

    const selected = supplierSelectOptions.find((item) => String(item.key) === String(nextSupplierId));
    setForm((prev) => ({
      ...prev,
      supplier_id: nextSupplierId,
      supplier_label: selected?.label || prev.supplier_label || 'Proveedor',
    }));
  };

  const handleSelectVariant = (lineId, nextVariantId) => {
    if (!nextVariantId) {
      updateLine(lineId, {
        variant_id: '',
        variant_label: '',
        sku: '',
        qty: '1',
        unit_cost: '',
        requires_expiration: false,
        batch_number: '',
        expiration_date: '',
        physical_location: '',
      });
      return;
    }

    const selected = variantSelectOptions.find((item) => String(item.key) === String(nextVariantId));
    const variant = selected?.raw || null;
    const defaultCost = variant?.cost !== undefined && variant?.cost !== null ? String(variant.cost) : '';
    const requiresExpiration = Boolean(variant?.requires_expiration);

    updateLine(lineId, {
      variant_id: nextVariantId,
      variant_label: selected?.label || 'Producto',
      sku: variant?.sku || '',
      unit_cost: defaultCost,
      requires_expiration: requiresExpiration,
      batch_number: '',
      expiration_date: '',
      physical_location: '',
    });
  };

  const addLine = () => {
    setForm((prev) => ({
      ...prev,
      lines: [...(prev.lines || []), createPurchaseLine()],
    }));
  };

  const removeLine = (lineId) => {
    setForm((prev) => {
      if ((prev.lines || []).length <= 1) return prev;
      return {
        ...prev,
        lines: prev.lines.filter((line) => line.line_id !== lineId),
      };
    });
  };

  const generateBatchForLine = async (line) => {
    if (!tenant?.tenant_id) {
      setFormError('Tenant invalido para generar lote.');
      return;
    }
    if (!form.location_id) {
      setFormError('Selecciona primero la sede de la compra.');
      return;
    }
    if (!line?.variant_id) {
      setFormError('Selecciona primero un producto.');
      return;
    }

    setFormError('');
    setGeneratingLineId(line.line_id);
    try {
      const result = await generatePurchaseBatchNumber({
        tenantId: tenant.tenant_id,
        variantId: line.variant_id,
        locationId: form.location_id,
      });

      if (!result.success || !result.batchNumber) {
        throw new Error(result.error || 'No fue posible generar el lote.');
      }

      updateLine(line.line_id, { batch_number: result.batchNumber });
    } catch (nextError) {
      setFormError(nextError.message);
    } finally {
      setGeneratingLineId('');
    }
  };

  const mergeImportedPurchaseLines = (nextLines) => {
    const additions = Array.isArray(nextLines) ? nextLines.filter(Boolean) : [];
    if (!additions.length) return;

    setForm((prev) => {
      const currentLines = Array.isArray(prev.lines) ? prev.lines : [];
      const canReplacePlaceholder =
        currentLines.length === 1 && !lineHasAnyContent(currentLines[0]);

      return {
        ...prev,
        lines: canReplacePlaceholder ? additions : [...currentLines, ...additions],
      };
    });
  };

  const maybeAutofillSupplierFromInvoice = async (invoice) => {
    const vendorName = String(invoice?.vendor_name || '').trim();
    if (!vendorName) return;

    const result = await listPurchaseSuppliers({ search: vendorName, limit: 8 });
    if (!result.success) return;

    const best = findBestSupplierCandidate(vendorName, result.data || []);
    if (!best?.third_party_id) return;

    setForm((prev) => {
      if (prev.supplier_id) return prev;
      return {
        ...prev,
        supplier_id: best.third_party_id,
        supplier_label: best._displayName || best.trade_name || best.legal_name || 'Proveedor',
      };
    });
  };

  const pickInvoiceAsset = async (source = 'camera') => {
    if (source === 'file') {
      let DocumentPicker;
      try {
        DocumentPicker = require('expo-document-picker');
      } catch (_error) {
        return {
          success: false,
          error: 'Falta expo-document-picker para cargar archivos. Instala la dependencia y recompila la app.',
        };
      }

      const result = await DocumentPicker.getDocumentAsync({
        type: 'image/*',
        copyToCacheDirectory: true,
        multiple: false,
      });

      if (result?.canceled) return { success: false, canceled: true };
      const asset = result?.assets?.[0];
      if (!asset?.uri) {
        return { success: false, error: 'No se pudo obtener el archivo seleccionado.' };
      }
      if (asset?.mimeType && !String(asset.mimeType).toLowerCase().startsWith('image/')) {
        return { success: false, error: 'Por ahora solo se soportan archivos de imagen para la factura.' };
      }
      return { success: true, asset };
    }

    let ImagePicker;
    try {
      ImagePicker = require('expo-image-picker');
    } catch (_error) {
      return {
        success: false,
        error: 'Falta expo-image-picker. Instala la dependencia y recompila la app.',
      };
    }

    if (source === 'camera') {
      const permission = await ImagePicker.requestCameraPermissionsAsync();
      if (!permission?.granted && Platform.OS !== 'web') {
        return { success: false, error: 'Permiso de camara denegado.' };
      }
    } else {
      const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!permission?.granted && Platform.OS !== 'web') {
        return { success: false, error: 'Permiso de galeria denegado.' };
      }
    }

    const pickerOptions = {
      mediaTypes: ImagePicker.MediaTypeOptions?.Images ?? 'images',
      allowsEditing: false,
      quality: 1,
      base64: false,
      exif: false,
    };

    const capture = source === 'camera'
      ? await ImagePicker.launchCameraAsync(pickerOptions)
      : await ImagePicker.launchImageLibraryAsync(pickerOptions);

    if (capture?.canceled) return { success: false, canceled: true };
    const asset = capture?.assets?.[0];
    if (!asset?.uri) {
      return { success: false, error: 'No se pudo obtener la imagen seleccionada.' };
    }

    return { success: true, asset };
  };

  const createMissingCatalogItems = async (targetImportIds = []) => {
    if (!tenant?.tenant_id) {
      setFormError('Tenant invalido para crear articulos faltantes.');
      return;
    }

    const summary = invoiceImportSummary;
    const pendingIds = new Set(Array.isArray(targetImportIds) ? targetImportIds : []);
    const candidates = (summary?.unmatched || []).filter((item) => {
      if (!pendingIds.size) return true;
      return pendingIds.has(item.import_id);
    });

    if (!candidates.length) return;

    setCreatingMissingCatalog(true);
    setCreatingMissingIds(candidates.map((item) => item.import_id));
    setFormError('');

    try {
      const createdImportIds = [];
      const failedById = new Map();
      const createdLines = [];
      const createdVariants = [];

      for (const item of candidates) {
        const suggestionResult = await suggestCatalogProductFromInvoiceLine({
          tenantId: tenant.tenant_id,
          line: item,
        });

        const suggestion = suggestionResult?.data || {};
        const createResult = await createCatalogVariantForPurchase({
          tenantId: tenant.tenant_id,
          rawName: item.raw_name,
          productName: suggestion.product_name || item.raw_name,
          variantName: suggestion.variant_name || 'Predeterminada',
          suggestedSku: suggestion.suggested_sku || null,
          unitCost: resolveInvoiceUnitCost(item, null),
          requiresExpiration: suggestion.requires_expiration === true,
          inventoryBehavior: suggestion.inventory_behavior || 'RESELL',
          notes: suggestion.notes || `Creado desde factura: ${item.raw_name}`,
          isComponent: suggestion.is_component === true,
        });

        if (!createResult.success || !createResult.data?.variant_id) {
          failedById.set(item.import_id, createResult.error || suggestionResult?.error || 'No se pudo crear el articulo.');
          continue;
        }

        createdImportIds.push(item.import_id);
        createdVariants.push(createResult.data);
        createdLines.push(buildPurchaseLineFromInvoiceMatch({
          line: item,
          variant: createResult.data,
        }));
      }

      if (createdLines.length) {
        mergeImportedPurchaseLines(createdLines);
        setVariantOptions((prev) => {
          const merged = new Map((prev || []).map((item) => [item.variant_id, item]));
          createdVariants.forEach((item) => {
            if (item?.variant_id) merged.set(item.variant_id, item);
          });
          return Array.from(merged.values());
        });
      }

      setInvoiceImportSummary((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          createdCount: Number(prev.createdCount || 0) + createdImportIds.length,
          unmatched: (prev.unmatched || [])
            .filter((item) => !createdImportIds.includes(item.import_id))
            .map((item) => {
              if (!failedById.has(item.import_id)) return item;
              return { ...item, create_error: failedById.get(item.import_id) };
            }),
        };
      });

      if (failedById.size > 0) {
        const firstError = Array.from(failedById.values())[0];
        setFormError(firstError || 'Algunos articulos no se pudieron crear.');
      } else if (createdImportIds.length > 0) {
        Alert.alert('Articulos creados', `Se crearon y agregaron ${createdImportIds.length} articulo(s) faltante(s) a la compra.`);
      }

      if (createdImportIds.length > 0) {
        await loadVariants('');
      }
    } finally {
      setCreatingMissingCatalog(false);
      setCreatingMissingIds([]);
    }
  };

  const scanPurchaseInvoice = async (source = 'camera') => {
    if (offlineMode) {
      setFormError('La lectura de facturas con IA requiere conexion online.');
      return;
    }
    if (!tenant?.tenant_id) {
      setFormError('Tenant invalido para leer la factura.');
      return;
    }

    setFormError('');
    setInvoiceImportSummary(null);
    const picked = await pickInvoiceAsset(source);
    if (picked?.canceled) return;
    if (!picked?.success || !picked?.asset) {
      setFormError(picked?.error || 'No se pudo obtener la factura.');
      return;
    }

    setProcessingInvoice(true);
    setCreatingMissingCatalog(false);
    setCreatingMissingIds([]);

    try {
      const asset = picked.asset;
      let analysisResult = null;
      let ocrEngine = 'cloud_ocr_edge';
      let ocrText = '';

      const optimized = await buildOptimizedImageForOcr(asset);
      if (optimized.success) {
        const cloudResult = await analyzeInvoiceWithImage({
          tenantId: tenant.tenant_id,
          imageBase64: optimized.data.base64,
          mimeType: optimized.data.mimeType || asset.mimeType || 'image/jpeg',
        });
        if (cloudResult.success) {
          analysisResult = cloudResult;
          ocrText = String(cloudResult?.data?.ocr_text || '').trim();
        }
      }

      if (!analysisResult?.success) {
        const nativeStatus = await getNativeOcrStatus();
        if (nativeStatus?.available) {
          const enhancedResult = await buildEnhancedImageForNativeOcr(asset);
          const candidateUris = [asset.uri];
          if (enhancedResult?.success && enhancedResult?.data?.uri && enhancedResult.data.uri !== asset.uri) {
            candidateUris.push(enhancedResult.data.uri);
          }

          let bestNative = null;
          for (const uri of candidateUris) {
            const passResult = await extractTextWithNativeOcr({ imageUri: uri });
            if (!passResult?.success) continue;
            const candidateText = String(passResult?.data?.text || '').trim();
            if (!candidateText) continue;
            const candidateScore = scoreOcrTextForInvoice(candidateText);
            if (!bestNative || candidateScore > bestNative.score) {
              bestNative = {
                text: candidateText,
                score: candidateScore,
                engine: passResult?.data?.engine || 'native_ocr',
              };
            }
          }

          if (bestNative?.text) {
            const textResult = await analyzeInvoiceWithText({
              tenantId: tenant.tenant_id,
              ocrText: bestNative.text,
            });
            if (textResult.success) {
              analysisResult = textResult;
              ocrText = bestNative.text;
              ocrEngine = bestNative.engine || 'native_ocr';
            }
          }
        }
      }

      if (!analysisResult?.success) {
        setFormError(analysisResult?.error || 'No se pudo analizar la factura con IA.');
        return;
      }

      const importedLines = (analysisResult?.data?.line_items || [])
        .map((line, index) => createInvoiceImportLine(line, index))
        .filter((line) => line.raw_name);

      if (!importedLines.length) {
        setFormError('La factura no devolvio articulos utilizables.');
        return;
      }

      const candidatesResult = await listCatalogCandidatesForMatching(
        tenant.tenant_id,
        form.location_id || null,
        importedLines,
        {
          offlineMode: false,
          perTermLimit: 24,
          maxCandidates: 260,
          fallbackLimit: 1600,
        },
      );

      const matchResult = candidatesResult?.success
        ? matchInvoiceLinesToCatalog(importedLines, candidatesResult.data || [], { minTokenConfidence: 0.58 })
        : { matched: [], unmatched: importedLines };

      const matchedEntries = matchResult.matched || [];
      const unmatchedEntries = (matchResult.unmatched || []).map((line) => ({
        ...line,
        create_error: '',
      }));

      if (matchedEntries.length) {
        mergeImportedPurchaseLines(matchedEntries.map(buildPurchaseLineFromInvoiceMatch));
      }

      await maybeAutofillSupplierFromInvoice(analysisResult?.data?.invoice || {});

      setInvoiceImportSummary({
        source,
        invoice: analysisResult?.data?.invoice || {},
        matched: matchedEntries,
        unmatched: unmatchedEntries,
        ocrEngine,
        ocrTextPreview: ocrText.slice(0, 180),
        model: analysisResult?.data?.model || null,
        createdCount: 0,
      });

      if (unmatchedEntries.length > 0) {
        Alert.alert(
          'Articulos sin catalogo',
          `Se agregaron ${matchedEntries.length} coincidencia(s) y quedaron ${unmatchedEntries.length} articulo(s) sin match. ¿Quieres crearlos con ayuda de IA?`,
          [
            { text: 'Luego', style: 'cancel' },
            {
              text: 'Crear ahora',
              onPress: () => {
                void createMissingCatalogItems(unmatchedEntries.map((item) => item.import_id));
              },
            },
          ],
        );
      } else {
        Alert.alert('Factura procesada', `Se agregaron ${matchedEntries.length} articulo(s) desde la factura.`);
      }
    } finally {
      setProcessingInvoice(false);
    }
  };

  const buildFormattedLines = () => {
    const activeLines = (form.lines || []).filter(lineHasAnyContent);

    if (!activeLines.length) {
      return { success: false, error: 'Agrega al menos una linea de producto.' };
    }

    const formatted = [];

    for (let index = 0; index < activeLines.length; index += 1) {
      const line = activeLines[index];
      const lineNumber = index + 1;
      const qty = parseDecimalInput(line.qty);
      const unitCost = parseDecimalInput(line.unit_cost);
      const expirationDate = normalizeDateInput(line.expiration_date);

      if (!line.variant_id) {
        return { success: false, error: `Linea ${lineNumber}: selecciona un producto.` };
      }
      if (!Number.isFinite(qty) || qty <= 0) {
        return { success: false, error: `Linea ${lineNumber}: la cantidad debe ser mayor a 0.` };
      }
      if (!Number.isFinite(unitCost) || unitCost < 0) {
        return { success: false, error: `Linea ${lineNumber}: el costo unitario debe ser mayor o igual a 0.` };
      }
      if (line.requires_expiration && !expirationDate) {
        return { success: false, error: `Linea ${lineNumber}: este producto requiere fecha de vencimiento (YYYY-MM-DD).` };
      }
      if (line.expiration_date && !expirationDate) {
        return { success: false, error: `Linea ${lineNumber}: fecha de vencimiento invalida. Usa YYYY-MM-DD.` };
      }

      formatted.push({
        variant_id: line.variant_id,
        qty,
        unit_cost: unitCost,
        batch_number: String(line.batch_number || '').trim() || null,
        expiration_date: expirationDate,
        physical_location: String(line.physical_location || '').trim() || null,
      });
    }

    return { success: true, data: formatted };
  };

  const refreshListAfterSave = async () => {
    if (page !== 1) {
      await changePage(1);
      return;
    }
    await reload();
  };

  const submitForm = async (mode) => {
    if (offlineMode) {
      setFormError('Compras no permite registros en modo offline.');
      return;
    }
    if (!tenant?.tenant_id) {
      setFormError('Tenant invalido.');
      return;
    }
    if (!userProfile?.user_id) {
      setFormError('Usuario no identificado para registrar compras.');
      return;
    }
    if (!form.location_id) {
      setFormError('Selecciona la sede de la compra.');
      return;
    }

    const builtLines = buildFormattedLines();
    if (!builtLines.success) {
      setFormError(builtLines.error);
      return;
    }

    setFormError('');
    if (mode === 'purchase') setSavingPurchase(true);
    else setSavingDraft(true);

    try {
      const payload = {
        tenantId: tenant.tenant_id,
        locationId: form.location_id,
        supplierId: form.supplier_id || null,
        createdBy: userProfile.user_id,
        lines: builtLines.data,
        note: String(form.note || '').trim() || null,
      };

      const result =
        mode === 'purchase'
          ? await createPurchase(payload)
          : await createPurchaseOrder(payload);

      if (!result?.success) {
        throw new Error(result?.error || 'No fue posible guardar la compra.');
      }

      closeCreateModal();

      if (mode === 'purchase') {
        await refreshListAfterSave();
        Alert.alert('Compra registrada', 'La compra se guardo correctamente.');
      } else {
        Alert.alert(
          'Orden guardada',
          'La orden de compra quedo en borrador. La recepcion y el seguimiento avanzado siguen en web.',
        );
      }
    } catch (nextError) {
      setFormError(nextError.message);
    } finally {
      if (mode === 'purchase') setSavingPurchase(false);
      else setSavingDraft(false);
    }
  };

  const submitCreatePayable = async () => {
    if (!selectedPurchaseDetail?.purchase_id) {
      setPayableFormError('No se pudo identificar la compra.');
      return;
    }
    if (!tenant?.tenant_id || !userProfile?.user_id) {
      setPayableFormError('Necesitas un tenant y usuario validos para crear la cuenta por pagar.');
      return;
    }

    const normalizedDueDate = payableForm.due_date ? normalizeDateInput(payableForm.due_date) : null;
    if (payableForm.due_date && !normalizedDueDate) {
      setPayableFormError('La fecha de vencimiento debe usar formato YYYY-MM-DD.');
      return;
    }

    setPayableFormError('');
    setSavingPayable(true);
    try {
      const result = await createSupplierPayable({
        tenantId: tenant.tenant_id,
        purchaseId: selectedPurchaseDetail.purchase_id,
        createdBy: userProfile.user_id,
        dueDate: normalizedDueDate,
        invoiceNumber: String(payableForm.invoice_number || '').trim() || null,
        note: String(payableForm.note || '').trim() || null,
      });

      if (!result.success) {
        throw new Error(result.error || 'No fue posible crear la cuenta por pagar.');
      }

      setCreatePayableModalOpen(false);
      await refreshCurrentPurchaseBundle();
      Alert.alert('Cuenta por pagar creada', 'La cuenta por pagar ya quedo asociada a la compra.');
    } catch (nextError) {
      setPayableFormError(nextError.message);
    } finally {
      setSavingPayable(false);
    }
  };

  const submitSupplierPayment = async () => {
    if (!purchasePayable?.payable_id) {
      setPaymentFormError('No se encontro la cuenta por pagar.');
      return;
    }
    if (!tenant?.tenant_id || !userProfile?.user_id) {
      setPaymentFormError('Necesitas un tenant y usuario validos para registrar el abono.');
      return;
    }

    const amount = parseDecimalInput(paymentForm.amount);
    if (!Number.isFinite(amount) || amount <= 0) {
      setPaymentFormError('El monto del abono debe ser mayor a 0.');
      return;
    }
    if (amount > Number(purchasePayable.balance || 0)) {
      setPaymentFormError('El abono no puede superar el saldo pendiente.');
      return;
    }

    setPaymentFormError('');
    setSavingPayment(true);
    try {
      const result = await registerSupplierPayment({
        tenantId: tenant.tenant_id,
        payableId: purchasePayable.payable_id,
        amount,
        createdBy: userProfile.user_id,
        paymentMethod: String(paymentForm.payment_method || '').trim() || null,
        note: String(paymentForm.note || '').trim() || null,
      });

      if (!result.success) {
        throw new Error(result.error || 'No fue posible registrar el abono.');
      }

      setPaymentModalOpen(false);
      await refreshCurrentPurchaseBundle();
      Alert.alert('Abono registrado', 'El pago quedo registrado correctamente.');
    } catch (nextError) {
      setPaymentFormError(nextError.message);
    } finally {
      setSavingPayment(false);
    }
  };

  const renderPurchasePayableSection = () => {
    if (detailLoading) {
      return (
        <View style={styles.loadingBox}>
          <ActivityIndicator color={isLightTheme ? '#2563eb' : '#93c5fd'} />
          <Text style={[styles.loadingText, isLightTheme && styles.loadingTextLight]}>
            Cargando cuenta por pagar...
          </Text>
        </View>
      );
    }

    if (purchasePayable) {
      const statusMeta = getPayableStatusMeta(purchasePayable.status);
      return (
        <>
          <View style={styles.summaryGrid}>
            <View style={[styles.summaryItem, isLightTheme && styles.summaryItemLight]}>
              <Text style={[styles.summaryLabel, isLightTheme && styles.summaryLabelLight]}>Estado</Text>
              <View
                style={[
                  styles.statusPill,
                  {
                    borderColor: statusMeta.borderColor,
                    backgroundColor: statusMeta.backgroundColor,
                  },
                ]}
              >
                <Text style={[styles.statusPillText, { color: statusMeta.textColor }]}>{statusMeta.label}</Text>
              </View>
            </View>
            <View style={[styles.summaryItem, isLightTheme && styles.summaryItemLight]}>
              <Text style={[styles.summaryLabel, isLightTheme && styles.summaryLabelLight]}>Total factura</Text>
              <Text style={[styles.summaryValue, isLightTheme && styles.summaryValueLight]}>
                {money(purchasePayable.total_amount || 0)}
              </Text>
            </View>
            <View style={[styles.summaryItem, isLightTheme && styles.summaryItemLight]}>
              <Text style={[styles.summaryLabel, isLightTheme && styles.summaryLabelLight]}>Abonado</Text>
              <Text style={[styles.summaryValueSuccess, isLightTheme && styles.summaryValueSuccessLight]}>
                {money(purchasePayable.paid_amount || 0)}
              </Text>
            </View>
            <View style={[styles.summaryItem, isLightTheme && styles.summaryItemLight]}>
              <Text style={[styles.summaryLabel, isLightTheme && styles.summaryLabelLight]}>Saldo</Text>
              <Text style={[styles.summaryValueDanger, isLightTheme && styles.summaryValueDangerLight]}>
                {money(purchasePayable.balance || 0)}
              </Text>
            </View>
            <View style={[styles.summaryItem, isLightTheme && styles.summaryItemLight]}>
              <Text style={[styles.summaryLabel, isLightTheme && styles.summaryLabelLight]}>Factura proveedor</Text>
              <Text style={[styles.summaryValue, isLightTheme && styles.summaryValueLight]}>
                {purchasePayable.invoice_number || 'Sin numero'}
              </Text>
            </View>
            <View style={[styles.summaryItem, isLightTheme && styles.summaryItemLight]}>
              <Text style={[styles.summaryLabel, isLightTheme && styles.summaryLabelLight]}>Vencimiento</Text>
              <Text style={[styles.summaryValue, isLightTheme && styles.summaryValueLight]}>
                {purchasePayable.due_date ? formatDisplayDate(purchasePayable.due_date) : 'Sin fecha'}
              </Text>
            </View>
          </View>

          {purchasePayable.status !== 'PAID' && purchasePayable.status !== 'CANCELLED' ? (
            <Pressable
              style={[styles.smallActionBtn, styles.smallActionBtnOrange]}
              onPress={openPaymentModal}
            >
              <Text style={styles.smallActionBtnOrangeText}>Registrar abono</Text>
            </Pressable>
          ) : null}

          <Text style={[styles.sectionMiniTitle, isLightTheme && styles.sectionMiniTitleLight]}>
            Ultimos abonos
          </Text>
          {(purchasePayable.payments || []).length > 0 ? (
            (purchasePayable.payments || []).slice(0, 5).map((payment) => (
              <View key={payment.payable_payment_id} style={[styles.paymentCard, isLightTheme && styles.paymentCardLight]}>
                <View style={styles.paymentHeader}>
                  <Text style={[styles.paymentDate, isLightTheme && styles.paymentDateLight]}>
                    {formatDisplayDateTime(payment.created_at)}
                  </Text>
                  <Text style={[styles.paymentAmount, isLightTheme && styles.paymentAmountLight]}>
                    {money(payment.amount || 0)}
                  </Text>
                </View>
                <Text style={[styles.paymentMeta, isLightTheme && styles.paymentMetaLight]}>
                  {payment.payment_method || 'Sin metodo'}
                  {payment.note ? ` - ${payment.note}` : ''}
                </Text>
                {payment.created_by_user?.full_name ? (
                  <Text style={[styles.paymentMeta, isLightTheme && styles.paymentMetaLight]}>
                    {payment.created_by_user.full_name}
                  </Text>
                ) : null}
              </View>
            ))
          ) : (
            <View style={[styles.emptyBox, isLightTheme && styles.emptyBoxLight]}>
              <Text style={[styles.emptyText, isLightTheme && styles.emptyTextLight]}>
                Sin abonos registrados.
              </Text>
            </View>
          )}
        </>
      );
    }

    return (
      <>
        <View style={[styles.warningBox, isLightTheme && styles.warningBoxLight]}>
          <Text style={[styles.warningText, isLightTheme && styles.warningTextLight]}>
            Esta compra aun no tiene cuenta por pagar.
          </Text>
        </View>

        {selectedPurchaseDetail?.supplier ? (
          <Pressable
            style={[styles.smallActionBtn, styles.smallActionBtnOrange]}
            onPress={openCreatePayableModal}
          >
            <Text style={styles.smallActionBtnOrangeText}>Crear cuenta por pagar</Text>
          </Pressable>
        ) : (
          <Text style={[styles.infoText, isLightTheme && styles.infoTextLight]}>
            Esta compra no tiene proveedor asociado, por eso no se puede crear cuenta por pagar.
          </Text>
        )}
      </>
    );
  };

  return (
    <View style={[styles.container, isLightTheme && styles.containerLight]}>
      <View style={[styles.noticeBox, isLightTheme && styles.noticeBoxLight]}>
        <Text style={[styles.noticeText, isLightTheme && styles.noticeTextLight]}>
          Ya puedes registrar compras, guardar ordenes de compra y revisar el detalle de cada compra desde mobile. En offline se mantiene solo consulta con cache local; recepcion avanzada y seguimiento detallado siguen en web.
        </Text>
      </View>

      <View style={styles.filtersBlock}>
        <SearchableSelectField
          title="Sede"
          themeMode={resolvedThemeMode}
          valueLabel="Todas las sedes"
          clearLabel="Todas las sedes"
          placeholder="Todas las sedes"
          searchPlaceholder="Buscar sede..."
          options={locationSelectOptions}
          selectedKey={filters?.location_id || ''}
          onSelect={(nextValue) => updateFilters({ location_id: nextValue || '' })}
        />
      </View>

      <PaginatedList
        themeMode={resolvedThemeMode}
        title="Compras"
        loading={loading}
        refreshing={refreshing}
        onRefresh={reload}
        error={error}
        items={items}
        emptyText="No hay compras para este filtro."
        page={page}
        totalPages={totalPages}
        onPrev={() => changePage(page - 1)}
        onNext={() => changePage(page + 1)}
        footerMeta={
          cacheInfo?.source === 'cache' && cacheInfo?.cachedAt
            ? `Cache offline: ${new Date(cacheInfo.cachedAt).toLocaleString()}`
            : null
        }
        bottomInset={androidBottomInset}
        contentContainerStyle={{ paddingBottom: 18 }}
        headerRight={(
          <ListHeaderActionButton
            themeMode={resolvedThemeMode}
            label="+ Nueva Compra"
            onPress={openCreateModal}
            disabled={offlineMode || !tenant?.tenant_id || !userProfile?.user_id}
          />
        )}
        renderItem={(item) => (
          <View key={item.purchase_id} style={[styles.card, isLightTheme && styles.cardLight]}>
            <Text style={[styles.title, isLightTheme && styles.titleLight]}>
              {item.items_summary || 'Compra'}
            </Text>
            <Text style={[styles.meta, isLightTheme && styles.metaLight]}>
              {item.location_name || 'Sin sede'} - {new Date(item.purchased_at).toLocaleString()}
            </Text>
            <Text style={[styles.meta, isLightTheme && styles.metaLight]}>
              {item.supplier_name || 'Sin proveedor'}
              {item.supplier_document ? ` (${item.supplier_document})` : ''}
            </Text>
            {item.purchased_by_name ? (
              <Text style={[styles.meta, isLightTheme && styles.metaLight]}>
                Registro: {item.purchased_by_name}
              </Text>
            ) : null}
            <View style={styles.badgesRow}>
              <View style={[styles.badge, isLightTheme && styles.badgeLight, { borderColor: '#235ea9' }]}>
                <Text style={[styles.badgeText, isLightTheme && styles.badgeTextLight]}>
                  Items {Number(item.items_count || 0).toLocaleString('es-CO')}
                </Text>
              </View>
              <View style={[styles.badge, isLightTheme && styles.badgeLight, { borderColor: '#f59e0b' }]}>
                <Text style={[styles.badgeText, isLightTheme && styles.badgeTextLight]}>
                  Cant. {Number(item.qty_total || 0).toLocaleString('es-CO')}
                </Text>
              </View>
              <View style={[styles.badge, isLightTheme && styles.badgeLight, { borderColor: '#16a34a' }]}>
                <Text style={[styles.badgeText, isLightTheme && styles.badgeTextLight]}>
                  Total {money(item.total || 0)}
                </Text>
              </View>
            </View>
            {item.note ? (
              <Text style={[styles.note, isLightTheme && styles.noteLight]}>{item.note}</Text>
            ) : null}
            <View style={styles.cardActions}>
              <Pressable
                style={[styles.cardActionBtn, isLightTheme && styles.cardActionBtnLight]}
                onPress={() => openPurchaseDetail(item)}
              >
                <Text style={[styles.cardActionBtnText, isLightTheme && styles.cardActionBtnTextLight]}>
                  Ver detalle
                </Text>
              </Pressable>
            </View>
          </View>
        )}
      />

      <BottomSheetModal
        visible={createModalOpen}
        onClose={closeCreateModal}
        themeMode={resolvedThemeMode}
        maxHeight="94%"
        footer={(
          <View style={[styles.modalFooter, { marginBottom: Math.max(0, androidBottomInset - 4) }]}>
            <Pressable
              style={[styles.modalFooterBtn, styles.ghostBtn, isLightTheme && styles.ghostBtnLight]}
              onPress={closeCreateModal}
              disabled={savingPurchase || savingDraft}
            >
              <Text style={[styles.ghostBtnText, isLightTheme && styles.ghostBtnTextLight]}>Cancelar</Text>
            </Pressable>
            <Pressable
              style={[
                styles.modalFooterBtn,
                styles.secondaryBtn,
                (savingPurchase || savingDraft) && styles.actionDisabled,
              ]}
              onPress={() => submitForm('draft')}
              disabled={savingPurchase || savingDraft}
            >
              <Text style={styles.secondaryBtnText}>
                {savingDraft ? 'Guardando OC...' : 'Guardar como OC'}
              </Text>
            </Pressable>
            <Pressable
              style={[
                styles.modalFooterBtn,
                styles.primaryBtn,
                (savingPurchase || savingDraft) && styles.actionDisabled,
              ]}
              onPress={() => submitForm('purchase')}
              disabled={savingPurchase || savingDraft}
            >
              <Text style={styles.primaryBtnText}>
                {savingPurchase ? 'Guardando compra...' : 'Guardar compra'}
              </Text>
            </Pressable>
          </View>
        )}
      >
        <Text style={[styles.modalTitle, isLightTheme && styles.modalTitleLight]}>Nueva Compra</Text>
        <Text style={[styles.modalSubtitle, isLightTheme && styles.modalSubtitleLight]}>
          Registra el ingreso de inventario o deja la compra como orden en borrador.
        </Text>

        {formError ? (
          <View style={[styles.formErrorBox, isLightTheme && styles.formErrorBoxLight]}>
            <Text style={styles.formErrorText}>{formError}</Text>
          </View>
        ) : null}

        <SearchableSelectField
          title="Sede"
          themeMode={resolvedThemeMode}
          valueLabel={
            locationSelectOptions.find((item) => String(item.key) === String(form.location_id))?.label ||
            'Seleccionar sede'
          }
          clearLabel="Sin sede"
          placeholder="Seleccionar sede"
          searchPlaceholder="Buscar sede..."
          options={locationSelectOptions}
          selectedKey={form.location_id}
          allowClear={false}
          onSelect={(nextValue) => setForm((prev) => ({ ...prev, location_id: nextValue || '' }))}
        />

        <SearchableSelectField
          title="Proveedor"
          themeMode={resolvedThemeMode}
          valueLabel={form.supplier_label || 'Proveedor opcional'}
          clearLabel="Sin proveedor"
          placeholder="Proveedor opcional"
          searchPlaceholder="Buscar proveedor..."
          options={supplierSelectOptions}
          selectedKey={form.supplier_id}
          onSelect={handleSelectSupplier}
          onSearchQueryChange={loadSuppliers}
          loadingOptions={suppliersLoading}
          emptyText="No hay proveedores para esa busqueda."
        />

        <Text style={[styles.fieldLabel, isLightTheme && styles.fieldLabelLight]}>Nota</Text>
        <TextInput
          style={[styles.input, styles.noteInput, isLightTheme && styles.inputLight]}
          value={form.note}
          onChangeText={(value) => setForm((prev) => ({ ...prev, note: value }))}
          placeholder="Nota opcional"
          placeholderTextColor="#64748b"
          multiline
        />

        <View style={[styles.invoiceAiCard, isLightTheme && styles.invoiceAiCardLight]}>
          <View style={styles.invoiceAiHeader}>
            <View style={styles.invoiceAiHeaderText}>
              <Text style={[styles.invoiceAiTitle, isLightTheme && styles.invoiceAiTitleLight]}>
                Factura con IA
              </Text>
              <Text style={[styles.invoiceAiMeta, isLightTheme && styles.invoiceAiMetaLight]}>
                Toma una foto o sube una imagen para extraer artículos, costos y sugerir creación de faltantes.
              </Text>
            </View>
            {processingInvoice ? (
              <ActivityIndicator color={isLightTheme ? '#2563eb' : '#93c5fd'} />
            ) : null}
          </View>

          <View style={styles.invoiceAiActions}>
            <Pressable
              style={[styles.invoiceAiActionBtn, isLightTheme && styles.invoiceAiActionBtnLight, processingInvoice && styles.actionDisabled]}
              onPress={() => scanPurchaseInvoice('camera')}
              disabled={processingInvoice || savingPurchase || savingDraft}
            >
              <Ionicons name="camera-outline" size={16} color={isLightTheme ? '#1d4ed8' : '#dbeafe'} />
              <Text style={[styles.invoiceAiActionText, isLightTheme && styles.invoiceAiActionTextLight]}>Foto</Text>
            </Pressable>
            <Pressable
              style={[styles.invoiceAiActionBtn, isLightTheme && styles.invoiceAiActionBtnLight, processingInvoice && styles.actionDisabled]}
              onPress={() => scanPurchaseInvoice('library')}
              disabled={processingInvoice || savingPurchase || savingDraft}
            >
              <Ionicons name="images-outline" size={16} color={isLightTheme ? '#1d4ed8' : '#dbeafe'} />
              <Text style={[styles.invoiceAiActionText, isLightTheme && styles.invoiceAiActionTextLight]}>Galeria</Text>
            </Pressable>
            <Pressable
              style={[styles.invoiceAiActionBtn, isLightTheme && styles.invoiceAiActionBtnLight, processingInvoice && styles.actionDisabled]}
              onPress={() => scanPurchaseInvoice('file')}
              disabled={processingInvoice || savingPurchase || savingDraft}
            >
              <Ionicons name="document-outline" size={16} color={isLightTheme ? '#1d4ed8' : '#dbeafe'} />
              <Text style={[styles.invoiceAiActionText, isLightTheme && styles.invoiceAiActionTextLight]}>Archivo</Text>
            </Pressable>
          </View>

          {invoiceImportSummary ? (
            <View style={[styles.invoiceAiSummary, isLightTheme && styles.invoiceAiSummaryLight]}>
              <Text style={[styles.invoiceAiSummaryTitle, isLightTheme && styles.invoiceAiSummaryTitleLight]}>
                Resultado factura
              </Text>
              <Text style={[styles.invoiceAiSummaryLine, isLightTheme && styles.invoiceAiSummaryLineLight]}>
                Fuente: {invoiceImportSummary.source === 'camera' ? 'foto' : invoiceImportSummary.source === 'library' ? 'galeria' : 'archivo'}
              </Text>
              {invoiceImportSummary.invoice?.vendor_name ? (
                <Text style={[styles.invoiceAiSummaryLine, isLightTheme && styles.invoiceAiSummaryLineLight]}>
                  Proveedor detectado: {invoiceImportSummary.invoice.vendor_name}
                </Text>
              ) : null}
              {invoiceImportSummary.invoice?.invoice_number ? (
                <Text style={[styles.invoiceAiSummaryLine, isLightTheme && styles.invoiceAiSummaryLineLight]}>
                  Factura: {invoiceImportSummary.invoice.invoice_number}
                </Text>
              ) : null}
              {invoiceImportSummary.invoice?.date ? (
                <Text style={[styles.invoiceAiSummaryLine, isLightTheme && styles.invoiceAiSummaryLineLight]}>
                  Fecha: {invoiceImportSummary.invoice.date}
                </Text>
              ) : null}
              {invoiceImportSummary.invoice?.total != null ? (
                <Text style={[styles.invoiceAiSummaryLine, isLightTheme && styles.invoiceAiSummaryLineLight]}>
                  Total detectado: {money(invoiceImportSummary.invoice.total)}
                </Text>
              ) : null}
              <View style={styles.invoiceAiPills}>
                <View style={[styles.invoiceAiPill, styles.invoiceAiPillSuccess]}>
                  <Text style={styles.invoiceAiPillText}>
                    Match {Number(invoiceImportSummary.matched?.length || 0)}
                  </Text>
                </View>
                <View style={[styles.invoiceAiPill, styles.invoiceAiPillWarn]}>
                  <Text style={styles.invoiceAiPillText}>
                    Faltantes {Number(invoiceImportSummary.unmatched?.length || 0)}
                  </Text>
                </View>
                {Number(invoiceImportSummary.createdCount || 0) > 0 ? (
                  <View style={[styles.invoiceAiPill, styles.invoiceAiPillInfo]}>
                    <Text style={styles.invoiceAiPillText}>
                      Creados {Number(invoiceImportSummary.createdCount || 0)}
                    </Text>
                  </View>
                ) : null}
              </View>
              {invoiceImportSummary.model ? (
                <Text style={[styles.invoiceAiSummaryLine, isLightTheme && styles.invoiceAiSummaryLineLight]}>
                  Modelo OCR/parse: {invoiceImportSummary.model}
                </Text>
              ) : null}
              {invoiceImportSummary.ocrEngine ? (
                <Text style={[styles.invoiceAiSummaryLine, isLightTheme && styles.invoiceAiSummaryLineLight]}>
                  OCR: {invoiceImportSummary.ocrEngine}
                </Text>
              ) : null}
              {invoiceImportSummary.ocrTextPreview ? (
                <Text style={[styles.invoiceAiSummaryPreview, isLightTheme && styles.invoiceAiSummaryPreviewLight]}>
                  Preview OCR: {invoiceImportSummary.ocrTextPreview}
                </Text>
              ) : null}
            </View>
          ) : null}

          {(invoiceImportSummary?.unmatched || []).length > 0 ? (
            <View style={styles.invoiceAiMissingWrap}>
              <View style={styles.invoiceAiMissingHeader}>
                <Text style={[styles.invoiceAiMissingTitle, isLightTheme && styles.invoiceAiMissingTitleLight]}>
                  Artículos sin catálogo
                </Text>
                <Pressable
                  style={[
                    styles.invoiceAiCreateAllBtn,
                    isLightTheme && styles.invoiceAiCreateAllBtnLight,
                    creatingMissingCatalog && styles.actionDisabled,
                  ]}
                  onPress={() => createMissingCatalogItems()}
                  disabled={creatingMissingCatalog || processingInvoice}
                >
                  <Text style={[styles.invoiceAiCreateAllText, isLightTheme && styles.invoiceAiCreateAllTextLight]}>
                    {creatingMissingCatalog ? 'Creando...' : 'Crear todos'}
                  </Text>
                </Pressable>
              </View>

              {(invoiceImportSummary.unmatched || []).map((item) => {
                const busy = creatingMissingIds.includes(item.import_id);
                const unitCost = resolveInvoiceUnitCost(item, null);
                return (
                  <View key={item.import_id} style={[styles.invoiceAiMissingCard, isLightTheme && styles.invoiceAiMissingCardLight]}>
                    <Text style={[styles.invoiceAiMissingName, isLightTheme && styles.invoiceAiMissingNameLight]}>
                      {item.raw_name}
                    </Text>
                    <Text style={[styles.invoiceAiMissingMeta, isLightTheme && styles.invoiceAiMissingMetaLight]}>
                      Cant. {Number(item.quantity || 0).toLocaleString('es-CO')} · Costo {money(unitCost)}
                    </Text>
                    {item.create_error ? (
                      <Text style={styles.invoiceAiMissingError}>{item.create_error}</Text>
                    ) : null}
                    <Pressable
                      style={[
                        styles.invoiceAiCreateOneBtn,
                        isLightTheme && styles.invoiceAiCreateOneBtnLight,
                        busy && styles.actionDisabled,
                      ]}
                      onPress={() => createMissingCatalogItems([item.import_id])}
                      disabled={busy || creatingMissingCatalog || processingInvoice}
                    >
                      <Text style={[styles.invoiceAiCreateOneText, isLightTheme && styles.invoiceAiCreateOneTextLight]}>
                        {busy ? 'Creando...' : 'Crear y agregar'}
                      </Text>
                    </Pressable>
                  </View>
                );
              })}
            </View>
          ) : null}
        </View>

        <View style={styles.sectionHeader}>
          <Text style={[styles.sectionTitle, isLightTheme && styles.sectionTitleLight]}>Productos</Text>
          <Pressable
            style={[styles.addLineBtn, isLightTheme && styles.addLineBtnLight]}
            onPress={addLine}
            disabled={savingPurchase || savingDraft}
          >
            <Text style={[styles.addLineBtnText, isLightTheme && styles.addLineBtnTextLight]}>+ Agregar</Text>
          </Pressable>
        </View>

        {(form.lines || []).map((line, index) => (
          <View key={line.line_id} style={[styles.lineCard, isLightTheme && styles.lineCardLight]}>
            <View style={styles.lineHeader}>
              <Text style={[styles.lineTitle, isLightTheme && styles.lineTitleLight]}>Linea {index + 1}</Text>
              {(form.lines || []).length > 1 ? (
                <Pressable
                  style={[styles.removeBtn, isLightTheme && styles.removeBtnLight]}
                  onPress={() => removeLine(line.line_id)}
                  disabled={savingPurchase || savingDraft}
                >
                  <Text style={[styles.removeBtnText, isLightTheme && styles.removeBtnTextLight]}>Eliminar</Text>
                </Pressable>
              ) : null}
            </View>

            <SearchableSelectField
              title="Producto"
              themeMode={resolvedThemeMode}
              valueLabel={line.variant_label || 'Seleccionar producto'}
              clearLabel="Sin producto"
              placeholder="Seleccionar producto"
              searchPlaceholder="Buscar producto o SKU..."
              options={variantSelectOptions}
              selectedKey={line.variant_id}
              onSelect={(nextValue) => handleSelectVariant(line.line_id, nextValue || '')}
              onSearchQueryChange={loadVariants}
              loadingOptions={variantsLoading}
              emptyText="No hay productos para esa busqueda."
            />

            <View style={styles.inlineFields}>
              <View style={styles.inlineField}>
                <Text style={[styles.fieldLabel, isLightTheme && styles.fieldLabelLight]}>Cantidad</Text>
                <TextInput
                  style={[styles.input, isLightTheme && styles.inputLight]}
                  value={line.qty}
                  onChangeText={(value) => updateLine(line.line_id, { qty: value })}
                  placeholder="1"
                  placeholderTextColor="#64748b"
                  keyboardType="numeric"
                />
              </View>

              <View style={styles.inlineField}>
                <Text style={[styles.fieldLabel, isLightTheme && styles.fieldLabelLight]}>Costo unitario</Text>
                <TextInput
                  style={[styles.input, isLightTheme && styles.inputLight]}
                  value={line.unit_cost}
                  onChangeText={(value) => updateLine(line.line_id, { unit_cost: value })}
                  placeholder="0"
                  placeholderTextColor="#64748b"
                  keyboardType="numeric"
                />
              </View>
            </View>

            {line.requires_expiration ? (
              <View style={[styles.expirationBox, isLightTheme && styles.expirationBoxLight]}>
                <Text style={[styles.expirationTitle, isLightTheme && styles.expirationTitleLight]}>
                  Este producto maneja lote y vencimiento
                </Text>

                <View style={styles.batchRow}>
                  <View style={styles.batchInputWrap}>
                    <Text style={[styles.fieldLabel, isLightTheme && styles.fieldLabelLight]}>Lote</Text>
                    <TextInput
                      style={[styles.input, isLightTheme && styles.inputLight]}
                      value={line.batch_number}
                      onChangeText={(value) => updateLine(line.line_id, { batch_number: value })}
                      placeholder="Auto si lo dejas vacio"
                      placeholderTextColor="#64748b"
                    />
                  </View>

                  <Pressable
                    style={[
                      styles.generateBtn,
                      isLightTheme && styles.generateBtnLight,
                      generatingLineId === line.line_id && styles.actionDisabled,
                    ]}
                    onPress={() => generateBatchForLine(line)}
                    disabled={generatingLineId === line.line_id || savingPurchase || savingDraft}
                  >
                    <Text style={[styles.generateBtnText, isLightTheme && styles.generateBtnTextLight]}>
                      {generatingLineId === line.line_id ? 'Generando...' : 'Generar'}
                    </Text>
                  </Pressable>
                </View>

                <Text style={[styles.fieldLabel, isLightTheme && styles.fieldLabelLight]}>Vencimiento</Text>
                <TextInput
                  style={[styles.input, isLightTheme && styles.inputLight]}
                  value={line.expiration_date}
                  onChangeText={(value) => updateLine(line.line_id, { expiration_date: value })}
                  placeholder="YYYY-MM-DD"
                  placeholderTextColor="#64748b"
                  autoCapitalize="none"
                />

                <Text style={[styles.fieldLabel, isLightTheme && styles.fieldLabelLight]}>Ubicacion fisica</Text>
                <TextInput
                  style={[styles.input, isLightTheme && styles.inputLight]}
                  value={line.physical_location}
                  onChangeText={(value) => updateLine(line.line_id, { physical_location: value })}
                  placeholder="Estante, cuarto frio, bodega..."
                  placeholderTextColor="#64748b"
                />
              </View>
            ) : null}
          </View>
        ))}

        <View style={[styles.totalBox, isLightTheme && styles.totalBoxLight]}>
          <Text style={[styles.totalLabel, isLightTheme && styles.totalLabelLight]}>Total estimado</Text>
          <Text style={[styles.totalValue, isLightTheme && styles.totalValueLight]}>{money(estimatedTotal)}</Text>
        </View>
      </BottomSheetModal>

      <BottomSheetModal
        visible={detailModalOpen}
        onClose={closeDetailModal}
        themeMode={resolvedThemeMode}
        maxHeight="94%"
        footer={(
          <Pressable
            style={[styles.modalCloseBtn, isLightTheme && styles.modalCloseBtnLight]}
            onPress={closeDetailModal}
          >
            <Text style={[styles.modalCloseBtnText, isLightTheme && styles.modalCloseBtnTextLight]}>
              Cerrar
            </Text>
          </Pressable>
        )}
      >
        <Text style={[styles.modalTitle, isLightTheme && styles.modalTitleLight]}>Detalle de Compra</Text>

        {detailLoading ? (
          <View style={styles.loadingBox}>
            <ActivityIndicator color={isLightTheme ? '#2563eb' : '#93c5fd'} />
            <Text style={[styles.loadingText, isLightTheme && styles.loadingTextLight]}>
              Cargando detalle de la compra...
            </Text>
          </View>
        ) : null}

        {!detailLoading && detailError ? (
          <View style={[styles.formErrorBox, isLightTheme && styles.formErrorBoxLight]}>
            <Text style={styles.formErrorText}>{detailError}</Text>
          </View>
        ) : null}

        {!detailLoading && !detailError && selectedPurchaseDetail ? (
          <>
            <View style={[styles.detailPanel, isLightTheme && styles.detailPanelLight]}>
              <View style={styles.summaryGrid}>
                <View style={[styles.summaryItem, isLightTheme && styles.summaryItemLight]}>
                  <Text style={[styles.summaryLabel, isLightTheme && styles.summaryLabelLight]}>Sede</Text>
                  <Text style={[styles.summaryValue, isLightTheme && styles.summaryValueLight]}>
                    {selectedPurchaseDetail.location_name || 'Sin sede'}
                  </Text>
                </View>
                <View style={[styles.summaryItem, isLightTheme && styles.summaryItemLight]}>
                  <Text style={[styles.summaryLabel, isLightTheme && styles.summaryLabelLight]}>Proveedor</Text>
                  <Text style={[styles.summaryValue, isLightTheme && styles.summaryValueLight]}>
                    {selectedPurchaseDetail.supplier?.trade_name ||
                      selectedPurchaseDetail.supplier?.legal_name ||
                      'Sin proveedor'}
                    {selectedPurchaseDetail.supplier?.document_number
                      ? ` (${selectedPurchaseDetail.supplier.document_number})`
                      : ''}
                  </Text>
                </View>
                <View style={[styles.summaryItem, isLightTheme && styles.summaryItemLight]}>
                  <Text style={[styles.summaryLabel, isLightTheme && styles.summaryLabelLight]}>Fecha</Text>
                  <Text style={[styles.summaryValue, isLightTheme && styles.summaryValueLight]}>
                    {formatDisplayDateTime(selectedPurchaseDetail.created_at)}
                  </Text>
                </View>
                <View style={[styles.summaryItem, isLightTheme && styles.summaryItemLight]}>
                  <Text style={[styles.summaryLabel, isLightTheme && styles.summaryLabelLight]}>Registrado por</Text>
                  <Text style={[styles.summaryValue, isLightTheme && styles.summaryValueLight]}>
                    {selectedPurchaseDetail.created_by_name || '-'}
                  </Text>
                </View>
                <View style={[styles.summaryItem, isLightTheme && styles.summaryItemLight]}>
                  <Text style={[styles.summaryLabel, isLightTheme && styles.summaryLabelLight]}>Productos</Text>
                  <Text style={[styles.summaryValue, isLightTheme && styles.summaryValueLight]}>
                    {selectedPurchaseDetail.items_count || 0}
                  </Text>
                </View>
              </View>

              {selectedPurchaseDetail.note ? (
                <Text style={[styles.detailNote, isLightTheme && styles.detailNoteLight]}>
                  {selectedPurchaseDetail.note}
                </Text>
              ) : null}
            </View>

            <View style={[styles.detailPanel, isLightTheme && styles.detailPanelLight]}>
              <Text style={[styles.sectionTitle, isLightTheme && styles.sectionTitleLight]}>
                Cuenta por pagar
              </Text>
              {payableError ? (
                <View style={[styles.warningBox, isLightTheme && styles.warningBoxLight]}>
                  <Text style={[styles.warningText, isLightTheme && styles.warningTextLight]}>{payableError}</Text>
                </View>
              ) : null}
              {renderPurchasePayableSection()}
            </View>

            <Text style={[styles.sectionTitle, styles.sectionSpacing, isLightTheme && styles.sectionTitleLight]}>
              Productos Comprados
            </Text>
            {(selectedPurchaseDetail.lines || []).map((line) => (
              <View key={line.line_id} style={[styles.lineDetailCard, isLightTheme && styles.lineDetailCardLight]}>
                <Text style={[styles.lineDetailTitle, isLightTheme && styles.lineDetailTitleLight]}>
                  {line.product_name || 'Producto'}
                </Text>
                <Text style={[styles.meta, isLightTheme && styles.metaLight]}>
                  {line.variant_name || 'Sin variante'} - SKU: {line.sku || '-'}
                </Text>
                <View style={styles.summaryGrid}>
                  <View style={[styles.summaryItem, isLightTheme && styles.summaryItemLight]}>
                    <Text style={[styles.summaryLabel, isLightTheme && styles.summaryLabelLight]}>Cantidad</Text>
                    <Text style={[styles.summaryValue, isLightTheme && styles.summaryValueLight]}>
                      {Number(line.quantity || 0).toLocaleString('es-CO')}
                    </Text>
                    <Text style={[styles.summaryHint, isLightTheme && styles.summaryHintLight]}>
                      Dev: {Number(line.returned_qty || 0).toLocaleString('es-CO')}
                    </Text>
                  </View>
                  <View style={[styles.summaryItem, isLightTheme && styles.summaryItemLight]}>
                    <Text style={[styles.summaryLabel, isLightTheme && styles.summaryLabelLight]}>Costo unit.</Text>
                    <Text style={[styles.summaryValue, isLightTheme && styles.summaryValueLight]}>
                      {money(line.unit_cost || 0)}
                    </Text>
                  </View>
                  <View style={[styles.summaryItem, isLightTheme && styles.summaryItemLight]}>
                    <Text style={[styles.summaryLabel, isLightTheme && styles.summaryLabelLight]}>Subtotal</Text>
                    <Text style={[styles.summaryValuePrimary, isLightTheme && styles.summaryValuePrimaryLight]}>
                      {money(line.line_total || 0)}
                    </Text>
                  </View>
                </View>
              </View>
            ))}

            <View style={[styles.totalBox, isLightTheme && styles.totalBoxLight]}>
              <Text style={[styles.totalLabel, isLightTheme && styles.totalLabelLight]}>Total compra</Text>
              <Text style={[styles.totalValue, isLightTheme && styles.totalValueLight]}>
                {money(selectedPurchaseDetail.total || 0)}
              </Text>
            </View>
          </>
        ) : null}
      </BottomSheetModal>

      <BottomSheetModal
        visible={createPayableModalOpen}
        onClose={() => setCreatePayableModalOpen(false)}
        themeMode={resolvedThemeMode}
        maxHeight="74%"
        footer={(
          <View style={[styles.modalFooter, { marginBottom: Math.max(0, androidBottomInset - 4) }]}>
            <Pressable
              style={[styles.modalFooterBtn, styles.ghostBtn, isLightTheme && styles.ghostBtnLight]}
              onPress={() => setCreatePayableModalOpen(false)}
              disabled={savingPayable}
            >
              <Text style={[styles.ghostBtnText, isLightTheme && styles.ghostBtnTextLight]}>Cancelar</Text>
            </Pressable>
            <Pressable
              style={[
                styles.modalFooterBtn,
                styles.primaryBtn,
                savingPayable && styles.actionDisabled,
              ]}
              onPress={submitCreatePayable}
              disabled={savingPayable}
            >
              <Text style={styles.primaryBtnText}>
                {savingPayable ? 'Creando...' : 'Crear cuenta por pagar'}
              </Text>
            </Pressable>
          </View>
        )}
      >
        <Text style={[styles.modalTitle, isLightTheme && styles.modalTitleLight]}>Crear Cuenta por Pagar</Text>

        {payableFormError ? (
          <View style={[styles.formErrorBox, isLightTheme && styles.formErrorBoxLight]}>
            <Text style={styles.formErrorText}>{payableFormError}</Text>
          </View>
        ) : null}

        <Text style={[styles.fieldLabel, isLightTheme && styles.fieldLabelLight]}>Factura proveedor</Text>
        <TextInput
          style={[styles.input, isLightTheme && styles.inputLight]}
          value={payableForm.invoice_number}
          onChangeText={(value) => setPayableForm((prev) => ({ ...prev, invoice_number: value }))}
          placeholder="Numero de factura"
          placeholderTextColor="#64748b"
        />

        <Text style={[styles.fieldLabel, isLightTheme && styles.fieldLabelLight]}>Vencimiento</Text>
        <TextInput
          style={[styles.input, isLightTheme && styles.inputLight]}
          value={payableForm.due_date}
          onChangeText={(value) => setPayableForm((prev) => ({ ...prev, due_date: value }))}
          placeholder="YYYY-MM-DD"
          placeholderTextColor="#64748b"
          autoCapitalize="none"
        />

        <Text style={[styles.fieldLabel, isLightTheme && styles.fieldLabelLight]}>Nota</Text>
        <TextInput
          style={[styles.input, styles.noteInput, isLightTheme && styles.inputLight]}
          value={payableForm.note}
          onChangeText={(value) => setPayableForm((prev) => ({ ...prev, note: value }))}
          placeholder="Nota opcional"
          placeholderTextColor="#64748b"
          multiline
        />
      </BottomSheetModal>

      <BottomSheetModal
        visible={paymentModalOpen}
        onClose={() => setPaymentModalOpen(false)}
        themeMode={resolvedThemeMode}
        maxHeight="74%"
        footer={(
          <View style={[styles.modalFooter, { marginBottom: Math.max(0, androidBottomInset - 4) }]}>
            <Pressable
              style={[styles.modalFooterBtn, styles.ghostBtn, isLightTheme && styles.ghostBtnLight]}
              onPress={() => setPaymentModalOpen(false)}
              disabled={savingPayment}
            >
              <Text style={[styles.ghostBtnText, isLightTheme && styles.ghostBtnTextLight]}>Cancelar</Text>
            </Pressable>
            <Pressable
              style={[
                styles.modalFooterBtn,
                styles.primaryBtn,
                savingPayment && styles.actionDisabled,
              ]}
              onPress={submitSupplierPayment}
              disabled={savingPayment}
            >
              <Text style={styles.primaryBtnText}>
                {savingPayment ? 'Registrando...' : 'Registrar abono'}
              </Text>
            </Pressable>
          </View>
        )}
      >
        <Text style={[styles.modalTitle, isLightTheme && styles.modalTitleLight]}>Registrar Abono</Text>
        {purchasePayable ? (
          <Text style={[styles.modalSubtitle, isLightTheme && styles.modalSubtitleLight]}>
            Saldo actual: {money(purchasePayable.balance || 0)}
          </Text>
        ) : null}

        {paymentFormError ? (
          <View style={[styles.formErrorBox, isLightTheme && styles.formErrorBoxLight]}>
            <Text style={styles.formErrorText}>{paymentFormError}</Text>
          </View>
        ) : null}

        <Text style={[styles.fieldLabel, isLightTheme && styles.fieldLabelLight]}>Monto</Text>
        <TextInput
          style={[styles.input, isLightTheme && styles.inputLight]}
          value={paymentForm.amount}
          onChangeText={(value) => setPaymentForm((prev) => ({ ...prev, amount: value }))}
          placeholder="0"
          placeholderTextColor="#64748b"
          keyboardType="numeric"
        />

        <Text style={[styles.fieldLabel, isLightTheme && styles.fieldLabelLight]}>Metodo</Text>
        <TextInput
          style={[styles.input, isLightTheme && styles.inputLight]}
          value={paymentForm.payment_method}
          onChangeText={(value) => setPaymentForm((prev) => ({ ...prev, payment_method: value }))}
          placeholder="Efectivo, transferencia, etc."
          placeholderTextColor="#64748b"
        />

        <Text style={[styles.fieldLabel, isLightTheme && styles.fieldLabelLight]}>Nota</Text>
        <TextInput
          style={[styles.input, styles.noteInput, isLightTheme && styles.inputLight]}
          value={paymentForm.note}
          onChangeText={(value) => setPaymentForm((prev) => ({ ...prev, note: value }))}
          placeholder="Nota opcional"
          placeholderTextColor="#64748b"
          multiline
        />
      </BottomSheetModal>

      {offlineMode ? (
        <Pressable
          style={[styles.infoBtn, isLightTheme && styles.infoBtnLight, { bottom: 16 + androidBottomInset }]}
          onPress={() => setError('Modo offline: puedes consultar cache local, pero crear compras requiere conexion.')}
        >
          <Text style={[styles.infoBtnText, isLightTheme && styles.infoBtnTextLight]}>Info offline</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#060b16', padding: 12 },
  containerLight: { backgroundColor: '#edf2fb' },
  noticeBox: {
    borderWidth: 1,
    borderColor: '#334155',
    borderRadius: 10,
    backgroundColor: '#111827',
    padding: 10,
    marginBottom: 8,
  },
  noticeBoxLight: { borderColor: '#cbd5e1', backgroundColor: '#ffffff' },
  noticeText: { color: '#cbd5e1', fontSize: 12, lineHeight: 18 },
  noticeTextLight: { color: '#475569' },
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
  note: { color: '#94a3b8', marginTop: 8, fontSize: 12 },
  noteLight: { color: '#64748b' },
  cardActions: {
    marginTop: 10,
    flexDirection: 'row',
    justifyContent: 'flex-end',
  },
  cardActionBtn: {
    minHeight: 38,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#2563eb',
    backgroundColor: '#1d4ed8',
    paddingHorizontal: 12,
    paddingVertical: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cardActionBtnLight: {
    borderColor: '#2563eb',
    backgroundColor: '#dbeafe',
  },
  cardActionBtnText: { color: '#eff6ff', fontWeight: '800', fontSize: 12 },
  cardActionBtnTextLight: { color: '#1d4ed8' },
  infoBtn: {
    position: 'absolute',
    right: 16,
    bottom: 72,
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 8,
    backgroundColor: '#334155',
  },
  infoBtnText: { color: '#e2e8f0', fontWeight: '700' },
  infoBtnLight: { backgroundColor: '#dbe4ef' },
  infoBtnTextLight: { color: '#334155' },
  modalTitle: { color: '#f8fafc', fontWeight: '800', fontSize: 22 },
  modalTitleLight: { color: '#0f172a' },
  modalSubtitle: { color: '#94a3b8', marginTop: 6, marginBottom: 4, lineHeight: 18 },
  modalSubtitleLight: { color: '#64748b' },
  formErrorBox: {
    borderWidth: 1,
    borderColor: '#7f1d1d',
    backgroundColor: '#2b1111',
    borderRadius: 12,
    padding: 10,
    marginTop: 8,
  },
  formErrorBoxLight: {
    borderColor: '#fecaca',
    backgroundColor: '#fff1f2',
  },
  formErrorText: { color: '#fecaca', fontWeight: '600', lineHeight: 18 },
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
  noteInput: { minHeight: 86, textAlignVertical: 'top' },
  invoiceAiCard: {
    marginTop: 14,
    borderWidth: 1,
    borderColor: '#1d4ed8',
    borderRadius: 14,
    backgroundColor: '#0b1220',
    padding: 12,
  },
  invoiceAiCardLight: {
    borderColor: '#bfdbfe',
    backgroundColor: '#eff6ff',
  },
  invoiceAiHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: 12,
  },
  invoiceAiHeaderText: {
    flex: 1,
  },
  invoiceAiTitle: {
    color: '#dbeafe',
    fontSize: 16,
    fontWeight: '800',
  },
  invoiceAiTitleLight: {
    color: '#1d4ed8',
  },
  invoiceAiMeta: {
    color: '#93c5fd',
    marginTop: 4,
    lineHeight: 18,
    fontSize: 12,
  },
  invoiceAiMetaLight: {
    color: '#1e40af',
  },
  invoiceAiActions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 12,
  },
  invoiceAiActionBtn: {
    minHeight: 40,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#2563eb',
    backgroundColor: '#1d4ed8',
    paddingHorizontal: 12,
    paddingVertical: 9,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  invoiceAiActionBtnLight: {
    borderColor: '#93c5fd',
    backgroundColor: '#ffffff',
  },
  invoiceAiActionText: {
    color: '#eff6ff',
    fontWeight: '800',
    fontSize: 12,
  },
  invoiceAiActionTextLight: {
    color: '#1d4ed8',
  },
  invoiceAiSummary: {
    marginTop: 12,
    borderWidth: 1,
    borderColor: '#334155',
    borderRadius: 12,
    backgroundColor: '#111827',
    padding: 12,
  },
  invoiceAiSummaryLight: {
    borderColor: '#dbe4ef',
    backgroundColor: '#ffffff',
  },
  invoiceAiSummaryTitle: {
    color: '#f8fafc',
    fontWeight: '800',
    fontSize: 14,
    marginBottom: 6,
  },
  invoiceAiSummaryTitleLight: {
    color: '#0f172a',
  },
  invoiceAiSummaryLine: {
    color: '#cbd5e1',
    fontSize: 12,
    lineHeight: 18,
    marginTop: 2,
  },
  invoiceAiSummaryLineLight: {
    color: '#475569',
  },
  invoiceAiSummaryPreview: {
    color: '#93c5fd',
    fontSize: 12,
    lineHeight: 18,
    marginTop: 8,
  },
  invoiceAiSummaryPreviewLight: {
    color: '#1d4ed8',
  },
  invoiceAiPills: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 10,
    marginBottom: 4,
  },
  invoiceAiPill: {
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderWidth: 1,
  },
  invoiceAiPillSuccess: {
    borderColor: '#16a34a',
    backgroundColor: '#052e16',
  },
  invoiceAiPillWarn: {
    borderColor: '#d97706',
    backgroundColor: '#3f2b05',
  },
  invoiceAiPillInfo: {
    borderColor: '#2563eb',
    backgroundColor: '#0b255a',
  },
  invoiceAiPillText: {
    color: '#f8fafc',
    fontSize: 11,
    fontWeight: '800',
  },
  invoiceAiMissingWrap: {
    marginTop: 12,
  },
  invoiceAiMissingHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
    marginBottom: 8,
  },
  invoiceAiMissingTitle: {
    color: '#f8fafc',
    fontWeight: '800',
    fontSize: 14,
  },
  invoiceAiMissingTitleLight: {
    color: '#0f172a',
  },
  invoiceAiCreateAllBtn: {
    minHeight: 36,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#22c55e',
    backgroundColor: '#14532d',
    paddingHorizontal: 12,
    paddingVertical: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  invoiceAiCreateAllBtnLight: {
    borderColor: '#86efac',
    backgroundColor: '#f0fdf4',
  },
  invoiceAiCreateAllText: {
    color: '#dcfce7',
    fontWeight: '800',
    fontSize: 12,
  },
  invoiceAiCreateAllTextLight: {
    color: '#166534',
  },
  invoiceAiMissingCard: {
    borderWidth: 1,
    borderColor: '#334155',
    borderRadius: 12,
    backgroundColor: '#111827',
    padding: 12,
    marginTop: 8,
  },
  invoiceAiMissingCardLight: {
    borderColor: '#dbe4ef',
    backgroundColor: '#ffffff',
  },
  invoiceAiMissingName: {
    color: '#f8fafc',
    fontWeight: '700',
    fontSize: 14,
  },
  invoiceAiMissingNameLight: {
    color: '#0f172a',
  },
  invoiceAiMissingMeta: {
    color: '#94a3b8',
    marginTop: 4,
    fontSize: 12,
  },
  invoiceAiMissingMetaLight: {
    color: '#64748b',
  },
  invoiceAiMissingError: {
    color: '#fca5a5',
    fontSize: 12,
    marginTop: 8,
    lineHeight: 18,
  },
  invoiceAiCreateOneBtn: {
    marginTop: 10,
    alignSelf: 'flex-start',
    minHeight: 36,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#2563eb',
    backgroundColor: '#1d4ed8',
    paddingHorizontal: 12,
    paddingVertical: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  invoiceAiCreateOneBtnLight: {
    borderColor: '#93c5fd',
    backgroundColor: '#dbeafe',
  },
  invoiceAiCreateOneText: {
    color: '#eff6ff',
    fontWeight: '800',
    fontSize: 12,
  },
  invoiceAiCreateOneTextLight: {
    color: '#1d4ed8',
  },
  sectionHeader: {
    marginTop: 14,
    marginBottom: 4,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  sectionTitle: { color: '#f8fafc', fontSize: 18, fontWeight: '800' },
  sectionTitleLight: { color: '#0f172a' },
  sectionSpacing: { marginTop: 14 },
  sectionMiniTitle: {
    color: '#e2e8f0',
    fontSize: 13,
    fontWeight: '700',
    marginTop: 14,
    marginBottom: 6,
    textTransform: 'uppercase',
  },
  sectionMiniTitleLight: { color: '#334155' },
  addLineBtn: {
    borderWidth: 1,
    borderColor: '#2563eb',
    backgroundColor: '#1d4ed8',
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 7,
  },
  addLineBtnLight: {
    borderColor: '#2563eb',
    backgroundColor: '#dbeafe',
  },
  addLineBtnText: { color: '#eff6ff', fontWeight: '800', fontSize: 12 },
  addLineBtnTextLight: { color: '#1d4ed8' },
  lineCard: {
    borderWidth: 1,
    borderColor: '#334155',
    backgroundColor: '#111827',
    borderRadius: 14,
    padding: 12,
    marginTop: 10,
  },
  lineCardLight: {
    borderColor: '#dbe4ef',
    backgroundColor: '#f8fafc',
  },
  lineHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  lineTitle: { color: '#f8fafc', fontWeight: '700', fontSize: 15 },
  lineTitleLight: { color: '#0f172a' },
  removeBtn: {
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 6,
    backgroundColor: '#3f1115',
    borderWidth: 1,
    borderColor: '#7f1d1d',
  },
  removeBtnLight: {
    backgroundColor: '#fff1f2',
    borderColor: '#fecaca',
  },
  removeBtnText: { color: '#fecaca', fontWeight: '700', fontSize: 12 },
  removeBtnTextLight: { color: '#b91c1c' },
  inlineFields: { flexDirection: 'row', gap: 10 },
  inlineField: { flex: 1 },
  expirationBox: {
    marginTop: 12,
    borderWidth: 1,
    borderColor: '#475569',
    backgroundColor: '#0b1220',
    borderRadius: 12,
    padding: 12,
  },
  expirationBoxLight: {
    borderColor: '#cbd5e1',
    backgroundColor: '#ffffff',
  },
  expirationTitle: { color: '#e2e8f0', fontWeight: '700', fontSize: 13 },
  expirationTitleLight: { color: '#1e293b' },
  batchRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 10,
  },
  batchInputWrap: { flex: 1 },
  generateBtn: {
    minHeight: 44,
    paddingHorizontal: 12,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#312e81',
    borderWidth: 1,
    borderColor: '#4338ca',
  },
  generateBtnLight: {
    backgroundColor: '#eef2ff',
    borderColor: '#c7d2fe',
  },
  generateBtnText: { color: '#e0e7ff', fontWeight: '800', fontSize: 12 },
  generateBtnTextLight: { color: '#3730a3' },
  totalBox: {
    marginTop: 14,
    borderRadius: 14,
    padding: 14,
    borderWidth: 1,
    borderColor: '#14532d',
    backgroundColor: '#0c1f15',
  },
  totalBoxLight: {
    borderColor: '#bbf7d0',
    backgroundColor: '#f0fdf4',
  },
  totalLabel: { color: '#86efac', fontWeight: '700', fontSize: 12, textTransform: 'uppercase' },
  totalLabelLight: { color: '#166534' },
  totalValue: { color: '#f0fdf4', fontWeight: '800', fontSize: 24, marginTop: 4 },
  totalValueLight: { color: '#14532d' },
  modalFooter: {
    flexDirection: 'row',
    gap: 10,
    flexWrap: 'wrap',
    justifyContent: 'flex-end',
    paddingTop: 12,
  },
  modalFooterBtn: {
    minHeight: 44,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 10,
    alignItems: 'center',
    justifyContent: 'center',
    minWidth: 124,
  },
  ghostBtn: {
    backgroundColor: '#1e293b',
    borderWidth: 1,
    borderColor: '#475569',
  },
  ghostBtnLight: {
    backgroundColor: '#ffffff',
    borderColor: '#cbd5e1',
  },
  ghostBtnText: { color: '#e2e8f0', fontWeight: '700' },
  ghostBtnTextLight: { color: '#334155' },
  secondaryBtn: {
    backgroundColor: '#1d4ed8',
    borderWidth: 1,
    borderColor: '#2563eb',
  },
  secondaryBtnText: { color: '#dbeafe', fontWeight: '800' },
  primaryBtn: {
    backgroundColor: '#22c55e',
    borderWidth: 1,
    borderColor: '#16a34a',
  },
  primaryBtnText: { color: '#052e16', fontWeight: '800' },
  actionDisabled: { opacity: 0.5 },
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
  detailPanel: {
    borderWidth: 1,
    borderColor: '#334155',
    borderRadius: 14,
    backgroundColor: '#111827',
    padding: 12,
    marginTop: 10,
  },
  detailPanelLight: {
    borderColor: '#dbe4ef',
    backgroundColor: '#ffffff',
  },
  summaryGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  summaryItem: {
    width: '47%',
    flexGrow: 1,
    borderWidth: 1,
    borderColor: '#334155',
    borderRadius: 12,
    backgroundColor: '#0f172a',
    padding: 10,
  },
  summaryItemLight: {
    borderColor: '#dbe4ef',
    backgroundColor: '#f8fafc',
  },
  summaryLabel: {
    color: '#94a3b8',
    fontSize: 12,
    textTransform: 'uppercase',
    fontWeight: '700',
    marginBottom: 6,
  },
  summaryLabelLight: { color: '#64748b' },
  summaryValue: { color: '#e2e8f0', fontSize: 14, fontWeight: '700' },
  summaryValueLight: { color: '#0f172a' },
  summaryValuePrimary: { color: '#60a5fa', fontSize: 16, fontWeight: '800' },
  summaryValuePrimaryLight: { color: '#2563eb' },
  summaryValueSuccess: { color: '#4ade80', fontSize: 16, fontWeight: '800' },
  summaryValueSuccessLight: { color: '#15803d' },
  summaryValueDanger: { color: '#f87171', fontSize: 16, fontWeight: '800' },
  summaryValueDangerLight: { color: '#b91c1c' },
  summaryHint: { color: '#fcd34d', marginTop: 6, fontSize: 12, fontWeight: '700' },
  summaryHintLight: { color: '#b45309' },
  detailNote: {
    color: '#cbd5e1',
    marginTop: 12,
    fontSize: 13,
    lineHeight: 18,
  },
  detailNoteLight: { color: '#475569' },
  statusPill: {
    alignSelf: 'flex-start',
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  statusPillText: { fontWeight: '800', fontSize: 12 },
  smallActionBtn: {
    marginTop: 12,
    alignSelf: 'flex-start',
    minHeight: 42,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 10,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
  },
  smallActionBtnOrange: {
    borderColor: '#f97316',
    backgroundColor: '#431407',
  },
  smallActionBtnOrangeText: { color: '#fdba74', fontWeight: '800' },
  paymentCard: {
    borderWidth: 1,
    borderColor: '#7c2d12',
    borderRadius: 12,
    backgroundColor: '#431407',
    padding: 10,
    marginTop: 8,
  },
  paymentCardLight: {
    borderColor: '#fed7aa',
    backgroundColor: '#fff7ed',
  },
  paymentHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 8,
  },
  paymentDate: { color: '#fdba74', fontSize: 12 },
  paymentDateLight: { color: '#9a3412' },
  paymentAmount: { color: '#ffedd5', fontWeight: '800', fontSize: 14 },
  paymentAmountLight: { color: '#9a3412' },
  paymentMeta: { color: '#fdba74', marginTop: 4, fontSize: 12 },
  paymentMetaLight: { color: '#9a3412' },
  emptyBox: {
    marginTop: 10,
    borderWidth: 1,
    borderColor: '#334155',
    borderRadius: 12,
    backgroundColor: '#111827',
    padding: 12,
  },
  emptyBoxLight: {
    borderColor: '#dbe4ef',
    backgroundColor: '#ffffff',
  },
  emptyText: { color: '#cbd5e1', textAlign: 'center' },
  emptyTextLight: { color: '#475569' },
  warningBox: {
    marginTop: 10,
    borderWidth: 1,
    borderColor: '#92400e',
    borderRadius: 12,
    backgroundColor: '#3f2b05',
    padding: 12,
  },
  warningBoxLight: {
    borderColor: '#fde68a',
    backgroundColor: '#fffbeb',
  },
  warningText: { color: '#fcd34d', fontWeight: '600', lineHeight: 18 },
  warningTextLight: { color: '#92400e' },
  infoText: { color: '#cbd5e1', marginTop: 10, lineHeight: 18 },
  infoTextLight: { color: '#475569' },
  lineDetailCard: {
    borderWidth: 1,
    borderColor: '#334155',
    borderRadius: 14,
    backgroundColor: '#111827',
    padding: 12,
    marginTop: 10,
  },
  lineDetailCardLight: {
    borderColor: '#dbe4ef',
    backgroundColor: '#ffffff',
  },
  lineDetailTitle: { color: '#f8fafc', fontWeight: '800', fontSize: 16 },
  lineDetailTitleLight: { color: '#0f172a' },
});
