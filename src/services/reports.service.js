import { supabase } from '../lib/supabase';
import { getSimpleCache, saveSimpleCache } from './offlineCache.service';

function sumTotals(rows) {
  return (rows || []).reduce((acc, row) => acc + (parseFloat(row.total) || 0), 0);
}

function toNumber(value) {
  const parsed = Number(value || 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function getReportLocationsCacheKey(tenantId) {
  return `report-locations:${tenantId || 'na'}`;
}

function getStockAlertLevel(stockRow) {
  const onHand = toNumber(stockRow?.on_hand);
  const reserved = toNumber(stockRow?.reserved);
  const minStock = toNumber(stockRow?.variant?.min_stock);
  const available = onHand - reserved;

  if (onHand <= 0) return 'OUT_OF_STOCK';
  if (available <= 0) return 'NO_AVAILABLE';
  if (minStock > 0 && onHand <= minStock) return 'LOW_STOCK';
  if (minStock > 0 && available <= minStock) return 'LOW_AVAILABLE';
  return 'OK';
}

export async function getDashboardSummary(tenantId, locationId = null) {
  if (!tenantId) {
    return {
      success: false,
      error: 'tenantId es requerido',
      kpis: null,
      dailySeries: [],
      topProducts: [],
      paymentMethods: [],
    };
  }

  try {
    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
    const todayEnd = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59).toISOString();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
    const monthEnd = now.toISOString();
    const prevMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1).toISOString();
    const prevMonthEnd = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59).toISOString();
    const yearStart = new Date(now.getFullYear(), 0, 1).toISOString();
    const yearEnd = now.toISOString();

    const base = (from, to) => {
      let query = supabase
        .from('sales')
        .select('total, status, sold_at')
        .eq('tenant_id', tenantId)
        .in('status', ['COMPLETED', 'PARTIAL_RETURN'])
        .gte('sold_at', from)
        .lte('sold_at', to);

      if (locationId) query = query.eq('location_id', locationId);
      return query;
    };

    const last30Start = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 29).toISOString();

    const [rToday, rMonth, rPrevMonth, rYear, rLast30] = await Promise.all([
      base(todayStart, todayEnd),
      base(monthStart, monthEnd),
      base(prevMonthStart, prevMonthEnd),
      base(yearStart, yearEnd),
      base(last30Start, yearEnd),
    ]);

    if (rToday.error) throw rToday.error;
    if (rMonth.error) throw rMonth.error;
    if (rPrevMonth.error) throw rPrevMonth.error;
    if (rYear.error) throw rYear.error;
    if (rLast30.error) throw rLast30.error;

    const [rTopProductsSettled, rPaymentsSettled] = await Promise.allSettled([
      (() => {
        let query = supabase
          .from('sale_lines')
          .select(
            `
              variant_id,
              quantity,
              line_total,
              variant:variant_id(variant_name, product:product_id(name)),
              sale:sale_id!inner(tenant_id, status, sold_at, location_id)
            `,
          )
          .eq('sale.tenant_id', tenantId)
          .in('sale.status', ['COMPLETED', 'PARTIAL_RETURN'])
          .gte('sale.sold_at', monthStart)
          .lte('sale.sold_at', monthEnd);
        if (locationId) query = query.eq('sale.location_id', locationId);
        return query;
      })(),
      (() => {
        let query = supabase
          .from('sale_payments')
          .select(
            `
              amount,
              payment_method:payment_method_id(code, name),
              sale:sale_id!inner(tenant_id, status, sold_at, location_id)
            `,
          )
          .eq('sale.tenant_id', tenantId)
          .in('sale.status', ['COMPLETED', 'PARTIAL_RETURN'])
          .gte('sale.sold_at', monthStart)
          .lte('sale.sold_at', monthEnd);
        if (locationId) query = query.eq('sale.location_id', locationId);
        return query;
      })(),
    ]);

    const rTopProducts =
      rTopProductsSettled.status === 'fulfilled' && !rTopProductsSettled.value?.error
        ? rTopProductsSettled.value
        : { data: [], error: rTopProductsSettled.status === 'fulfilled' ? rTopProductsSettled.value?.error : rTopProductsSettled.reason };

    const rPayments =
      rPaymentsSettled.status === 'fulfilled' && !rPaymentsSettled.value?.error
        ? rPaymentsSettled.value
        : { data: [], error: rPaymentsSettled.status === 'fulfilled' ? rPaymentsSettled.value?.error : rPaymentsSettled.reason };

    const kpis = {
      today: { total: sumTotals(rToday.data), count: (rToday.data || []).length },
      month: { total: sumTotals(rMonth.data), count: (rMonth.data || []).length },
      prev_month: { total: sumTotals(rPrevMonth.data), count: (rPrevMonth.data || []).length },
      year: { total: sumTotals(rYear.data), count: (rYear.data || []).length },
    };

    kpis.month.vs_prev =
      kpis.prev_month.total > 0
        ? ((kpis.month.total - kpis.prev_month.total) / kpis.prev_month.total * 100).toFixed(1)
        : null;

    const dailyMap = {};
    for (let i = 29; i >= 0; i -= 1) {
      const day = new Date(now.getFullYear(), now.getMonth(), now.getDate() - i);
      const key = day.toISOString().substring(0, 10);
      dailyMap[key] = 0;
    }
    (rLast30.data || []).forEach((sale) => {
      const key = String(sale.sold_at || '').substring(0, 10);
      if (key in dailyMap) {
        dailyMap[key] += parseFloat(sale.total) || 0;
      }
    });
    const dailySeries = Object.entries(dailyMap).map(([date, total]) => ({ date, total }));

    const productMap = {};
    (rTopProducts.data || []).forEach((line) => {
      const key = line.variant_id || 'unknown';
      if (!productMap[key]) {
        productMap[key] = {
          name:
            (line.variant?.product?.name || 'Producto') +
            (line.variant?.variant_name ? ` (${line.variant.variant_name})` : ''),
          revenue: 0,
          qty: 0,
        };
      }
      productMap[key].revenue += parseFloat(line.line_total) || 0;
      productMap[key].qty += parseFloat(line.quantity) || 0;
    });
    const topProducts = Object.values(productMap)
      .sort((a, b) => b.revenue - a.revenue)
      .slice(0, 7);

    const paymentMap = {};
    (rPayments.data || []).forEach((payment) => {
      const key = payment.payment_method?.name || payment.payment_method?.code || 'Otro';
      if (!paymentMap[key]) paymentMap[key] = 0;
      paymentMap[key] += parseFloat(payment.amount) || 0;
    });
    const paymentMethods = Object.entries(paymentMap).map(([method, total]) => ({ method, total }));

    return { success: true, kpis, dailySeries, topProducts, paymentMethods };
  } catch (error) {
    return {
      success: false,
      error: error.message,
      kpis: null,
      dailySeries: [],
      topProducts: [],
      paymentMethods: [],
    };
  }
}

function normalizeDateInput(value, fallbackDate) {
  if (!value) return fallbackDate;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return fallbackDate;
  return parsed;
}

function toIsoStartOfDay(dateValue) {
  const d = new Date(dateValue);
  d.setHours(0, 0, 0, 0);
  return d.toISOString();
}

function toIsoEndOfDay(dateValue) {
  const d = new Date(dateValue);
  d.setHours(23, 59, 59, 999);
  return d.toISOString();
}

function buildDateRange({ fromDate, toDate }) {
  const now = new Date();
  const fallbackFrom = new Date(now.getFullYear(), now.getMonth(), 1);
  const fallbackTo = now;
  const from = normalizeDateInput(fromDate, fallbackFrom);
  const to = normalizeDateInput(toDate, fallbackTo);

  if (from.getTime() > to.getTime()) {
    return {
      fromIso: toIsoStartOfDay(to),
      toIso: toIsoEndOfDay(from),
      fromDate: to,
      toDate: from,
    };
  }

  return {
    fromIso: toIsoStartOfDay(from),
    toIso: toIsoEndOfDay(to),
    fromDate: from,
    toDate: to,
  };
}

function withLocationFilter(query, locationId, field = 'location_id') {
  if (!locationId) return query;
  return query.eq(field, locationId);
}

export async function listReportLocations(tenantId) {
  if (!tenantId) {
    return { success: false, error: 'tenantId es requerido', data: [] };
  }

  const cacheKey = getReportLocationsCacheKey(tenantId);

  try {
    const { data, error } = await supabase
      .from('locations')
      .select('location_id,name')
      .eq('tenant_id', tenantId)
      .eq('is_active', true)
      .order('name', { ascending: true });

    if (error) throw error;
    const rows = data || [];
    await saveSimpleCache(cacheKey, rows);
    return { success: true, data: rows };
  } catch (error) {
    const cached = await getSimpleCache(cacheKey);
    if (cached?.value) {
      return { success: true, data: cached.value, source: 'cache', warning: error.message };
    }
    return { success: false, error: error.message, data: [] };
  }
}

export async function getReportsSnapshot({ tenantId, fromDate, toDate, locationId = null }) {
  if (!tenantId) {
    return { success: false, error: 'tenantId es requerido', data: null };
  }

  try {
    const range = buildDateRange({ fromDate, toDate });

    const salesQuery = withLocationFilter(
      supabase
        .from('sales')
        .select(
          `
            sale_id,
            subtotal,
            discount_total,
            tax_total,
            total,
            status,
            sold_at,
            cash_session_id,
            sold_by,
            location_id
          `,
        )
        .eq('tenant_id', tenantId)
        .in('status', ['COMPLETED', 'PARTIAL_RETURN', 'RETURNED'])
        .gte('sold_at', range.fromIso)
        .lte('sold_at', range.toIso),
      locationId,
    );

    const paymentsQuery = supabase
      .from('sale_payments')
      .select(
        `
          amount,
          payment_method:payment_method_id(code,name),
          sale:sale_id!inner(tenant_id,status,sold_at,location_id)
        `,
      )
      .eq('sale.tenant_id', tenantId)
      .in('sale.status', ['COMPLETED', 'PARTIAL_RETURN', 'RETURNED'])
      .gte('sale.sold_at', range.fromIso)
      .lte('sale.sold_at', range.toIso);

    const filteredPaymentsQuery = locationId ? paymentsQuery.eq('sale.location_id', locationId) : paymentsQuery;

    const sessionsQuery = supabase
      .from('cash_sessions')
      .select(
        `
          cash_session_id,
          status,
          opening_amount,
          closing_amount_counted,
          closing_amount_expected,
          difference,
          opened_at,
          closed_at,
          cash_register:cash_register_id(cash_register_id,name,location_id,location:location_id(name,location_id)),
          opened_by_user:opened_by(full_name),
          closed_by_user:closed_by(full_name)
        `,
      )
      .eq('tenant_id', tenantId)
      .gte('opened_at', range.fromIso)
      .lte('opened_at', range.toIso);

    const stocksQuery = withLocationFilter(
      supabase
        .from('stock_balances')
        .select(
          `
            on_hand,
            reserved,
            location_id,
            location:location_id(name),
            variant:variant_id(
              variant_id,
              sku,
              variant_name,
              min_stock,
              cost,
              is_component,
              product:product_id(product_id,name,category:category_id(name))
            )
          `,
        )
        .eq('tenant_id', tenantId),
      locationId,
    );

    const sellersQuery = supabase
      .from('users')
      .select('user_id,full_name')
      .eq('tenant_id', tenantId);

    const salesLinesQuery = supabase
      .from('sale_lines')
      .select(
        `
          quantity,
          line_total,
          unit_cost,
          variant:variant_id(
            variant_id,
            sku,
            variant_name,
            cost,
            product:product_id(name,category:category_id(name))
          ),
          sale:sale_id!inner(tenant_id,status,sold_at,location_id)
        `,
      )
      .eq('sale.tenant_id', tenantId)
      .in('sale.status', ['COMPLETED', 'PARTIAL_RETURN', 'RETURNED'])
      .gte('sale.sold_at', range.fromIso)
      .lte('sale.sold_at', range.toIso);

    const filteredSalesLinesQuery = locationId
      ? salesLinesQuery.eq('sale.location_id', locationId)
      : salesLinesQuery;

    const cashMovementsQuery = supabase
      .from('cash_movements')
      .select(
        `
          cash_movement_id,
          type,
          amount,
          category,
          note,
          created_at,
          cash_session_id,
          created_by_user:created_by(full_name),
          session:cash_session_id(
            cash_register:cash_register_id(name,location:location_id(name,location_id))
          )
        `,
      )
      .eq('tenant_id', tenantId)
      .gte('created_at', range.fromIso)
      .lte('created_at', range.toIso);

    const productionOrdersQuery = withLocationFilter(
      supabase
        .from('production_orders')
        .select(
          `
            production_order_id,
            status,
            quantity_planned,
            quantity_produced,
            created_at,
            completed_at,
            location_id,
            bom:bom_id(bom_name,product:product_id(name),variant:variant_id(variant_name))
          `,
        )
        .eq('tenant_id', tenantId)
        .gte('created_at', range.fromIso)
        .lte('created_at', range.toIso),
      locationId,
    );

    const layawayQuery = (() => {
      let query = supabase
        .from('vw_layaway_report')
        .select('layaway_id,customer_name,status,created_at,due_date,total,paid_total,balance,location_id')
        .eq('tenant_id', tenantId)
        .gte('created_at', range.fromIso)
        .lte('created_at', range.toIso);
      if (locationId) query = query.eq('location_id', locationId);
      return query;
    })();

    const [salesRes, paymentsRes, sessionsRes, stocksRes, sellersRes, linesRes, movementsRes, productionRes, layawayRes] = await Promise.allSettled([
      salesQuery,
      filteredPaymentsQuery,
      sessionsQuery,
      stocksQuery,
      sellersQuery,
      filteredSalesLinesQuery,
      cashMovementsQuery,
      productionOrdersQuery,
      layawayQuery,
    ]);

    const unwrap = (result) => {
      if (result.status !== 'fulfilled') throw result.reason;
      if (result.value?.error) throw result.value.error;
      return result.value;
    };

    const salesResult = unwrap(salesRes);
    const paymentsResult = unwrap(paymentsRes);
    const sessionsResult = unwrap(sessionsRes);
    const stocksResult = unwrap(stocksRes);
    const sellersResult = unwrap(sellersRes);
    const linesResult = unwrap(linesRes);
    const movementsResult = unwrap(movementsRes);
    const productionResult = unwrap(productionRes);

    const layawayResult =
      layawayRes.status === 'fulfilled' && !layawayRes.value?.error
        ? layawayRes.value
        : { data: [] };

    const sales = salesResult.data || [];
    const sessionsRaw = sessionsResult.data || [];
    const sessions = locationId
      ? sessionsRaw.filter(
          (session) =>
            session.cash_register?.location_id === locationId ||
            session.cash_register?.location?.location_id === locationId,
        )
      : sessionsRaw;
    const payments = paymentsResult.data || [];
    const stocks = stocksResult.data || [];
    const saleLines = linesResult.data || [];
    const allCashMovements = movementsResult.data || [];
    const productionOrders = productionResult.data || [];
    const layawayContracts = layawayResult.data || [];
    const sellerMap = new Map((sellersResult.data || []).map((s) => [s.user_id, s.full_name]));

    const grossTotal = sales.reduce((sum, sale) => {
      if (sale.status === 'RETURNED' || sale.status === 'PARTIAL_RETURN') return sum;
      return sum + toNumber(sale.total);
    }, 0);
    const returnsTotal = sales.reduce((sum, sale) => {
      if (sale.status !== 'RETURNED' && sale.status !== 'PARTIAL_RETURN') return sum;
      return sum + Math.abs(toNumber(sale.total));
    }, 0);
    const netTotal = grossTotal - returnsTotal;
    const grossDiscount = sales.reduce((sum, sale) => {
      if (sale.status === 'RETURNED' || sale.status === 'PARTIAL_RETURN') return sum;
      return sum + toNumber(sale.discount_total);
    }, 0);
    const grossTax = sales.reduce((sum, sale) => {
      if (sale.status === 'RETURNED' || sale.status === 'PARTIAL_RETURN') return sum;
      return sum + toNumber(sale.tax_total);
    }, 0);

    const salesByDayMap = {};
    sales.forEach((sale) => {
      const day = String(sale.sold_at || '').slice(0, 10);
      if (!day) return;
      if (!salesByDayMap[day]) {
        salesByDayMap[day] = {
          date: day,
          count: 0,
          gross_total: 0,
          returns_total: 0,
          net_total: 0,
        };
      }
      salesByDayMap[day].count += 1;
      const amount = Math.abs(toNumber(sale.total));
      if (sale.status === 'RETURNED' || sale.status === 'PARTIAL_RETURN') {
        salesByDayMap[day].returns_total += amount;
      } else {
        salesByDayMap[day].gross_total += amount;
      }
      salesByDayMap[day].net_total =
        salesByDayMap[day].gross_total - salesByDayMap[day].returns_total;
    });
    const salesByDay = Object.values(salesByDayMap).sort((a, b) => (a.date > b.date ? -1 : 1));

    const paymentMap = {};
    payments.forEach((payment) => {
      const code = payment.payment_method?.code || 'N/A';
      const name = payment.payment_method?.name || payment.payment_method?.code || 'Otro';
      if (!paymentMap[code]) paymentMap[code] = { code, name, count: 0, total: 0 };
      paymentMap[code].count += 1;
      paymentMap[code].total += toNumber(payment.amount);
    });
    const salesByPaymentMethod = Object.values(paymentMap).sort((a, b) => b.total - a.total);

    const sellerStats = {};
    sales.forEach((sale) => {
      const sellerId = sale.sold_by || 'unknown';
      if (!sellerStats[sellerId]) {
        sellerStats[sellerId] = {
          user_id: sellerId,
          name: sellerMap.get(sellerId) || 'Sin vendedor',
          count: 0,
          total: 0,
        };
      }
      sellerStats[sellerId].count += 1;
      sellerStats[sellerId].total += toNumber(sale.total);
    });
    const salesBySeller = Object.values(sellerStats).sort((a, b) => b.total - a.total);

    const topProductsMap = {};
    const categoriesMap = {};
    saleLines.forEach((line) => {
      const quantity = toNumber(line.quantity);
      const lineRevenue = toNumber(line.line_total);
      const unitCost = toNumber(line.unit_cost || line.variant?.cost);
      const lineCost = unitCost * quantity;
      const variantId = line.variant?.variant_id || line.variant_id || 'unknown';
      const sku = line.variant?.sku || '';
      const productName = line.variant?.product?.name || 'Producto';
      const variantName = line.variant?.variant_name || '';
      const categoryName = line.variant?.product?.category?.name || 'Sin categoría';

      if (!topProductsMap[variantId]) {
        topProductsMap[variantId] = {
          variant_id: variantId,
          sku,
          product_name: productName,
          variant_name: variantName,
          total_qty: 0,
          total_revenue: 0,
          total_cost: 0,
          profit: 0,
        };
      }
      topProductsMap[variantId].total_qty += quantity;
      topProductsMap[variantId].total_revenue += lineRevenue;
      topProductsMap[variantId].total_cost += lineCost;
      topProductsMap[variantId].profit =
        topProductsMap[variantId].total_revenue - topProductsMap[variantId].total_cost;

      if (!categoriesMap[categoryName]) {
        categoriesMap[categoryName] = {
          category: categoryName,
          qty: 0,
          revenue: 0,
          cost: 0,
          profit: 0,
          margin: 0,
        };
      }
      categoriesMap[categoryName].qty += quantity;
      categoriesMap[categoryName].revenue += lineRevenue;
      categoriesMap[categoryName].cost += lineCost;
      categoriesMap[categoryName].profit =
        categoriesMap[categoryName].revenue - categoriesMap[categoryName].cost;
      categoriesMap[categoryName].margin =
        categoriesMap[categoryName].revenue > 0
          ? Number(
              (
                (categoriesMap[categoryName].profit / categoriesMap[categoryName].revenue) *
                100
              ).toFixed(1),
            )
          : 0;
    });

    const topProducts = Object.values(topProductsMap)
      .sort((a, b) => b.total_qty - a.total_qty)
      .slice(0, 20);
    const salesByCategory = Object.values(categoriesMap).sort((a, b) => b.revenue - a.revenue);

    const salesBySession = {};
    const sessionLookup = new Map();
    sessions.forEach((session) => {
      sessionLookup.set(session.cash_session_id, session);
    });
    sales.forEach((sale) => {
      const key = sale.cash_session_id || 'na';
      if (!salesBySession[key]) salesBySession[key] = { count: 0, total: 0 };
      salesBySession[key].count += 1;
      salesBySession[key].total += toNumber(sale.total);
    });

    const sessionsWithSales = sessions.map((session) => {
      const sessionSales = salesBySession[session.cash_session_id] || { count: 0, total: 0 };
      const openingAmount = toNumber(session.opening_amount);
      const closingAmount = toNumber(session.closing_amount_expected);
      const declaredAmount = toNumber(session.closing_amount_counted);
      const diffAmount = toNumber(session.difference);
      const durationMinutes =
        session.opened_at && session.closed_at
          ? Math.round((new Date(session.closed_at).getTime() - new Date(session.opened_at).getTime()) / 60000)
          : null;

      return {
        ...session,
        register_name: session.cash_register?.name || 'Caja',
        location: session.cash_register?.location?.name || '-',
        opened_by: session.opened_by_user?.full_name || '',
        closed_by: session.closed_by_user?.full_name || '',
        opening_amount: openingAmount,
        closing_amount: closingAmount,
        declared_amount: declaredAmount,
        sales_count: sessionSales.count,
        sales_total: sessionSales.total,
        avg_per_sale: sessionSales.count > 0 ? sessionSales.total / sessionSales.count : 0,
        difference: diffAmount,
        has_difference: Math.abs(diffAmount) > 0.01,
        duration_minutes: durationMinutes,
      };
    });
    const sessionsWithDiff = sessionsWithSales.filter(
      (session) => session.has_difference,
    );

    const salesByCashRegisterMap = {};
    sales.forEach((sale) => {
      const sessionInfo = sessionLookup.get(sale.cash_session_id);
      const registerId = sessionInfo?.cash_register?.cash_register_id || 'sin_caja';
      const registerName = sessionInfo?.cash_register?.name || 'Sin caja';
      const registerLocation = sessionInfo?.cash_register?.location?.name || '-';

      if (!salesByCashRegisterMap[registerId]) {
        salesByCashRegisterMap[registerId] = {
          cash_register_id: registerId,
          name: registerName,
          location: registerLocation,
          count: 0,
          total: 0,
        };
      }

      salesByCashRegisterMap[registerId].count += 1;
      salesByCashRegisterMap[registerId].total += toNumber(sale.total);
    });
    const salesByCashRegister = Object.values(salesByCashRegisterMap).sort((a, b) => b.total - a.total);

    const totalInventoryValue = stocks.reduce(
      (sum, row) => sum + toNumber(row.on_hand) * toNumber(row.variant?.cost),
      0,
    );
    const lowStockRows = stocks.filter(
      (row) => toNumber(row.variant?.min_stock) > 0 && toNumber(row.on_hand) <= toNumber(row.variant?.min_stock),
    );
    const outOfStockRows = stocks.filter((row) => toNumber(row.on_hand) <= 0);

    const stockAlerts = stocks
      .map((row) => {
        const onHand = toNumber(row.on_hand);
        const reserved = toNumber(row.reserved);
        const available = onHand - reserved;
        const minStock = toNumber(row.variant?.min_stock);
        const alertLevel = getStockAlertLevel(row);

        return {
          location_id: row.location_id,
          location_name: row.location?.name || '',
          variant_id: row.variant?.variant_id || null,
          sku: row.variant?.sku || '',
          product_id: row.variant?.product?.product_id || null,
          product_name: row.variant?.product?.name || 'Producto',
          variant_name: row.variant?.variant_name || '',
          on_hand: onHand,
          available,
          min_stock: minStock,
          reserved,
          alert_level: alertLevel,
        };
      })
      .filter((row) => row.alert_level !== 'OK')
      .sort((left, right) => left.available - right.available);

    const sessionIds = new Set((sessions || []).map((s) => s.cash_session_id));
    const cashMovements = locationId
      ? allCashMovements.filter((move) => sessionIds.has(move.cash_session_id))
      : allCashMovements;

    let movementIncome = 0;
    let movementExpense = 0;
    let movementIncomeCount = 0;
    let movementExpenseCount = 0;
    cashMovements.forEach((move) => {
      const amount = toNumber(move.amount);
      if (move.type === 'INCOME') {
        movementIncome += amount;
        movementIncomeCount += 1;
      } else {
        movementExpense += amount;
        movementExpenseCount += 1;
      }
    });

    const estimatedCost = saleLines.reduce(
      (sum, line) => sum + toNumber(line.quantity) * toNumber(line.unit_cost || line.variant?.cost),
      0,
    );
    const grossMargin = netTotal - estimatedCost;

    const layawaySummary = {
      total_contracts: layawayContracts.length,
      active_contracts: layawayContracts.filter((item) => item.status === 'ACTIVE').length,
      completed_contracts: layawayContracts.filter((item) => item.status === 'COMPLETED').length,
      cancelled_contracts: layawayContracts.filter((item) => item.status === 'CANCELLED').length,
      expired_contracts: layawayContracts.filter((item) => item.status === 'EXPIRED').length,
      total_value: layawayContracts.reduce((sum, item) => sum + toNumber(item.total), 0),
      total_paid: layawayContracts.reduce((sum, item) => sum + toNumber(item.paid_total), 0),
      total_balance: layawayContracts.reduce((sum, item) => sum + toNumber(item.balance), 0),
    };

    const productionSummary = {
      total_orders: productionOrders.length,
      planned_qty: productionOrders.reduce((sum, o) => sum + toNumber(o.quantity_planned), 0),
      produced_qty: productionOrders.reduce((sum, o) => sum + toNumber(o.quantity_produced), 0),
      completed_orders: productionOrders.filter((o) => o.status === 'COMPLETED').length,
      in_progress_orders: productionOrders.filter((o) => o.status === 'IN_PROGRESS').length,
      draft_orders: productionOrders.filter((o) => o.status === 'DRAFT').length,
    };

    return {
      success: true,
      data: {
        range: {
          from: range.fromDate.toISOString().slice(0, 10),
          to: range.toDate.toISOString().slice(0, 10),
        },
        sales: {
          summary: {
            total_sales: sales.length,
            gross_total: grossTotal,
            returns_total: returnsTotal,
            net_total: netTotal,
            gross_discount: grossDiscount,
            gross_tax: grossTax,
          },
          by_day: salesByDay,
          top_products: topProducts,
          by_category: salesByCategory,
          by_payment_method: salesByPaymentMethod,
          by_seller: salesBySeller,
          cash_movements_summary: {
            total_income: movementIncome,
            total_expense: movementExpense,
            count_income: movementIncomeCount,
            count_expense: movementExpenseCount,
            net: movementIncome - movementExpense,
          },
          cash_movements: cashMovements
            .map((move) => ({
              cash_movement_id: move.cash_movement_id,
              type: move.type,
              amount: toNumber(move.amount),
              category: move.category || '',
              note: move.note || '',
              created_at: move.created_at,
              created_by_name: move.created_by_user?.full_name || '',
              register_name: move.session?.cash_register?.name || '-',
              location_name: move.session?.cash_register?.location?.name || '-',
            }))
            .sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')))
            .slice(0, 80),
          layaway_summary: layawaySummary,
          layaway_contracts: layawayContracts
            .map((contract) => ({
              layaway_id: contract.layaway_id,
              customer_name: contract.customer_name || 'Cliente',
              status: contract.status || 'ACTIVE',
              created_at: contract.created_at,
              due_date: contract.due_date,
              total: toNumber(contract.total),
              paid_total: toNumber(contract.paid_total),
              balance: toNumber(contract.balance),
            }))
            .sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')))
            .slice(0, 80),
          stock_alerts: stockAlerts.slice(0, 120),
        },
        cash: {
          summary: {
            sessions_count: sessionsWithSales.length,
            sessions_with_difference: sessionsWithDiff.length,
            transactions_count: sales.length,
            sales_total: sales.reduce((sum, sale) => sum + toNumber(sale.total), 0),
          },
          by_cash_register: salesByCashRegister,
          sessions: sessionsWithSales
            .sort((a, b) => String(b.opened_at || '').localeCompare(String(a.opened_at || '')))
            .slice(0, 80),
          sessions_with_difference: sessionsWithDiff
            .sort((a, b) => Math.abs(Number(b.difference || 0)) - Math.abs(Number(a.difference || 0)))
            .slice(0, 50),
        },
        inventory: {
          summary: {
            rows: stocks.length,
            low_stock: lowStockRows.length,
            out_of_stock: outOfStockRows.length,
            inventory_value: totalInventoryValue,
          },
          stock_alerts: stockAlerts.slice(0, 120),
          low_stock_items: lowStockRows
            .map((row) => ({
              product_name: row.variant?.product?.name || 'Producto',
              on_hand: toNumber(row.on_hand),
              min_stock: toNumber(row.variant?.min_stock),
              cost: toNumber(row.variant?.cost),
            }))
            .sort((a, b) => a.on_hand - b.on_hand)
            .slice(0, 60),
          out_of_stock_items: outOfStockRows
            .map((row) => ({
              product_name: row.variant?.product?.name || 'Producto',
              on_hand: toNumber(row.on_hand),
              min_stock: toNumber(row.variant?.min_stock),
            }))
            .slice(0, 60),
        },
        financial: {
          summary: {
            net_sales: netTotal,
            estimated_cost: estimatedCost,
            gross_margin: grossMargin,
            movement_income: movementIncome,
            movement_expense: movementExpense,
            net_result: grossMargin + movementIncome - movementExpense,
          },
          cash_movements: cashMovements
            .map((move) => ({
              cash_movement_id: move.cash_movement_id,
              type: move.type,
              amount: toNumber(move.amount),
              category: move.category || '',
              created_at: move.created_at,
              created_by_name: move.created_by_user?.full_name || '',
              register_name: move.session?.cash_register?.name || '-',
              location_name: move.session?.cash_register?.location?.name || '-',
            }))
            .sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')))
            .slice(0, 80),
        },
        production: {
          summary: productionSummary,
          orders: productionOrders
            .map((order) => ({
              production_order_id: order.production_order_id,
              status: order.status,
              quantity_planned: toNumber(order.quantity_planned),
              quantity_produced: toNumber(order.quantity_produced),
              created_at: order.created_at,
              completed_at: order.completed_at,
              bom_name: order.bom?.bom_name || '',
              product_name: order.bom?.product?.name || '',
              variant_name: order.bom?.variant?.variant_name || '',
            }))
            .sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')))
            .slice(0, 80),
        },
      },
    };
  } catch (error) {
    return { success: false, error: error.message, data: null };
  }
}
