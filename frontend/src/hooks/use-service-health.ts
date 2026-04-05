
import { useCallback, useEffect, useState } from 'react';

interface ServiceInfo {
  name: string;
  status: 'online' | 'offline' | 'checking';
}

export interface ServicesHealth {
  all_online: boolean;
  probe_ms?: number;
  checked_at?: string;
  gpu_memory?: { used_mb: number; total_mb: number } | null;
  services: {
    paddle_ocr: ServiceInfo;
    has_ner: ServiceInfo;
    has_image: ServiceInfo;
  };
}

const HEALTH_TIMEOUT_MS = 55_000;

export function useServiceHealth() {
  const [health, setHealth] = useState<ServicesHealth | null>(null);
  const [checking, setChecking] = useState(true);
  const [roundTripMs, setRoundTripMs] = useState<number | null>(null);

  const fetchHealth = useCallback(async (showChecking = false) => {
    if (showChecking) setChecking(true);
    const ac = new AbortController();
    const timer = window.setTimeout(() => ac.abort(), HEALTH_TIMEOUT_MS);
    const t0 = performance.now();
    try {
      const res = await fetch('/health/services', { signal: ac.signal });
      if (res.ok) {
        const data = await res.json();
        setHealth(data);
        setRoundTripMs(Math.round(performance.now() - t0));
      } else {
        setHealth(null);
        setRoundTripMs(null);
      }
    } catch {
      setHealth(null);
      setRoundTripMs(null);
    } finally {
      window.clearTimeout(timer);
      setChecking(false);
    }
  }, []);

  useEffect(() => {
    fetchHealth(false);
    const tick = () => {
      if (document.visibilityState === 'visible') fetchHealth(false);
    };
    const timer = setInterval(tick, 15_000);
    document.addEventListener('visibilitychange', tick);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', tick);
    };
  }, [fetchHealth]);

  return { health, checking, roundTripMs, refresh: () => fetchHealth(true) };
}
