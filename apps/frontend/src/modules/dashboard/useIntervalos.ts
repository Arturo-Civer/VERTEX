import { useEffect, useState } from 'react';
import { DEMO_MODE } from '../../shared/api';
import { demoIntervalos, fetchIntervalos } from './intervalos.service';
import type { IntervalosData } from './intervalos.service';

export type IntervalosState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'data'; data: IntervalosData };

/**
 * Intervals of the selected CERO within the last `dias` days (null: all).
 * Refetches when either changes; a newer request cancels the previous one.
 * Demo mode (Netlify) serves simulated data instead of calling the backend.
 */
export function useIntervalos(codigo: string, dias: number | null): IntervalosState {
  const key = `${codigo}|${dias}`;
  // The state of the request it belongs to; another key means still loading
  const [result, setResult] = useState<{ key: string; state: IntervalosState } | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    const request = DEMO_MODE
      ? demoIntervalos(codigo, dias)
      : fetchIntervalos(codigo, dias, controller.signal);

    request
      .then((data) => {
        if (!controller.signal.aborted) setResult({ key, state: { status: 'data', data } });
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted) return;
        const message = err instanceof Error ? err.message : String(err);
        setResult({ key, state: { status: 'error', message } });
      });

    return () => controller.abort();
  }, [key, codigo, dias]);

  return result?.key === key ? result.state : { status: 'loading' };
}
