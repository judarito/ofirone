import { useCallback, useState } from 'react';
import { getDashboardSummary } from '../services/reports.service';

/**
 * Gestiona el estado y la carga del dashboard (KPIs, series diarias, top productos, métodos de pago).
 */
export function useDashboard() {
  const [kpis, setKpis] = useState(null);
  const [dailySeries, setDailySeries] = useState([]);
  const [topProducts, setTopProducts] = useState([]);
  const [paymentMethodsSeries, setPaymentMethodsSeries] = useState([]);
  const [loadingKpis, setLoadingKpis] = useState(false);

  const loadDashboard = useCallback(async (tenantId) => {
    if (!tenantId) {
      setKpis(null);
      setDailySeries([]);
      setTopProducts([]);
      setPaymentMethodsSeries([]);
      return;
    }
    setLoadingKpis(true);
    try {
      const result = await getDashboardSummary(tenantId);
      if (result.success) {
        setKpis(result.kpis);
        setDailySeries(result.dailySeries || []);
        setTopProducts(result.topProducts || []);
        setPaymentMethodsSeries(result.paymentMethods || []);
        return;
      }
      setKpis(null);
      setDailySeries([]);
      setTopProducts([]);
      setPaymentMethodsSeries([]);
    } catch (_e) {
      setKpis(null);
      setDailySeries([]);
      setTopProducts([]);
      setPaymentMethodsSeries([]);
    } finally {
      setLoadingKpis(false);
    }
  }, []);

  const resetDashboard = useCallback(() => {
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
    loadDashboard,
    resetDashboard,
  };
}
