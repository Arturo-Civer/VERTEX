import { useEffect, useState } from 'react';
import { DEMO_MODE } from '../../shared/api';
import { demoBloquesData, fetchBloques } from './bloques.service';
import type { BloquesData } from './bloques.service';

export type BloquesState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'data'; data: BloquesData };

/**
 * State blocks of the selected CERO within the last `dias` days (null: all).
 * Refetches when either changes; a newer request cancels the previous one.
 * Demo mode (Netlify) serves simulated data instead of calling the backend.
 */
export function useBloques(codigo: string, dias: number | null): BloquesState {
  const key = `${codigo}|${dias}`;
  // The state of the request it belongs to; another key means still loading
  const [result, setResult] = useState<{ key: string; state: BloquesState } | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    const request = DEMO_MODE
      ? demoBloquesData(codigo, dias)
      : fetchBloques(codigo, dias, controller.signal);

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
