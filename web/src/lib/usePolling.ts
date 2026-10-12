import { useCallback, useEffect, useRef, useState } from 'react';

/** Charge des données puis les rafraîchit automatiquement toutes les `intervalMs` millisecondes. */
export function usePolling<T>(fetcher: () => Promise<T>, deps: unknown[], intervalMs: number) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const requestId = useRef(0);

  const load = useCallback(fetcher, deps);

  const reload = useCallback(async () => {
    const id = ++requestId.current;
    try {
      const result = await load();
      if (id !== requestId.current) return;
      setData(result);
      setError(null);
    } catch (err) {
      if (id !== requestId.current) return;
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      if (id === requestId.current) setLoading(false);
    }
  }, [load]);

  useEffect(() => {
    setLoading(true);
    setData(null);
    reload();
    if (intervalMs <= 0) return;
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') reload();
    }, intervalMs);
    return () => clearInterval(timer);
  }, [reload, intervalMs]);

  return { data, error, loading, reload, setData };
}

/** Renvoie l'heure actuelle, mise à jour régulièrement (pour les « il y a 12 s »). */
export function useNow(intervalMs = 5000): number {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(t);
  }, [intervalMs]);
  return now;
}
