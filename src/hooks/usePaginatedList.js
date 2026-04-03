import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { getLatestPageCache, getPageCache, isCacheStale, savePageCache } from '../services/offlineCache.service';

export function usePaginatedList({
  tenantId,
  pageSize,
  offlineMode,
  cacheNamespace,
  fetchPage,
  fetchOfflinePage,
  initialFilters = {},
}) {
  const [items, setItems] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [filters, setFilters] = useState(initialFilters);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [cacheInfo, setCacheInfo] = useState(null);
  const mountedRef = useRef(true);
  const requestSeqRef = useRef(0);

  useEffect(() => () => {
    mountedRef.current = false;
  }, []);

  const totalPages = useMemo(
    () => Math.max(1, Math.ceil((total || 0) / (Number(pageSize) || 20))),
    [total, pageSize],
  );

  const loadPage = useCallback(
    async (nextPage = page, nextFilters = filters, options = {}) => {
      if (!tenantId || !fetchPage) return;

      const isRefresh = options?.refresh === true;
      const requestId = requestSeqRef.current + 1;
      requestSeqRef.current = requestId;
      const isCurrentRequest = () => mountedRef.current && requestSeqRef.current === requestId;
      const applyState = (callback) => {
        if (!isCurrentRequest()) return false;
        callback();
        return true;
      };
      const finishLoading = () => applyState(() => {
        if (isRefresh) setRefreshing(false);
        else setLoading(false);
      });

      if (isRefresh) {
        setRefreshing(true);
      } else {
        setLoading(true);
      }
      setError('');

      if (offlineMode) {
        if (fetchOfflinePage) {
          const offlineResult = await fetchOfflinePage({
            tenantId,
            page: nextPage,
            pageSize,
            filters: nextFilters,
          });

          if (offlineResult?.success) {
            const nextItems = offlineResult.data || [];
            const nextTotal = Number(offlineResult.total || 0);
            if (!applyState(() => {
              setItems(nextItems);
              setTotal(nextTotal);
              setCacheInfo({
                source: offlineResult.source || 'offline-local',
                cachedAt: offlineResult.cachedAt || new Date().toISOString(),
              });
            })) return;
            await savePageCache({
              namespace: cacheNamespace,
              tenantId,
              page: nextPage,
              pageSize,
              filters: nextFilters,
              items: nextItems,
              total: nextTotal,
            });
            finishLoading();
            return;
          }
        }

        const exactCached = await getPageCache({
          namespace: cacheNamespace,
          tenantId,
          page: nextPage,
          pageSize,
          filters: nextFilters,
        });

        const cached =
          exactCached ||
          (await getLatestPageCache({
            namespace: cacheNamespace,
            tenantId,
          }));

        if (cached) {
          const stale = isCacheStale(cached.cachedAt);
          if (!applyState(() => {
            setItems(cached.items || []);
            setTotal(Number(cached.total || 0));
            setCacheInfo({
              source: exactCached ? 'cache' : 'cache-latest',
              cachedAt: cached.cachedAt || null,
              isStale: stale,
            });
            if (stale) setError('Datos desactualizados (más de 24h). Reconéctate para actualizar.');
          })) return;
          finishLoading();
          return;
        }

        if (!applyState(() => {
          setItems([]);
          setTotal(0);
          setError('No hay cache local para este listado/filtro en modo offline.');
          setCacheInfo({ source: 'cache-miss', cachedAt: null });
        })) return;
        finishLoading();
        return;
      }

      const result = await fetchPage({
        tenantId,
        page: nextPage,
        pageSize,
        filters: nextFilters,
      });

      if (!result?.success) {
        const exactFallback = await getPageCache({
          namespace: cacheNamespace,
          tenantId,
          page: nextPage,
          pageSize,
          filters: nextFilters,
        });

        const fallback =
          exactFallback ||
          (await getLatestPageCache({
            namespace: cacheNamespace,
            tenantId,
          }));

        if (fallback) {
          const stale = isCacheStale(fallback.cachedAt);
          if (!applyState(() => {
            setItems(fallback.items || []);
            setTotal(Number(fallback.total || 0));
            setError(
              stale
                ? 'Sin conexión. Cache desactualizado (más de 24h).'
                : (result?.error || 'Sin conexión. Mostrando cache local.'),
            );
            setCacheInfo({
              source: exactFallback ? 'cache' : 'cache-latest',
              cachedAt: fallback.cachedAt || null,
              isStale: stale,
            });
          })) return;
        } else {
          if (!applyState(() => {
            setItems([]);
            setTotal(0);
            setError(result?.error || 'No fue posible cargar listado.');
            setCacheInfo({ source: 'none', cachedAt: null });
          })) return;
        }

        finishLoading();
        return;
      }

      const nextItems = result.data || [];
      const nextTotal = Number(result.total || 0);
      if (!applyState(() => {
        setItems(nextItems);
        setTotal(nextTotal);
        setCacheInfo({ source: 'server', cachedAt: new Date().toISOString() });
      })) return;

      await savePageCache({
        namespace: cacheNamespace,
        tenantId,
        page: nextPage,
        pageSize,
        filters: nextFilters,
        items: nextItems,
        total: nextTotal,
      });

      finishLoading();
    },
    [cacheNamespace, fetchOfflinePage, fetchPage, filters, offlineMode, page, pageSize, tenantId],
  );

  const changePage = useCallback(
    async (nextPage) => {
      if (nextPage < 1 || nextPage > totalPages) return;
      setPage(nextPage);
      await loadPage(nextPage, filters);
    },
    [filters, loadPage, totalPages],
  );

  const updateFilters = useCallback(
    async (nextFilters) => {
      const merged = { ...filters, ...nextFilters };
      setFilters(merged);
      setPage(1);
      await loadPage(1, merged);
    },
    [filters, loadPage],
  );

  const reload = useCallback(async () => {
    await loadPage(page, filters, { refresh: true });
  }, [filters, loadPage, page]);

  useEffect(() => {
    loadPage(1, filters);
    setPage(1);
  }, [tenantId, pageSize, offlineMode]);

  return {
    items,
    total,
    page,
    totalPages,
    filters,
    loading,
    refreshing,
    error,
    cacheInfo,
    setError,
    changePage,
    updateFilters,
    reload,
    setFilters,
    loadPage,
  };
}
