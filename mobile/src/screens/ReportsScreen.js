import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import CollapsibleFilterSection from '../components/CollapsibleFilterSection';
import DatePickerField from '../components/DatePickerField';
import SearchableSelectField from '../components/SearchableSelectField';
import { useThemeMode } from '../lib/themeMode';
import { resolveReportQueryFromText } from '../services/commandEngine/reportQueryEngine.service';
import { getSimpleCache, saveSimpleCache } from '../services/offlineCache.service';
import { getReportsSnapshot, listReportLocations } from '../services/reports.service';

const TABS = [
  { key: 'sales', label: 'Ventas' },
  { key: 'cash', label: 'Cajas' },
  { key: 'inventory', label: 'Inventario' },
  { key: 'financial', label: 'Financiero' },
  { key: 'production', label: 'Produccion' },
];

const SALES_SUBTABS = [
  { key: 'daily', label: 'Por Dia' },
  { key: 'products', label: 'Top Productos' },
  { key: 'categories', label: 'Por Categoria' },
  { key: 'sellers', label: 'Por Vendedor' },
  { key: 'payments', label: 'Por Metodo de Pago' },
  { key: 'movements', label: 'Movimientos de Caja' },
  { key: 'layaway', label: 'Plan Separe' },
  { key: 'stock-alerts', label: 'Alertas de Stock' },
];

const CASH_SUBTABS = [
  { key: 'by-register', label: 'Ventas por Caja' },
  { key: 'by-cashier', label: 'Ventas por Cajero' },
  { key: 'sessions', label: 'Sesiones' },
  { key: 'differences', label: 'Sesiones con Diferencias' },
];

const STOCK_ALERT_FILTERS = [
  { key: '', label: 'Todas' },
  { key: 'OUT_OF_STOCK', label: 'Sin stock' },
  { key: 'LOW_STOCK', label: 'Stock bajo' },
  { key: 'NO_AVAILABLE', label: 'Sin disponible' },
  { key: 'LOW_AVAILABLE', label: 'Disponible bajo' },
];

function formatInputDate(date) {
  return new Date(date).toISOString().slice(0, 10);
}

function getPresetRange(days) {
  const now = new Date();
  const from = new Date(now);
  from.setDate(from.getDate() - (days - 1));
  return { from: formatInputDate(from), to: formatInputDate(now) };
}

function getEngineSourceLabel(source, originalSource = null) {
  const normalized = String(source || '').trim().toLowerCase();
  const upstream = String(originalSource || '').trim().toLowerCase();

  const sourceMap = {
    local_cache: 'caché local',
    deterministic_parser: 'parser local',
    local_llm: 'llm local',
    cloud_llm: 'llm cloud',
  };

  if (normalized === 'local_cache' && upstream && sourceMap[upstream]) {
    return `caché local (${sourceMap[upstream]})`;
  }

  return sourceMap[normalized] || normalized || 'desconocido';
}

function formatDateTimeLabel(value) {
  if (!value) return '-';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return String(value);
  return parsed.toLocaleString('es-CO');
}

function formatDateLabel(value) {
  if (!value) return '-';
  const parsed = /^\d{4}-\d{2}-\d{2}$/.test(String(value))
    ? new Date(`${value}T00:00:00`)
    : new Date(value);
  if (Number.isNaN(parsed.getTime())) return String(value);
  return parsed.toLocaleDateString('es-CO');
}

function getStockAlertLabel(level) {
  const labels = {
    OUT_OF_STOCK: 'Sin stock',
    LOW_STOCK: 'Stock bajo',
    NO_AVAILABLE: 'Sin disponible',
    LOW_AVAILABLE: 'Disponible bajo',
  };
  return labels[level] || level || 'OK';
}

function getLayawayStatusLabel(status) {
  const labels = {
    ACTIVE: 'Activo',
    COMPLETED: 'Completado',
    CANCELLED: 'Cancelado',
    EXPIRED: 'Vencido',
  };
  return labels[status] || status || '-';
}

export default function ReportsScreen({
  tenant,
  offlineMode,
  formatMoney,
  initialTab = 'sales',
}) {
  const [tab, setTab] = useState(initialTab);
  const [locations, setLocations] = useState([]);
  const [locationId, setLocationId] = useState('');
  const [fromDate, setFromDate] = useState(getPresetRange(30).from);
  const [toDate, setToDate] = useState(getPresetRange(30).to);
  const [snapshot, setSnapshot] = useState(null);
  const [cacheInfo, setCacheInfo] = useState(null);
  const [loading, setLoading] = useState(false);
  const [aiQueryText, setAiQueryText] = useState('');
  const [loadingAiQuery, setLoadingAiQuery] = useState(false);
  const [aiQuerySummary, setAiQuerySummary] = useState(null);
  const [salesSubtab, setSalesSubtab] = useState('daily');
  const [cashSubtab, setCashSubtab] = useState('by-register');
  const [stockAlertLevelFilter, setStockAlertLevelFilter] = useState('');
  const [error, setError] = useState('');
  const themeMode = useThemeMode();
  const isLightTheme = themeMode === 'light';
  const androidFilterSurfaceReset = Platform.OS === 'android' ? styles.filterSurfaceAndroid : null;

  useEffect(() => {
    setTab(initialTab || 'sales');
  }, [initialTab]);

  const money =
    formatMoney ||
    ((value) => `$ ${Math.round(Number(value || 0)).toLocaleString('es-CO')}`);

  const cacheKey = useMemo(
    () =>
      `reports:snapshot:${tenant?.tenant_id || 'na'}:${fromDate}:${toDate}:${locationId || 'all'}`,
    [fromDate, locationId, tenant?.tenant_id, toDate],
  );
  const locationOptions = useMemo(
    () => (locations || []).map((loc) => ({ location_id: loc.location_id, name: loc.name })),
    [locations],
  );

  useEffect(() => {
    const loadLocations = async () => {
      if (!tenant?.tenant_id) return;
      const result = await listReportLocations(tenant.tenant_id);
      if (result.success) setLocations(result.data || []);
    };
    loadLocations();
  }, [tenant?.tenant_id]);

  const loadSnapshot = async () => {
    if (!tenant?.tenant_id) return;
    setLoading(true);
    setError('');

    if (offlineMode) {
      const cached = await getSimpleCache(cacheKey);
      if (cached?.value) {
        setSnapshot(cached.value);
        setCacheInfo({ source: 'cache', cachedAt: cached.cachedAt || null });
        setLoading(false);
        return;
      }

      setSnapshot(null);
      setCacheInfo({ source: 'cache-miss', cachedAt: null });
      setError('No hay caché local de este reporte para el filtro seleccionado.');
      setLoading(false);
      return;
    }

    const result = await getReportsSnapshot({
      tenantId: tenant.tenant_id,
      fromDate,
      toDate,
      locationId: locationId || null,
    });

    if (!result.success) {
      const fallback = await getSimpleCache(cacheKey);
      if (fallback?.value) {
        setSnapshot(fallback.value);
        setCacheInfo({ source: 'cache', cachedAt: fallback.cachedAt || null });
        setError(result.error || 'Sin conexión. Mostrando caché local.');
      } else {
        setSnapshot(null);
        setCacheInfo({ source: 'none', cachedAt: null });
        setError(result.error || 'No fue posible cargar reportes.');
      }
      setLoading(false);
      return;
    }

    setSnapshot(result.data);
    setCacheInfo({ source: 'server', cachedAt: new Date().toISOString() });
    await saveSimpleCache(cacheKey, result.data);
    setLoading(false);
  };

  const applyAiReportQuery = async () => {
    if (!tenant?.tenant_id) return;

    const text = String(aiQueryText || '').trim();
    if (!text) {
      setError('Escribe una consulta para IA de reportes.');
      return;
    }

    setLoadingAiQuery(true);
    setError('');
    try {
      const result = await resolveReportQueryFromText({
        tenantId: tenant.tenant_id,
        inputText: text,
        inputType: 'text',
        offlineMode,
        locationOptions,
      });

      if (!result.success || !result?.data?.intent) {
        setError(result.error || 'No se pudo interpretar la consulta IA.');
        return;
      }

      const { intent, engine, summary } = result.data;
      if (intent.tab) setTab(intent.tab);
      if (intent.from_date) setFromDate(intent.from_date);
      if (intent.to_date) setToDate(intent.to_date);

      const locationText = String(intent.location_text || '').toLowerCase();
      const wantsAllLocations = locationText.includes('todas') || locationText.includes('all');
      if (intent.location_id) {
        setLocationId(intent.location_id);
      } else if (wantsAllLocations || intent.location_text) {
        setLocationId('');
      }

      setAiQuerySummary({
        sourceLabel: getEngineSourceLabel(engine?.source, engine?.original_source),
        confidence: Number(intent.confidence || 0),
        fallbackChain: Array.isArray(engine?.fallback_chain) ? engine.fallback_chain : [],
        tab: intent.tab || null,
        fromDate: intent.from_date || null,
        toDate: intent.to_date || null,
        locationName: intent.location_name || null,
        summary: summary || null,
      });
      setAiQueryText('');
    } catch (error) {
      setError(String(error?.message || 'No se pudo interpretar la consulta IA.'));
    } finally {
      setLoadingAiQuery(false);
    }
  };

  useEffect(() => {
    loadSnapshot();
  }, [tenant?.tenant_id, fromDate, toDate, locationId, offlineMode]);

  const sales = snapshot?.sales;
  const cash = snapshot?.cash;
  const inventory = snapshot?.inventory;
  const financial = snapshot?.financial;
  const production = snapshot?.production;
  const salesStockAlerts = useMemo(
    () =>
      (sales?.stock_alerts || []).filter((item) =>
        stockAlertLevelFilter ? item.alert_level === stockAlertLevelFilter : true,
      ),
    [sales?.stock_alerts, stockAlertLevelFilter],
  );
  const sourceLabel =
    cacheInfo?.source === 'cache'
      ? 'Cache local'
      : cacheInfo?.source === 'server'
        ? 'Servidor'
        : 'Sin fuente';
  const selectedLocationName = (locations || []).find((loc) => loc.location_id === locationId)?.name || 'Todas las sedes';
  const reportFiltersSummary = `Vista: ${TABS.find((entry) => entry.key === tab)?.label || 'Ventas'} · ${fromDate} a ${toDate} · ${selectedLocationName}`;
  const reportFiltersActiveCount = locationId ? 1 : 0;

  const renderSubtabs = (items, activeKey, onChange) => (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.subTabScroll}>
      <View style={styles.tabRow}>
        {items.map((item) => {
          const isActive = item.key === activeKey;
          const badgeCount =
            item.key === 'stock-alerts' ? Number(sales?.stock_alerts?.length || 0) : null;
          return (
            <Pressable
              key={item.key}
              style={[
                styles.tabBtn,
                isLightTheme && styles.tabBtnLight,
                isActive && styles.tabBtnActive,
              ]}
              onPress={() => onChange(item.key)}
            >
              <Text
                style={[
                  styles.tabText,
                  isLightTheme && styles.tabTextLight,
                  isActive && styles.tabTextActive,
                ]}
              >
                {item.label}
                {badgeCount ? ` (${badgeCount})` : ''}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </ScrollView>
  );

  return (
    <View style={[styles.container, isLightTheme && styles.containerLight]}>
      <View style={[styles.heroCard, isLightTheme && styles.heroCardLight]}>
        <View style={styles.heroTop}>
          <Text style={[styles.heroTitle, isLightTheme && styles.heroTitleLight]}>Centro de Reportes</Text>
          <View style={[styles.sourcePill, cacheInfo?.source === 'cache' ? styles.sourcePillCache : styles.sourcePillServer]}>
            <Text style={styles.sourcePillText}>{sourceLabel}</Text>
          </View>
        </View>
        <Text style={[styles.heroSub, isLightTheme && styles.heroSubLight]}>Periodo: {fromDate} a {toDate}</Text>
        {loading ? <ActivityIndicator color="#38bdf8" style={{ marginTop: 8 }} /> : null}
      </View>

      <View style={[styles.aiQueryCard, isLightTheme && styles.aiQueryCardLight]}>
        <Text style={[styles.aiQueryTitle, isLightTheme && styles.aiQueryTitleLight]}>Consulta IA</Text>
        <TextInput
          value={aiQueryText}
          onChangeText={setAiQueryText}
          placeholder="Ej: ventas de hoy en sede principal"
          placeholderTextColor="#64748b"
          style={[styles.aiQueryInput, isLightTheme && styles.aiQueryInputLight]}
          editable={!loadingAiQuery}
          returnKeyType="send"
          onSubmitEditing={applyAiReportQuery}
        />
        <Pressable
          onPress={applyAiReportQuery}
          disabled={loadingAiQuery}
          style={[
            styles.aiQueryButton,
            isLightTheme && styles.aiQueryButtonLight,
            loadingAiQuery && styles.aiQueryButtonDisabled,
          ]}
        >
          <Text style={styles.aiQueryButtonText}>
            {loadingAiQuery ? 'Analizando...' : 'Aplicar consulta IA'}
          </Text>
        </Pressable>
        {aiQuerySummary ? (
          <View style={[styles.aiResultCard, isLightTheme && styles.aiResultCardLight]}>
            <Text style={[styles.aiResultLine, isLightTheme && styles.aiResultLineLight]}>
              Fuente: {aiQuerySummary.sourceLabel}
            </Text>
            <Text style={[styles.aiResultLine, isLightTheme && styles.aiResultLineLight]}>
              Confianza: {Math.round(Number(aiQuerySummary.confidence || 0) * 100)}%
            </Text>
            {aiQuerySummary.tab ? (
              <Text style={[styles.aiResultLine, isLightTheme && styles.aiResultLineLight]}>
                Vista: {TABS.find((entry) => entry.key === aiQuerySummary.tab)?.label || aiQuerySummary.tab}
              </Text>
            ) : null}
            {aiQuerySummary.fromDate && aiQuerySummary.toDate ? (
              <Text style={[styles.aiResultLine, isLightTheme && styles.aiResultLineLight]}>
                Rango: {aiQuerySummary.fromDate} a {aiQuerySummary.toDate}
              </Text>
            ) : null}
            {aiQuerySummary.locationName ? (
              <Text style={[styles.aiResultLine, isLightTheme && styles.aiResultLineLight]}>
                Sede: {aiQuerySummary.locationName}
              </Text>
            ) : null}
            {aiQuerySummary.summary ? (
              <Text style={[styles.aiResultLine, isLightTheme && styles.aiResultLineLight]}>
                Resumen: {aiQuerySummary.summary}
              </Text>
            ) : null}
            {aiQuerySummary.fallbackChain?.length ? (
              <Text style={[styles.aiResultLine, isLightTheme && styles.aiResultLineLight]}>
                Ruta: {aiQuerySummary.fallbackChain.join(' -> ')}
              </Text>
            ) : null}
          </View>
        ) : null}
      </View>

      <CollapsibleFilterSection
        title="Filtros de reportes"
        themeMode={themeMode}
        defaultCollapsed
        activeCount={reportFiltersActiveCount}
        summary={reportFiltersSummary}
      >
        <View style={[styles.filtersBlock, androidFilterSurfaceReset]}>
          <SearchableSelectField
            title="Vista"
            themeMode={themeMode}
            valueLabel={TABS.find((entry) => entry.key === tab)?.label || 'Ventas'}
            placeholder="Seleccionar vista"
            searchPlaceholder="Buscar vista..."
            options={TABS.map((entry) => ({ key: entry.key, label: entry.label, searchText: entry.label }))}
            selectedKey={tab}
            onSelect={(nextValue) => setTab(nextValue || 'sales')}
            allowClear={false}
          />
        </View>

        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={styles.filtersScroll}
          contentContainerStyle={styles.filtersContent}
        >
          <View style={styles.chipsRow}>
            {[
              { label: 'Hoy', days: 1 },
              { label: '7 dias', days: 7 },
              { label: '30 dias', days: 30 },
            ].map((preset) => (
              <Pressable
                key={preset.label}
                style={[styles.filterChip, isLightTheme && styles.filterChipLight]}
                onPress={() => {
                  const next = getPresetRange(preset.days);
                  setFromDate(next.from);
                  setToDate(next.to);
                }}
              >
                <Text style={[styles.filterChipText, isLightTheme && styles.filterChipTextLight]}>{preset.label}</Text>
              </Pressable>
            ))}
            <Pressable style={[styles.filterChip, isLightTheme && styles.filterChipLight]} onPress={loadSnapshot}>
              <Text style={[styles.filterChipText, isLightTheme && styles.filterChipTextLight]}>{loading ? 'Cargando...' : 'Recargar'}</Text>
            </Pressable>
          </View>
        </ScrollView>

        <View style={[styles.dateRangeCard, isLightTheme && styles.dateRangeCardLight, androidFilterSurfaceReset]}>
          <Text style={[styles.dateRangeTitle, isLightTheme && styles.dateRangeTitleLight]}>Rango de fechas</Text>
          <View style={[styles.dateRangeInputsRow, Platform.OS === 'android' && styles.dateRangeInputsRowAndroid]}>
            <DatePickerField
              label="Desde"
              value={fromDate}
              onChange={setFromDate}
              maximumDate={toDate || undefined}
              style={styles.dateField}
            />
            <DatePickerField
              label="Hasta"
              value={toDate}
              onChange={setToDate}
              minimumDate={fromDate || undefined}
              style={styles.dateField}
            />
          </View>
        </View>

        <View style={[styles.filtersBlock, androidFilterSurfaceReset]}>
          <SearchableSelectField
            title="Sede"
            themeMode={themeMode}
            valueLabel="Todas las sedes"
            clearLabel="Todas las sedes"
            placeholder="Todas las sedes"
            searchPlaceholder="Buscar sede..."
            options={(locations || []).map((loc) => ({
              key: loc.location_id,
              label: loc.name,
              searchText: loc.name,
            }))}
            selectedKey={locationId || ''}
            onSelect={(nextValue) => setLocationId(nextValue || '')}
          />
        </View>
      </CollapsibleFilterSection>

      <View style={styles.metaWrap}>
        <Text style={[styles.metaText, isLightTheme && styles.metaTextLight]}>Vista: {TABS.find((t) => t.key === tab)?.label || 'Reportes'}</Text>
        {cacheInfo?.source === 'cache' && cacheInfo?.cachedAt ? (
          <Text style={[styles.metaText, isLightTheme && styles.metaTextLight]}>Caché offline: {new Date(cacheInfo.cachedAt).toLocaleString()}</Text>
        ) : null}
        {error ? <Text style={styles.errorText}>{error}</Text> : null}
      </View>

      <ScrollView>
        {tab === 'sales' ? (
          <View>
            <View style={styles.kpiRow}>
              <View style={[styles.kpiCard, styles.kpiCardBlue, isLightTheme && styles.kpiCardLight]}>
                <Text style={[styles.kpiLabel, isLightTheme && styles.kpiLabelLight]}>Ventas</Text>
                <Text style={[styles.kpiValue, isLightTheme && styles.kpiValueLight]}>{sales?.summary?.total_sales || 0}</Text>
              </View>
              <View style={[styles.kpiCard, styles.kpiCardGreen, isLightTheme && styles.kpiCardLight]}>
                <Text style={[styles.kpiLabel, isLightTheme && styles.kpiLabelLight]}>Ventas Brutas</Text>
                <Text style={[styles.kpiValue, isLightTheme && styles.kpiValueLight]}>{money(sales?.summary?.gross_total || 0)}</Text>
              </View>
            </View>
            <View style={styles.kpiRow}>
              <View style={[styles.kpiCard, styles.kpiCardRed, isLightTheme && styles.kpiCardLight]}>
                <Text style={[styles.kpiLabel, isLightTheme && styles.kpiLabelLight]}>Devoluciones</Text>
                <Text style={[styles.kpiValue, isLightTheme && styles.kpiValueLight]}>{money(sales?.summary?.returns_total || 0)}</Text>
              </View>
              <View style={[styles.kpiCard, styles.kpiCardTeal, isLightTheme && styles.kpiCardLight]}>
                <Text style={[styles.kpiLabel, isLightTheme && styles.kpiLabelLight]}>Ventas Netas</Text>
                <Text style={[styles.kpiValue, isLightTheme && styles.kpiValueLight]}>{money(sales?.summary?.net_total || 0)}</Text>
              </View>
            </View>
            <View style={styles.kpiRow}>
              <View style={[styles.kpiCard, styles.kpiCardOrange, isLightTheme && styles.kpiCardLight]}>
                <Text style={[styles.kpiLabel, isLightTheme && styles.kpiLabelLight]}>Descuentos</Text>
                <Text style={[styles.kpiValue, isLightTheme && styles.kpiValueLight]}>{money(sales?.summary?.gross_discount || 0)}</Text>
              </View>
              <View style={[styles.kpiCard, styles.kpiCardPurple, isLightTheme && styles.kpiCardLight]}>
                <Text style={[styles.kpiLabel, isLightTheme && styles.kpiLabelLight]}>Impuestos</Text>
                <Text style={[styles.kpiValue, isLightTheme && styles.kpiValueLight]}>{money(sales?.summary?.gross_tax || 0)}</Text>
              </View>
            </View>

            {renderSubtabs(SALES_SUBTABS, salesSubtab, setSalesSubtab)}

            {salesSubtab === 'daily' ? (
              <View style={[styles.sectionCard, isLightTheme && styles.sectionCardLight]}>
                <Text style={[styles.sectionTitle, isLightTheme && styles.sectionTitleLight]}>Por Dia</Text>
                {(sales?.by_day || []).map((row) => (
                  <View key={row.date} style={[styles.lineBlock, isLightTheme && styles.lineBlockLight]}>
                    <Text style={[styles.lineLabel, isLightTheme && styles.lineLabelLight]}>{row.date}</Text>
                    <Text style={[styles.subtleText, isLightTheme && styles.subtleTextLight]}>Ventas: {row.count}</Text>
                    <Text style={[styles.subtleText, isLightTheme && styles.subtleTextLight]}>Bruto: {money(row.gross_total || 0)}</Text>
                    <Text style={[styles.negativeText]}>Devoluciones: {money(row.returns_total || 0)}</Text>
                    <Text style={[styles.lineValue, isLightTheme && styles.lineValueLight]}>Neto: {money(row.net_total || 0)}</Text>
                  </View>
                ))}
                {(sales?.by_day || []).length === 0 ? (
                  <Text style={[styles.emptyText, isLightTheme && styles.emptyTextLight]}>Sin datos</Text>
                ) : null}
              </View>
            ) : null}

            {salesSubtab === 'products' ? (
              <View style={[styles.sectionCard, isLightTheme && styles.sectionCardLight]}>
                <Text style={[styles.sectionTitle, isLightTheme && styles.sectionTitleLight]}>Top Productos</Text>
                {(sales?.top_products || []).map((item, index) => (
                  <View key={item.variant_id || `${item.sku}-${index}`} style={[styles.lineBlock, isLightTheme && styles.lineBlockLight]}>
                    <View style={styles.rankRow}>
                      <View style={[styles.rankBadge, isLightTheme && styles.rankBadgeLight]}>
                        <Text style={styles.rankBadgeText}>{index + 1}</Text>
                      </View>
                      <View style={styles.rankContent}>
                        <Text style={[styles.lineLabel, isLightTheme && styles.lineLabelLight]}>
                          {item.product_name || 'Producto'}
                          {item.variant_name ? ` · ${item.variant_name}` : ''}
                        </Text>
                        <Text style={[styles.subtleText, isLightTheme && styles.subtleTextLight]}>
                          SKU: {item.sku || '-'}
                        </Text>
                      </View>
                    </View>
                    <Text style={[styles.subtleText, isLightTheme && styles.subtleTextLight]}>
                      Cantidad: {Number(item.total_qty || 0).toLocaleString('es-CO')}
                    </Text>
                    <Text style={[styles.subtleText, isLightTheme && styles.subtleTextLight]}>
                      Ingresos: {money(item.total_revenue || 0)} · Costo: {money(item.total_cost || 0)}
                    </Text>
                    <Text style={[styles.lineValue, item.profit >= 0 ? styles.positiveText : styles.negativeText]}>
                      Utilidad: {money(item.profit || 0)}
                    </Text>
                  </View>
                ))}
                {(sales?.top_products || []).length === 0 ? (
                  <Text style={[styles.emptyText, isLightTheme && styles.emptyTextLight]}>Sin datos</Text>
                ) : null}
              </View>
            ) : null}

            {salesSubtab === 'categories' ? (
              <View style={[styles.sectionCard, isLightTheme && styles.sectionCardLight]}>
                <Text style={[styles.sectionTitle, isLightTheme && styles.sectionTitleLight]}>Por Categoria</Text>
                {(sales?.by_category || []).map((item) => (
                  <View key={item.category} style={[styles.lineBlock, isLightTheme && styles.lineBlockLight]}>
                    <Text style={[styles.lineLabel, isLightTheme && styles.lineLabelLight]}>{item.category}</Text>
                    <Text style={[styles.subtleText, isLightTheme && styles.subtleTextLight]}>
                      Cantidad: {Number(item.qty || 0).toLocaleString('es-CO')}
                    </Text>
                    <Text style={[styles.subtleText, isLightTheme && styles.subtleTextLight]}>
                      Ingresos: {money(item.revenue || 0)} · Costo: {money(item.cost || 0)}
                    </Text>
                    <Text style={[styles.lineValue, item.profit >= 0 ? styles.positiveText : styles.negativeText]}>
                      Utilidad: {money(item.profit || 0)} · Margen {Number(item.margin || 0).toLocaleString('es-CO')}%
                    </Text>
                  </View>
                ))}
                {(sales?.by_category || []).length === 0 ? (
                  <Text style={[styles.emptyText, isLightTheme && styles.emptyTextLight]}>Sin datos</Text>
                ) : null}
              </View>
            ) : null}

            {salesSubtab === 'sellers' ? (
              <View style={[styles.sectionCard, isLightTheme && styles.sectionCardLight]}>
                <Text style={[styles.sectionTitle, isLightTheme && styles.sectionTitleLight]}>Por Vendedor</Text>
                {(sales?.by_seller || []).map((row) => (
                  <View key={row.user_id || row.name} style={[styles.lineRow, isLightTheme && styles.lineRowLight]}>
                    <Text style={[styles.lineLabel, isLightTheme && styles.lineLabelLight]}>{row.name}</Text>
                    <Text style={[styles.lineValue, isLightTheme && styles.lineValueLight]}>
                      {row.count} · {money(row.total || 0)}
                    </Text>
                  </View>
                ))}
                {(sales?.by_seller || []).length === 0 ? (
                  <Text style={[styles.emptyText, isLightTheme && styles.emptyTextLight]}>Sin datos</Text>
                ) : null}
              </View>
            ) : null}

            {salesSubtab === 'payments' ? (
              <View style={[styles.sectionCard, isLightTheme && styles.sectionCardLight]}>
                <Text style={[styles.sectionTitle, isLightTheme && styles.sectionTitleLight]}>Por Metodo de Pago</Text>
                {(sales?.by_payment_method || []).map((row) => (
                  <View key={row.code || row.name} style={[styles.lineBlock, isLightTheme && styles.lineBlockLight]}>
                    <Text style={[styles.lineLabel, isLightTheme && styles.lineLabelLight]}>{row.name || row.code || 'Otro'}</Text>
                    <Text style={[styles.subtleText, isLightTheme && styles.subtleTextLight]}>
                      Transacciones: {Number(row.count || 0).toLocaleString('es-CO')}
                    </Text>
                    <Text style={[styles.lineValue, isLightTheme && styles.lineValueLight]}>{money(row.total || 0)}</Text>
                  </View>
                ))}
                {(sales?.by_payment_method || []).length === 0 ? (
                  <Text style={[styles.emptyText, isLightTheme && styles.emptyTextLight]}>Sin datos</Text>
                ) : null}
              </View>
            ) : null}

            {salesSubtab === 'movements' ? (
              <>
                <View style={[styles.sectionCard, isLightTheme && styles.sectionCardLight]}>
                  <Text style={[styles.sectionTitle, isLightTheme && styles.sectionTitleLight]}>Resumen de Movimientos</Text>
                  <View style={[styles.lineRow, isLightTheme && styles.lineRowLight]}>
                    <Text style={[styles.lineLabel, isLightTheme && styles.lineLabelLight]}>Ingresos</Text>
                    <Text style={[styles.lineValue, styles.positiveText]}>
                      {sales?.cash_movements_summary?.count_income || 0} · {money(sales?.cash_movements_summary?.total_income || 0)}
                    </Text>
                  </View>
                  <View style={[styles.lineRow, isLightTheme && styles.lineRowLight]}>
                    <Text style={[styles.lineLabel, isLightTheme && styles.lineLabelLight]}>Gastos</Text>
                    <Text style={[styles.lineValue, styles.negativeText]}>
                      {sales?.cash_movements_summary?.count_expense || 0} · {money(sales?.cash_movements_summary?.total_expense || 0)}
                    </Text>
                  </View>
                  <View style={[styles.lineRow, isLightTheme && styles.lineRowLight]}>
                    <Text style={[styles.lineLabel, isLightTheme && styles.lineLabelLight]}>Neto</Text>
                    <Text
                      style={[
                        styles.lineValue,
                        Number(sales?.cash_movements_summary?.net || 0) >= 0 ? styles.positiveText : styles.negativeText,
                      ]}
                    >
                      {money(sales?.cash_movements_summary?.net || 0)}
                    </Text>
                  </View>
                </View>

                <View style={[styles.sectionCard, isLightTheme && styles.sectionCardLight]}>
                  <Text style={[styles.sectionTitle, isLightTheme && styles.sectionTitleLight]}>Detalle de Movimientos</Text>
                  {(sales?.cash_movements || []).map((move) => (
                    <View key={move.cash_movement_id || `${move.created_at}-${move.amount}`} style={[styles.lineBlock, isLightTheme && styles.lineBlockLight]}>
                      <Text style={[styles.lineLabel, isLightTheme && styles.lineLabelLight]}>
                        {move.type === 'INCOME' ? 'Ingreso' : 'Gasto'} · {move.category || 'Sin categoria'}
                      </Text>
                      <Text style={[styles.subtleText, isLightTheme && styles.subtleTextLight]}>
                        {formatDateTimeLabel(move.created_at)}
                      </Text>
                      <Text style={[styles.subtleText, isLightTheme && styles.subtleTextLight]}>
                        Caja: {move.register_name || '-'} · {move.location_name || '-'}
                      </Text>
                      <Text style={[styles.subtleText, isLightTheme && styles.subtleTextLight]}>
                        Registrado por: {move.created_by_name || '-'}
                      </Text>
                      <Text style={[styles.lineValue, move.type === 'INCOME' ? styles.positiveText : styles.negativeText]}>
                        {move.type === 'INCOME' ? '+' : '-'}{money(move.amount || 0)}
                      </Text>
                    </View>
                  ))}
                  {(sales?.cash_movements || []).length === 0 ? (
                    <Text style={[styles.emptyText, isLightTheme && styles.emptyTextLight]}>Sin movimientos</Text>
                  ) : null}
                </View>
              </>
            ) : null}

            {salesSubtab === 'layaway' ? (
              <>
                <View style={styles.kpiRow}>
                  <View style={[styles.kpiCard, styles.kpiCardBlue, isLightTheme && styles.kpiCardLight]}>
                    <Text style={[styles.kpiLabel, isLightTheme && styles.kpiLabelLight]}>Contratos</Text>
                    <Text style={[styles.kpiValue, isLightTheme && styles.kpiValueLight]}>{sales?.layaway_summary?.total_contracts || 0}</Text>
                  </View>
                  <View style={[styles.kpiCard, styles.kpiCardGreen, isLightTheme && styles.kpiCardLight]}>
                    <Text style={[styles.kpiLabel, isLightTheme && styles.kpiLabelLight]}>Activos</Text>
                    <Text style={[styles.kpiValue, isLightTheme && styles.kpiValueLight]}>{sales?.layaway_summary?.active_contracts || 0}</Text>
                  </View>
                </View>
                <View style={styles.kpiRow}>
                  <View style={[styles.kpiCard, styles.kpiCardTeal, isLightTheme && styles.kpiCardLight]}>
                    <Text style={[styles.kpiLabel, isLightTheme && styles.kpiLabelLight]}>Completados</Text>
                    <Text style={[styles.kpiValue, isLightTheme && styles.kpiValueLight]}>{sales?.layaway_summary?.completed_contracts || 0}</Text>
                  </View>
                  <View style={[styles.kpiCard, styles.kpiCardRed, isLightTheme && styles.kpiCardLight]}>
                    <Text style={[styles.kpiLabel, isLightTheme && styles.kpiLabelLight]}>Cancelados</Text>
                    <Text style={[styles.kpiValue, isLightTheme && styles.kpiValueLight]}>{sales?.layaway_summary?.cancelled_contracts || 0}</Text>
                  </View>
                </View>

                <View style={[styles.sectionCard, isLightTheme && styles.sectionCardLight]}>
                  <Text style={[styles.sectionTitle, isLightTheme && styles.sectionTitleLight]}>Contratos</Text>
                  {(sales?.layaway_contracts || []).map((contract) => (
                    <View key={contract.layaway_id || `${contract.customer_name}-${contract.created_at}`} style={[styles.lineBlock, isLightTheme && styles.lineBlockLight]}>
                      <Text style={[styles.lineLabel, isLightTheme && styles.lineLabelLight]}>{contract.customer_name || 'Cliente'}</Text>
                      <Text style={[styles.subtleText, isLightTheme && styles.subtleTextLight]}>
                        Estado: {getLayawayStatusLabel(contract.status)}
                      </Text>
                      <Text style={[styles.subtleText, isLightTheme && styles.subtleTextLight]}>
                        Creacion: {formatDateLabel(contract.created_at)} · Vencimiento: {formatDateLabel(contract.due_date)}
                      </Text>
                      <Text style={[styles.subtleText, isLightTheme && styles.subtleTextLight]}>
                        Total: {money(contract.total || 0)} · Abonado: {money(contract.paid_total || 0)}
                      </Text>
                      <Text style={[styles.lineValue, styles.negativeText]}>Saldo: {money(contract.balance || 0)}</Text>
                    </View>
                  ))}
                  {(sales?.layaway_contracts || []).length === 0 ? (
                    <Text style={[styles.emptyText, isLightTheme && styles.emptyTextLight]}>Sin contratos</Text>
                  ) : null}
                </View>
              </>
            ) : null}

            {salesSubtab === 'stock-alerts' ? (
              <>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.filtersScroll}>
                  <View style={styles.chipsRow}>
                    {STOCK_ALERT_FILTERS.map((filter) => {
                      const active = filter.key === stockAlertLevelFilter;
                      return (
                        <Pressable
                          key={filter.key || 'all'}
                          style={[
                            styles.filterChip,
                            isLightTheme && styles.filterChipLight,
                            active && styles.filterChipActive,
                          ]}
                          onPress={() => setStockAlertLevelFilter(filter.key)}
                        >
                          <Text
                            style={[
                              styles.filterChipText,
                              isLightTheme && styles.filterChipTextLight,
                              active && styles.filterChipTextActive,
                            ]}
                          >
                            {filter.label}
                          </Text>
                        </Pressable>
                      );
                    })}
                  </View>
                </ScrollView>

                <View style={[styles.sectionCard, isLightTheme && styles.sectionCardLight]}>
                  <Text style={[styles.sectionTitle, isLightTheme && styles.sectionTitleLight]}>Alertas de Stock</Text>
                  {salesStockAlerts.map((item) => (
                    <View key={`${item.location_id}-${item.variant_id}`} style={[styles.lineBlock, isLightTheme && styles.lineBlockLight]}>
                      <Text style={[styles.lineLabel, isLightTheme && styles.lineLabelLight]}>
                        {getStockAlertLabel(item.alert_level)} · {item.product_name}
                        {item.variant_name ? ` · ${item.variant_name}` : ''}
                      </Text>
                      <Text style={[styles.subtleText, isLightTheme && styles.subtleTextLight]}>
                        SKU: {item.sku || '-'} · Sede: {item.location_name || '-'}
                      </Text>
                      <Text style={[styles.subtleText, isLightTheme && styles.subtleTextLight]}>
                        Stock: {Number(item.on_hand || 0).toLocaleString('es-CO')} · Disponible: {Number(item.available || 0).toLocaleString('es-CO')} · Min: {Number(item.min_stock || 0).toLocaleString('es-CO')}
                      </Text>
                    </View>
                  ))}
                  {salesStockAlerts.length === 0 ? (
                    <Text style={[styles.emptyText, isLightTheme && styles.emptyTextLight]}>No hay alertas de stock</Text>
                  ) : null}
                </View>
              </>
            ) : null}
          </View>
        ) : null}

        {tab === 'cash' ? (
          <View>
            <View style={styles.kpiRow}>
              <View style={[styles.kpiCard, styles.kpiCardOrange, isLightTheme && styles.kpiCardLight]}>
                <Text style={[styles.kpiLabel, isLightTheme && styles.kpiLabelLight]}>Sesiones</Text>
                <Text style={[styles.kpiValue, isLightTheme && styles.kpiValueLight]}>{cash?.summary?.sessions_count || 0}</Text>
              </View>
              <View style={[styles.kpiCard, styles.kpiCardBlue, isLightTheme && styles.kpiCardLight]}>
                <Text style={[styles.kpiLabel, isLightTheme && styles.kpiLabelLight]}>Transacciones</Text>
                <Text style={[styles.kpiValue, isLightTheme && styles.kpiValueLight]}>{cash?.summary?.transactions_count || 0}</Text>
              </View>
            </View>
            <View style={styles.kpiRow}>
              <View style={[styles.kpiCard, styles.kpiCardGreen, isLightTheme && styles.kpiCardLight]}>
                <Text style={[styles.kpiLabel, isLightTheme && styles.kpiLabelLight]}>Total Vendido</Text>
                <Text style={[styles.kpiValue, isLightTheme && styles.kpiValueLight]}>{money(cash?.summary?.sales_total || 0)}</Text>
              </View>
              <View style={[styles.kpiCard, styles.kpiCardTeal, isLightTheme && styles.kpiCardLight]}>
                <Text style={[styles.kpiLabel, isLightTheme && styles.kpiLabelLight]}>Sesiones con Diferencias</Text>
                <Text style={[styles.kpiValue, isLightTheme && styles.kpiValueLight]}>{cash?.summary?.sessions_with_difference || 0}</Text>
              </View>
            </View>

            {renderSubtabs(CASH_SUBTABS, cashSubtab, setCashSubtab)}

            {cashSubtab === 'by-register' ? (
              <View style={[styles.sectionCard, isLightTheme && styles.sectionCardLight]}>
                <Text style={[styles.sectionTitle, isLightTheme && styles.sectionTitleLight]}>Ventas por Caja Registradora</Text>
                {(cash?.by_cash_register || []).map((item) => (
                  <View key={item.cash_register_id || item.name} style={[styles.lineBlock, isLightTheme && styles.lineBlockLight]}>
                    <Text style={[styles.lineLabel, isLightTheme && styles.lineLabelLight]}>{item.name || 'Sin caja'}</Text>
                    <Text style={[styles.subtleText, isLightTheme && styles.subtleTextLight]}>{item.location || '-'}</Text>
                    <Text style={[styles.subtleText, isLightTheme && styles.subtleTextLight]}>
                      Transacciones: {Number(item.count || 0).toLocaleString('es-CO')}
                    </Text>
                    <Text style={[styles.lineValue, styles.positiveText]}>
                      Total: {money(item.total || 0)} · Promedio {money(Number(item.count || 0) > 0 ? Number(item.total || 0) / Number(item.count || 0) : 0)}
                    </Text>
                  </View>
                ))}
                {(cash?.by_cash_register || []).length === 0 ? (
                  <Text style={[styles.emptyText, isLightTheme && styles.emptyTextLight]}>Sin datos</Text>
                ) : null}
              </View>
            ) : null}

            {cashSubtab === 'by-cashier' ? (
              <View style={[styles.sectionCard, isLightTheme && styles.sectionCardLight]}>
                <Text style={[styles.sectionTitle, isLightTheme && styles.sectionTitleLight]}>Ventas por Cajero/Sesion</Text>
                {(cash?.sessions || []).map((session) => (
                  <View key={session.cash_session_id} style={[styles.lineBlock, isLightTheme && styles.lineBlockLight]}>
                    <Text style={[styles.lineLabel, isLightTheme && styles.lineLabelLight]}>{session.opened_by || session.closed_by || 'Sin asignar'}</Text>
                    <Text style={[styles.subtleText, isLightTheme && styles.subtleTextLight]}>
                      {session.register_name || 'Caja'} · {session.location || '-'}
                    </Text>
                    <Text style={[styles.subtleText, isLightTheme && styles.subtleTextLight]}>
                      Ventas: {session.sales_count || 0} · Total: {money(session.sales_total || 0)}
                    </Text>
                    <Text style={[styles.lineValue, isLightTheme && styles.lineValueLight]}>
                      Prom./Venta: {money(session.avg_per_sale || 0)} · Duracion: {session.duration_minutes !== null ? `${session.duration_minutes} min` : '-'}
                    </Text>
                  </View>
                ))}
                {(cash?.sessions || []).length === 0 ? (
                  <Text style={[styles.emptyText, isLightTheme && styles.emptyTextLight]}>Sin sesiones</Text>
                ) : null}
              </View>
            ) : null}

            {cashSubtab === 'sessions' ? (
              <View style={[styles.sectionCard, isLightTheme && styles.sectionCardLight]}>
                <Text style={[styles.sectionTitle, isLightTheme && styles.sectionTitleLight]}>Sesiones</Text>
                {(cash?.sessions || []).map((session) => (
                  <View key={session.cash_session_id} style={[styles.lineBlock, isLightTheme && styles.lineBlockLight]}>
                    <Text style={[styles.lineLabel, isLightTheme && styles.lineLabelLight]}>
                      {session.register_name || 'Caja'} · {session.status === 'OPEN' ? 'Abierta' : 'Cerrada'}
                    </Text>
                    <Text style={[styles.subtleText, isLightTheme && styles.subtleTextLight]}>{session.location || '-'}</Text>
                    <Text style={[styles.subtleText, isLightTheme && styles.subtleTextLight]}>
                      Apertura: {formatDateTimeLabel(session.opened_at)} · {session.opened_by || '-'}
                    </Text>
                    <Text style={[styles.subtleText, isLightTheme && styles.subtleTextLight]}>
                      Cierre: {session.closed_at ? formatDateTimeLabel(session.closed_at) : '-'} · {session.closed_by || '-'}
                    </Text>
                    <Text style={[styles.subtleText, isLightTheme && styles.subtleTextLight]}>
                      Monto apertura: {money(session.opening_amount || 0)} · Monto cierre: {money(session.closing_amount || 0)}
                    </Text>
                    <Text style={[styles.subtleText, isLightTheme && styles.subtleTextLight]}>
                      Declarado: {session.declared_amount > 0 ? money(session.declared_amount || 0) : '-'}
                    </Text>
                    <Text style={[styles.lineValue, styles.positiveText]}>
                      Ventas: {money(session.sales_total || 0)} · # {session.sales_count || 0}
                    </Text>
                  </View>
                ))}
                {(cash?.sessions || []).length === 0 ? (
                  <Text style={[styles.emptyText, isLightTheme && styles.emptyTextLight]}>Sin sesiones</Text>
                ) : null}
              </View>
            ) : null}

            {cashSubtab === 'differences' ? (
              <View style={[styles.sectionCard, isLightTheme && styles.sectionCardLight]}>
                <Text style={[styles.sectionTitle, isLightTheme && styles.sectionTitleLight]}>Sesiones con Diferencias</Text>
                {(cash?.sessions_with_difference || []).map((session) => (
                  <View key={session.cash_session_id} style={[styles.lineBlock, isLightTheme && styles.lineBlockLight]}>
                    <Text style={[styles.lineLabel, isLightTheme && styles.lineLabelLight]}>
                      {session.register_name || 'Caja'} · {session.location || '-'}
                    </Text>
                    <Text style={[styles.subtleText, isLightTheme && styles.subtleTextLight]}>
                      Cajero: {session.closed_by || session.opened_by || '-'} · Cierre: {session.closed_at ? formatDateLabel(session.closed_at) : '-'}
                    </Text>
                    <Text style={[styles.subtleText, isLightTheme && styles.subtleTextLight]}>
                      Monto cierre: {money(session.closing_amount || 0)} · Declarado: {money(session.declared_amount || 0)}
                    </Text>
                    <Text style={[styles.lineValue, Number(session.difference || 0) >= 0 ? styles.positiveText : styles.negativeText]}>
                      Diferencia: {Number(session.difference || 0) >= 0 ? '+' : ''}{money(session.difference || 0)} · Ventas {money(session.sales_total || 0)}
                    </Text>
                  </View>
                ))}
                {(cash?.sessions_with_difference || []).length === 0 ? (
                  <Text style={[styles.emptyText, isLightTheme && styles.emptyTextLight]}>No hay sesiones con diferencias</Text>
                ) : null}
              </View>
            ) : null}
          </View>
        ) : null}

        {tab === 'inventory' ? (
          <View>
            <View style={styles.kpiRow}>
              <View style={[styles.kpiCard, isLightTheme && styles.kpiCardLight]}>
                <Text style={[styles.kpiLabel, isLightTheme && styles.kpiLabelLight]}>Registros</Text>
                <Text style={[styles.kpiValue, isLightTheme && styles.kpiValueLight]}>{inventory?.summary?.rows || 0}</Text>
              </View>
              <View style={[styles.kpiCard, isLightTheme && styles.kpiCardLight]}>
                <Text style={[styles.kpiLabel, isLightTheme && styles.kpiLabelLight]}>Stock Bajo</Text>
                <Text style={[styles.kpiValue, isLightTheme && styles.kpiValueLight]}>{inventory?.summary?.low_stock || 0}</Text>
              </View>
            </View>
            <View style={styles.kpiRow}>
              <View style={[styles.kpiCard, isLightTheme && styles.kpiCardLight]}>
                <Text style={[styles.kpiLabel, isLightTheme && styles.kpiLabelLight]}>Sin Stock</Text>
                <Text style={[styles.kpiValue, isLightTheme && styles.kpiValueLight]}>{inventory?.summary?.out_of_stock || 0}</Text>
              </View>
              <View style={[styles.kpiCard, isLightTheme && styles.kpiCardLight]}>
                <Text style={[styles.kpiLabel, isLightTheme && styles.kpiLabelLight]}>Valor Inventario</Text>
                <Text style={[styles.kpiValue, isLightTheme && styles.kpiValueLight]}>{money(inventory?.summary?.inventory_value || 0)}</Text>
              </View>
            </View>

            <View style={[styles.sectionCard, isLightTheme && styles.sectionCardLight]}>
              <Text style={[styles.sectionTitle, isLightTheme && styles.sectionTitleLight]}>Productos con Stock Bajo</Text>
              {(inventory?.low_stock_items || []).slice(0, 30).map((item, idx) => (
                <View key={`${item.product_name}-${idx}`} style={[styles.lineBlock, isLightTheme && styles.lineBlockLight]}>
                  <Text style={[styles.lineLabel, isLightTheme && styles.lineLabelLight]}>{item.product_name}</Text>
                  <Text style={[styles.lineValue, isLightTheme && styles.lineValueLight]}>
                    Stock {item.on_hand} / Min {item.min_stock} · Costo {money(item.cost || 0)}
                  </Text>
                </View>
              ))}
              {(inventory?.low_stock_items || []).length === 0 ? (
                <Text style={[styles.emptyText, isLightTheme && styles.emptyTextLight]}>Sin alertas</Text>
              ) : null}
            </View>

            <View style={[styles.sectionCard, isLightTheme && styles.sectionCardLight]}>
              <Text style={[styles.sectionTitle, isLightTheme && styles.sectionTitleLight]}>Productos sin Stock</Text>
              {(inventory?.out_of_stock_items || []).slice(0, 20).map((item, idx) => (
                <View key={`${item.product_name}-${idx}`} style={[styles.lineRow, isLightTheme && styles.lineRowLight]}>
                  <Text style={[styles.lineLabel, isLightTheme && styles.lineLabelLight]}>{item.product_name}</Text>
                  <Text style={[styles.lineValue, isLightTheme && styles.lineValueLight]}>0 / Min {item.min_stock}</Text>
                </View>
              ))}
              {(inventory?.out_of_stock_items || []).length === 0 ? (
                <Text style={[styles.emptyText, isLightTheme && styles.emptyTextLight]}>Sin datos</Text>
              ) : null}
            </View>
          </View>
        ) : null}

        {tab === 'financial' ? (
          <View>
            <View style={styles.kpiRow}>
              <View style={[styles.kpiCard, isLightTheme && styles.kpiCardLight]}>
                <Text style={[styles.kpiLabel, isLightTheme && styles.kpiLabelLight]}>Ventas Netas</Text>
                <Text style={[styles.kpiValue, isLightTheme && styles.kpiValueLight]}>{money(financial?.summary?.net_sales || 0)}</Text>
              </View>
              <View style={[styles.kpiCard, isLightTheme && styles.kpiCardLight]}>
                <Text style={[styles.kpiLabel, isLightTheme && styles.kpiLabelLight]}>Costo Estimado</Text>
                <Text style={[styles.kpiValue, isLightTheme && styles.kpiValueLight]}>{money(financial?.summary?.estimated_cost || 0)}</Text>
              </View>
            </View>
            <View style={styles.kpiRow}>
              <View style={[styles.kpiCard, isLightTheme && styles.kpiCardLight]}>
                <Text style={[styles.kpiLabel, isLightTheme && styles.kpiLabelLight]}>Margen Bruto</Text>
                <Text style={[styles.kpiValue, isLightTheme && styles.kpiValueLight]}>{money(financial?.summary?.gross_margin || 0)}</Text>
              </View>
              <View style={[styles.kpiCard, isLightTheme && styles.kpiCardLight]}>
                <Text style={[styles.kpiLabel, isLightTheme && styles.kpiLabelLight]}>Resultado Neto</Text>
                <Text style={[styles.kpiValue, isLightTheme && styles.kpiValueLight]}>{money(financial?.summary?.net_result || 0)}</Text>
              </View>
            </View>

            <View style={[styles.sectionCard, isLightTheme && styles.sectionCardLight]}>
              <Text style={[styles.sectionTitle, isLightTheme && styles.sectionTitleLight]}>Movimientos de Caja</Text>
              {(financial?.cash_movements || []).slice(0, 30).map((move, idx) => (
                <View key={`${move.created_at}-${idx}`} style={[styles.lineRow, isLightTheme && styles.lineRowLight]}>
                  <Text style={[styles.lineLabel, isLightTheme && styles.lineLabelLight]}>
                    {move.type === 'INCOME' ? 'Ingreso' : 'Gasto'} · {move.category || 'General'}
                  </Text>
                  <Text style={[styles.lineValue, isLightTheme && styles.lineValueLight]}>{money(move.amount || 0)}</Text>
                </View>
              ))}
              {(financial?.cash_movements || []).length === 0 ? (
                <Text style={[styles.emptyText, isLightTheme && styles.emptyTextLight]}>Sin datos</Text>
              ) : null}
            </View>
          </View>
        ) : null}

        {tab === 'production' ? (
          <View>
            <View style={styles.kpiRow}>
              <View style={[styles.kpiCard, isLightTheme && styles.kpiCardLight]}>
                <Text style={[styles.kpiLabel, isLightTheme && styles.kpiLabelLight]}>Ordenes</Text>
                <Text style={[styles.kpiValue, isLightTheme && styles.kpiValueLight]}>{production?.summary?.total_orders || 0}</Text>
              </View>
              <View style={[styles.kpiCard, isLightTheme && styles.kpiCardLight]}>
                <Text style={[styles.kpiLabel, isLightTheme && styles.kpiLabelLight]}>Completadas</Text>
                <Text style={[styles.kpiValue, isLightTheme && styles.kpiValueLight]}>{production?.summary?.completed_orders || 0}</Text>
              </View>
            </View>
            <View style={styles.kpiRow}>
              <View style={[styles.kpiCard, isLightTheme && styles.kpiCardLight]}>
                <Text style={[styles.kpiLabel, isLightTheme && styles.kpiLabelLight]}>Cant. Planeada</Text>
                <Text style={[styles.kpiValue, isLightTheme && styles.kpiValueLight]}>{Number(production?.summary?.planned_qty || 0).toLocaleString('es-CO')}</Text>
              </View>
              <View style={[styles.kpiCard, isLightTheme && styles.kpiCardLight]}>
                <Text style={[styles.kpiLabel, isLightTheme && styles.kpiLabelLight]}>Cant. Producida</Text>
                <Text style={[styles.kpiValue, isLightTheme && styles.kpiValueLight]}>{Number(production?.summary?.produced_qty || 0).toLocaleString('es-CO')}</Text>
              </View>
            </View>

            <View style={[styles.sectionCard, isLightTheme && styles.sectionCardLight]}>
              <Text style={[styles.sectionTitle, isLightTheme && styles.sectionTitleLight]}>Ordenes de Produccion</Text>
              {(production?.orders || []).slice(0, 30).map((order) => (
                <View key={order.production_order_id} style={[styles.lineBlock, isLightTheme && styles.lineBlockLight]}>
                  <Text style={[styles.lineLabel, isLightTheme && styles.lineLabelLight]}>
                    {order.product_name || 'Producto'} {order.variant_name ? `· ${order.variant_name}` : ''}
                  </Text>
                  <Text style={[styles.lineValue, isLightTheme && styles.lineValueLight]}>
                    {order.status} · {order.quantity_produced}/{order.quantity_planned}
                  </Text>
                </View>
              ))}
              {(production?.orders || []).length === 0 ? (
                <Text style={[styles.emptyText, isLightTheme && styles.emptyTextLight]}>Sin datos</Text>
              ) : null}
            </View>
          </View>
        ) : null}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#060b16', padding: 12 },
  containerLight: { backgroundColor: '#edf2fb' },
  heroCard: {
    backgroundColor: '#0f172a',
    borderColor: '#1e293b',
    borderWidth: 1,
    borderRadius: 14,
    padding: 12,
    marginBottom: 8,
  },
  heroCardLight: {
    backgroundColor: '#ffffff',
    borderColor: '#dbe4ef',
  },
  heroTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 },
  heroTitle: { color: '#f8fafc', fontWeight: '800', fontSize: 18 },
  heroTitleLight: { color: '#0f172a' },
  heroSub: { color: '#94a3b8', marginTop: 3, fontSize: 12 },
  heroSubLight: { color: '#475569' },
  aiQueryCard: {
    backgroundColor: '#0f172a',
    borderColor: '#1e293b',
    borderWidth: 1,
    borderRadius: 14,
    padding: 10,
    marginBottom: 8,
  },
  aiQueryCardLight: {
    backgroundColor: '#ffffff',
    borderColor: '#dbe4ef',
  },
  aiQueryTitle: {
    color: '#e2e8f0',
    fontSize: 13,
    fontWeight: '800',
    marginBottom: 8,
  },
  aiQueryTitleLight: {
    color: '#0f172a',
  },
  aiQueryInput: {
    borderWidth: 1,
    borderColor: '#334155',
    borderRadius: 10,
    backgroundColor: '#0b1220',
    color: '#f8fafc',
    minHeight: 42,
    paddingHorizontal: 10,
    marginBottom: 8,
  },
  aiQueryInputLight: {
    borderColor: '#cbd5e1',
    backgroundColor: '#ffffff',
    color: '#0f172a',
  },
  aiQueryButton: {
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#235ea9',
    backgroundColor: '#235ea9',
    minHeight: 40,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 12,
  },
  aiQueryButtonLight: {
    borderColor: '#1d4f8c',
    backgroundColor: '#1d4f8c',
  },
  aiQueryButtonDisabled: {
    opacity: 0.55,
  },
  aiQueryButtonText: {
    color: '#eff6ff',
    fontSize: 13,
    fontWeight: '700',
  },
  aiResultCard: {
    marginTop: 8,
    borderWidth: 1,
    borderColor: '#334155',
    borderRadius: 10,
    backgroundColor: '#0b1220',
    padding: 9,
  },
  aiResultCardLight: {
    borderColor: '#dbe4ef',
    backgroundColor: '#f8fbff',
  },
  aiResultLine: {
    color: '#cbd5e1',
    fontSize: 12,
    marginBottom: 4,
  },
  aiResultLineLight: {
    color: '#334155',
  },
  sourcePill: {
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  sourcePillServer: { borderColor: '#14532d', backgroundColor: '#052e16' },
  sourcePillCache: { borderColor: '#7c2d12', backgroundColor: '#431407' },
  sourcePillText: { color: '#e2e8f0', fontWeight: '700', fontSize: 11 },
  subTabScroll: { marginBottom: 8 },
  tabRow: { flexDirection: 'row', gap: 8, marginBottom: 2, alignItems: 'center' },
  tabBtn: {
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#334155',
    backgroundColor: '#111827',
    minHeight: 40,
    justifyContent: 'center',
    paddingVertical: 9,
    paddingHorizontal: 12,
    alignItems: 'center',
  },
  tabBtnLight: { borderColor: '#cbd5e1', backgroundColor: '#ffffff' },
  tabBtnActive: { borderColor: '#235ea9', backgroundColor: '#235ea9' },
  tabText: {
    color: '#cbd5e1',
    fontWeight: '700',
    fontSize: 12,
    lineHeight: 18,
    includeFontPadding: false,
    textAlignVertical: 'center',
  },
  tabTextLight: { color: '#334155' },
  tabTextActive: { color: '#eff6ff' },
  filtersBlock: { marginBottom: 8, position: 'relative', overflow: 'visible' },
  filterSurfaceAndroid: { overflow: 'hidden', zIndex: 0, elevation: 0 },
  filtersScroll: { marginBottom: 8 },
  filtersContent: { alignItems: 'center', paddingVertical: 6 },
  dateRangeCard: {
    borderWidth: 1,
    borderColor: '#334155',
    borderRadius: 12,
    backgroundColor: '#0b1220',
    padding: 10,
    marginBottom: 8,
    position: 'relative',
    overflow: 'visible',
  },
  dateRangeCardLight: { borderColor: '#dbe4ef', backgroundColor: '#ffffff' },
  dateRangeTitle: { color: '#e2e8f0', fontWeight: '700', fontSize: 14, marginBottom: 8 },
  dateRangeTitleLight: { color: '#0f172a' },
  dateRangeInputsRow: { flexDirection: 'row', gap: 8, overflow: 'visible' },
  dateRangeInputsRowAndroid: { overflow: 'hidden' },
  dateField: { flex: 1 },
  chipsRow: { flexDirection: 'row', gap: 6, alignItems: 'center' },
  filterChip: {
    borderWidth: 1,
    borderColor: '#334155',
    borderRadius: 999,
    minHeight: 38,
    justifyContent: 'center',
    paddingHorizontal: 10,
    paddingVertical: 8,
    backgroundColor: '#0b1220',
  },
  filterChipLight: { borderColor: '#cbd5e1', backgroundColor: '#ffffff' },
  filterChipActive: { borderColor: '#235ea9', backgroundColor: '#235ea9' },
  filterChipText: {
    color: '#cbd5e1',
    fontSize: 12,
    fontWeight: '600',
    lineHeight: 18,
    includeFontPadding: false,
    textAlignVertical: 'center',
  },
  filterChipTextLight: { color: '#334155' },
  filterChipTextActive: { color: '#eff6ff' },
  metaWrap: { marginBottom: 8, paddingHorizontal: 2 },
  metaText: { color: '#94a3b8', fontSize: 12, fontWeight: '600' },
  metaTextLight: { color: '#475569' },
  errorText: { color: '#fca5a5', marginTop: 4, fontSize: 12 },
  kpiRow: { flexDirection: 'row', gap: 8, marginBottom: 8 },
  kpiCard: {
    flex: 1,
    backgroundColor: '#0f172a',
    borderColor: '#1e293b',
    borderWidth: 1,
    borderRadius: 14,
    padding: 12,
    elevation: 1,
  },
  kpiCardBlue: { borderColor: '#1d4ed8', backgroundColor: '#142b52' },
  kpiCardGreen: { borderColor: '#166534', backgroundColor: '#132f27' },
  kpiCardRed: { borderColor: '#991b1b', backgroundColor: '#3a1f2c' },
  kpiCardTeal: { borderColor: '#0f766e', backgroundColor: '#123447' },
  kpiCardOrange: { borderColor: '#b45309', backgroundColor: '#342a26' },
  kpiCardPurple: { borderColor: '#7e22ce', backgroundColor: '#271d49' },
  kpiCardLight: { backgroundColor: '#ffffff', borderColor: '#dbe4ef' },
  kpiLabel: { color: '#cbd5e1', fontSize: 11, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.3 },
  kpiLabelLight: { color: '#475569' },
  kpiValue: { color: '#f8fafc', fontSize: 18, fontWeight: '800', marginTop: 3 },
  kpiValueLight: { color: '#0f172a' },
  sectionCard: {
    backgroundColor: '#0f172a',
    borderColor: '#1e293b',
    borderWidth: 1,
    borderRadius: 14,
    padding: 12,
    marginBottom: 10,
  },
  sectionCardLight: { backgroundColor: '#ffffff', borderColor: '#dbe4ef' },
  sectionTitle: { color: '#e2e8f0', fontWeight: '800', marginBottom: 8, fontSize: 14 },
  sectionTitleLight: { color: '#0f172a' },
  lineRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 5,
    gap: 8,
    borderWidth: 1,
    borderColor: '#1e293b',
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 7,
    backgroundColor: '#0b1220',
  },
  lineRowLight: { borderColor: '#dbe4ef', backgroundColor: '#f8fafc' },
  lineBlock: {
    marginTop: 6,
    borderWidth: 1,
    borderColor: '#1e293b',
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 8,
    backgroundColor: '#0b1220',
  },
  lineBlockLight: { borderColor: '#dbe4ef', backgroundColor: '#f8fafc' },
  lineLabel: { color: '#cbd5e1', fontSize: 12, flex: 1 },
  lineLabelLight: { color: '#334155' },
  lineValue: { color: '#f8fafc', fontSize: 12, fontWeight: '700' },
  lineValueLight: { color: '#0f172a' },
  subtleText: { color: '#94a3b8', fontSize: 12, marginTop: 3 },
  subtleTextLight: { color: '#64748b' },
  positiveText: { color: '#4ade80' },
  negativeText: { color: '#f87171' },
  rankRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, marginBottom: 4 },
  rankBadge: {
    minWidth: 24,
    height: 24,
    borderRadius: 999,
    backgroundColor: '#1d4ed8',
    alignItems: 'center',
    justifyContent: 'center',
  },
  rankBadgeLight: {
    backgroundColor: '#dbeafe',
  },
  rankBadgeText: { color: '#eff6ff', fontSize: 11, fontWeight: '800' },
  rankContent: { flex: 1 },
  emptyText: { color: '#94a3b8', fontSize: 12, marginTop: 6, textAlign: 'center' },
  emptyTextLight: { color: '#64748b' },
});
