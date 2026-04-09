import { useCallback, useRef, useState } from 'react';
import { getDashboardSummary } from '../services/reports.service';
import { getSimpleCache, isCacheStale, saveSimpleCache } from '../services/offlineCache.service';

const DASHBOARD_CACHE_PREFIX = 'dashboard-summary';

function buildDashboardCacheKey(tenantId) {
  return `${DASHBOARD_CACHE_PREFIX}:${tenantId || 'na'}`;
}

function normalizeDashboardSnapshot(snapshot) {
  return {
    kpis: snapshot?.kpis || null,
    dailySeries: snapshot?.dailySeries || [],
    topProducts: snapshot?.topProducts || [],
    paymentMethodsSeries: snapshot?.paymentMethodsSeries || snapshot?.paymentMethods || [],
  };
}

function buildEmptyKpis() {
  return {
    today: { total: 0, count: 0 },
    month: { total: 0, count: 0, vs_prev: null },
    prev_month: { total: 0, count: 0 },
    year: { total: 0, count: 0 },
  };
}

function buildEmptyDailySeries(now = new Date()) {
  const series = [];
  for (let i = 29; i >= 0; i -= 1) {
    const day = new Date(now.getFullYear(), now.getMonth(), now.getDate() - i);
    series.push({
      date: day.toISOString().substring(0, 10),
      total: 0,
    });
  }
  return series;
}

function toNumber(value) {
  const parsed = Number(value || 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function areSameLocalDay(left, right) {
  return (
    left.getFullYear() === right.getFullYear() &&
    left.getMonth() === right.getMonth() &&
    left.getDate() === right.getDate()
  );
}

function formatVariantDashboardLabel(line) {
  const productName = String(line?.product_name || line?.productName || '').trim();
  const variantName = String(line?.variant_name || line?.variantName || '').trim();
  const sku = String(line?.sku || '').trim();

  const baseLabel =
    productName && variantName && productName.toLowerCase() !== variantName.toLowerCase()
      ? `${productName} (${variantName})`
      : productName || variantName || 'Producto';

  return sku ? `${baseLabel} - ${sku}` : baseLabel;
}

function mergeSaleIntoSnapshot(snapshot, salePayload = {}) {
  const now = new Date();
  const saleDate = salePayload?.sold_at ? new Date(salePayload.sold_at) : now;
  const effectiveSaleDate = Number.isNaN(saleDate.getTime()) ? now : saleDate;
  const normalized = normalizeDashboardSnapshot(snapshot);
  const baseKpis = normalized.kpis
    ? {
        today: {
          total: toNumber(normalized.kpis?.today?.total),
          count: toNumber(normalized.kpis?.today?.count),
        },
        month: {
          total: toNumber(normalized.kpis?.month?.total),
          count: toNumber(normalized.kpis?.month?.count),
          vs_prev: normalized.kpis?.month?.vs_prev ?? null,
        },
        prev_month: {
          total: toNumber(normalized.kpis?.prev_month?.total),
          count: toNumber(normalized.kpis?.prev_month?.count),
        },
        year: {
          total: toNumber(normalized.kpis?.year?.total),
          count: toNumber(normalized.kpis?.year?.count),
        },
      }
    : buildEmptyKpis();

  const payments = Array.isArray(salePayload?.payments) ? salePayload.payments : [];
  const lines = Array.isArray(salePayload?.lines) ? salePayload.lines : [];
  const paymentsTotal = payments.reduce((sum, payment) => sum + toNumber(payment?.amount), 0);
  const linesTotal = lines.reduce(
    (sum, line) => sum + Math.max(0, toNumber(line?.qty) * toNumber(line?.unit_price) - toNumber(line?.discount)),
    0,
  );
  const saleTotal = paymentsTotal > 0 ? paymentsTotal : linesTotal;

  const next = {
    kpis: baseKpis,
    dailySeries: Array.isArray(normalized.dailySeries) && normalized.dailySeries.length > 0
      ? normalized.dailySeries.map((item) => ({
          date: item?.date,
          total: toNumber(item?.total),
        }))
      : buildEmptyDailySeries(now),
    topProducts: Array.isArray(normalized.topProducts)
      ? normalized.topProducts.map((item) => ({
          name: item?.name || 'Producto',
          revenue: toNumber(item?.revenue),
          qty: toNumber(item?.qty),
        }))
      : [],
    paymentMethodsSeries: Array.isArray(normalized.paymentMethodsSeries)
      ? normalized.paymentMethodsSeries.map((item) => ({
          method: item?.method || 'Otro',
          total: toNumber(item?.total),
        }))
      : [],
  };

  if (effectiveSaleDate.getFullYear() === now.getFullYear()) {
    next.kpis.year.total += saleTotal;
    next.kpis.year.count += 1;
  }

  if (
    effectiveSaleDate.getFullYear() === now.getFullYear() &&
    effectiveSaleDate.getMonth() === now.getMonth()
  ) {
    next.kpis.month.total += saleTotal;
    next.kpis.month.count += 1;
  }

  if (areSameLocalDay(effectiveSaleDate, now)) {
    next.kpis.today.total += saleTotal;
    next.kpis.today.count += 1;
  }

  const prevMonthTotal = toNumber(next.kpis.prev_month?.total);
  next.kpis.month.vs_prev =
    prevMonthTotal > 0
      ? ((next.kpis.month.total - prevMonthTotal) / prevMonthTotal * 100).toFixed(1)
      : null;

  const saleDateKey = effectiveSaleDate.toISOString().substring(0, 10);
  const seriesIndex = next.dailySeries.findIndex((item) => item.date === saleDateKey);
  if (seriesIndex >= 0) {
    next.dailySeries[seriesIndex] = {
      ...next.dailySeries[seriesIndex],
      total: toNumber(next.dailySeries[seriesIndex]?.total) + saleTotal,
    };
  }

  if (lines.length > 0) {
    const topMap = new Map();
    next.topProducts.forEach((item) => {
      topMap.set(item.name, {
        name: item.name,
        revenue: toNumber(item.revenue),
        qty: toNumber(item.qty),
      });
    });

    lines.forEach((line) => {
      const label = formatVariantDashboardLabel(line);
      const current = topMap.get(label) || { name: label, revenue: 0, qty: 0 };
      current.qty += toNumber(line?.qty);
      current.revenue += Math.max(0, toNumber(line?.qty) * toNumber(line?.unit_price) - toNumber(line?.discount));
      topMap.set(label, current);
    });

    next.topProducts = Array.from(topMap.values())
      .sort((left, right) => right.revenue - left.revenue)
      .slice(0, 7);
  }

  if (payments.length > 0) {
    const methodsMap = new Map();
    next.paymentMethodsSeries.forEach((item) => {
      methodsMap.set(item.method, {
        method: item.method,
        total: toNumber(item.total),
      });
    });

    payments.forEach((payment) => {
      const method = String(payment?.payment_method_code || payment?.payment_method || 'Otro').trim() || 'Otro';
      const current = methodsMap.get(method) || { method, total: 0 };
      current.total += toNumber(payment?.amount);
      methodsMap.set(method, current);
    });

    next.paymentMethodsSeries = Array.from(methodsMap.values())
      .sort((left, right) => right.total - left.total);
  }

  return next;
}

/**
 * Gestiona el estado y la carga del dashboard (KPIs, series diarias, top productos, métodos de pago).
 */
export function useDashboard() {
  const [kpis, setKpis] = useState(null);
  const [dailySeries, setDailySeries] = useState([]);
  const [topProducts, setTopProducts] = useState([]);
  const [paymentMethodsSeries, setPaymentMethodsSeries] = useState([]);
  const [loadingKpis, setLoadingKpis] = useState(false);
  const lastSnapshotRef = useRef(null);
  const lastSnapshotTenantRef = useRef(null);

  const applySnapshot = useCallback((tenantId, snapshot) => {
    const normalized = normalizeDashboardSnapshot(snapshot);
    lastSnapshotRef.current = normalized;
    lastSnapshotTenantRef.current = tenantId || null;
    setKpis(normalized.kpis);
    setDailySeries(normalized.dailySeries);
    setTopProducts(normalized.topProducts);
    setPaymentMethodsSeries(normalized.paymentMethodsSeries);
    return normalized;
  }, []);

  const getCachedDashboard = useCallback(async (tenantId) => {
    if (!tenantId) return null;
    const cached = await getSimpleCache(buildDashboardCacheKey(tenantId));
    if (!cached?.value) return null;
    return {
      snapshot: normalizeDashboardSnapshot(cached.value),
      cachedAt: cached.cachedAt || null,
      isStale: isCacheStale(cached.cachedAt),
    };
  }, []);

  const applyPendingSaleToDashboard = useCallback(async (tenantId, salePayload = {}) => {
    if (!tenantId) {
      return { success: false, error: 'tenantId es requerido' };
    }

    const cached = await getCachedDashboard(tenantId);
    const baseSnapshot =
      (lastSnapshotTenantRef.current === tenantId && lastSnapshotRef.current)
        ? lastSnapshotRef.current
        : cached?.snapshot || null;

    const nextSnapshot = mergeSaleIntoSnapshot(baseSnapshot, salePayload);
    applySnapshot(tenantId, nextSnapshot);
    await saveSimpleCache(buildDashboardCacheKey(tenantId), nextSnapshot);

    return { success: true, data: nextSnapshot, source: baseSnapshot ? 'optimistic-merge' : 'optimistic-seed' };
  }, [applySnapshot, getCachedDashboard]);

  const loadDashboard = useCallback(async (tenantId, { offlineMode = false } = {}) => {
    if (!tenantId) {
      setKpis(null);
      setDailySeries([]);
      setTopProducts([]);
      setPaymentMethodsSeries([]);
      lastSnapshotRef.current = null;
      lastSnapshotTenantRef.current = null;
      return { success: false, error: 'tenantId es requerido' };
    }
    setLoadingKpis(true);
    try {
      if (offlineMode) {
        const cached = await getCachedDashboard(tenantId);
        if (cached?.snapshot) {
          applySnapshot(tenantId, cached.snapshot);
          return {
            success: true,
            data: cached.snapshot,
            source: 'cache',
            cachedAt: cached.cachedAt,
            isStale: cached.isStale,
          };
        }

        if (lastSnapshotTenantRef.current === tenantId && lastSnapshotRef.current) {
          return {
            success: true,
            data: lastSnapshotRef.current,
            source: 'memory',
          };
        }

        setKpis(null);
        setDailySeries([]);
        setTopProducts([]);
        setPaymentMethodsSeries([]);
        return { success: false, error: 'No hay dashboard cacheado para modo offline.' };
      }

      const result = await getDashboardSummary(tenantId);
      if (result.success) {
        const snapshot = applySnapshot(tenantId, {
          kpis: result.kpis,
          dailySeries: result.dailySeries || [],
          topProducts: result.topProducts || [],
          paymentMethodsSeries: result.paymentMethods || [],
        });
        await saveSimpleCache(buildDashboardCacheKey(tenantId), snapshot);
        return { success: true, data: snapshot, source: 'server' };
      }

      const cached = await getCachedDashboard(tenantId);
      if (cached?.snapshot) {
        applySnapshot(tenantId, cached.snapshot);
        return {
          success: true,
          data: cached.snapshot,
          source: 'cache-fallback',
          cachedAt: cached.cachedAt,
          isStale: cached.isStale,
          error: result.error,
        };
      }

      if (lastSnapshotTenantRef.current === tenantId && lastSnapshotRef.current) {
        return {
          success: true,
          data: lastSnapshotRef.current,
          source: 'memory-fallback',
          error: result.error,
        };
      }

      setKpis(null);
      setDailySeries([]);
      setTopProducts([]);
      setPaymentMethodsSeries([]);
      return result;
    } catch (_e) {
      const cached = await getCachedDashboard(tenantId);
      if (cached?.snapshot) {
        applySnapshot(tenantId, cached.snapshot);
        return {
          success: true,
          data: cached.snapshot,
          source: 'cache-fallback',
          cachedAt: cached.cachedAt,
          isStale: cached.isStale,
        };
      }

      if (lastSnapshotTenantRef.current === tenantId && lastSnapshotRef.current) {
        return {
          success: true,
          data: lastSnapshotRef.current,
          source: 'memory-fallback',
        };
      }

      setKpis(null);
      setDailySeries([]);
      setTopProducts([]);
      setPaymentMethodsSeries([]);
      return { success: false, error: 'No fue posible cargar dashboard.' };
    } finally {
      setLoadingKpis(false);
    }
  }, [applySnapshot, getCachedDashboard]);

  const resetDashboard = useCallback(() => {
    lastSnapshotRef.current = null;
    lastSnapshotTenantRef.current = null;
    setKpis(null);
    setDailySeries([]);
    setTopProducts([]);
    setPaymentMethodsSeries([]);
  }, []);

  return {
    kpis,
    dailySeries,
    topProducts,
    paymentMethodsSeries,
    loadingKpis,
    applyPendingSaleToDashboard,
    loadDashboard,
    resetDashboard,
  };
}
