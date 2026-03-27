import { useEffect, useRef, useState } from 'react';

const CONNECTIVITY_CHECK_INTERVAL_MS = 10000;
const CONNECTIVITY_TIMEOUT_MS = 6000;
const CONNECTIVITY_FAILURES_BEFORE_OFFLINE = 3;

/**
 * Monitorea la conectividad de red chequeando el health endpoint de Supabase.
 * Devuelve { networkReachable } que cambia a false tras 3 fallos consecutivos.
 */
export function useConnectivity() {
  const [networkReachable, setNetworkReachable] = useState(true);
  const connectivityFailuresRef = useRef(0);

  useEffect(() => {
    let active = true;
    let timer = null;

    const commitReachability = (nextReachable) => {
      if (!active) return;
      if (nextReachable) {
        connectivityFailuresRef.current = 0;
        setNetworkReachable(true);
        return;
      }
      connectivityFailuresRef.current += 1;
      if (connectivityFailuresRef.current >= CONNECTIVITY_FAILURES_BEFORE_OFFLINE) {
        setNetworkReachable(false);
      }
    };

    const checkConnectivity = async () => {
      const baseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL;
      const anonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
      if (!baseUrl) {
        commitReachability(true);
        return;
      }
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), CONNECTIVITY_TIMEOUT_MS);
      try {
        const response = await fetch(`${baseUrl}/auth/v1/health`, {
          method: 'GET',
          headers: anonKey ? { apikey: anonKey } : undefined,
          signal: controller.signal,
        });
        commitReachability(response.status < 500);
      } catch (_e) {
        commitReachability(false);
      } finally {
        clearTimeout(timeout);
      }
    };

    checkConnectivity();
    timer = setInterval(checkConnectivity, CONNECTIVITY_CHECK_INTERVAL_MS);

    return () => {
      active = false;
      if (timer) clearInterval(timer);
    };
  }, []);

  return { networkReachable };
}
