import { useEffect, useState } from 'react';
import { ErrorTemporal } from '../../shared/api';

export type BackendState<T> =
  | { status: 'idle' }
  | { status: 'loading' }
  /** `reintentar`: runs the request again (the "Reintentar" button) */
  | { status: 'error'; message: string; reintentar?: () => void }
  | { status: 'data'; data: T };

/** Waits before the automatic retries of a temporary failure (2 retries) */
const ESPERAS_REINTENTO_MS = [2000, 5000];

/** Waits `ms`; rejects at once if the request is cancelled meanwhile */
function esperar(ms: number, signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    signal.addEventListener(
      'abort',
      () => {
        clearTimeout(timer);
        reject(signal.reason);
      },
      { once: true },
    );
  });
}

/**
 * Runs `load` whenever `key` changes (null: nothing to load → idle). A newer
 * key cancels the previous request through its AbortSignal. `load` must
 * depend only on what `key` encodes.
 * Temporary failures (ErrorTemporal: network, 503 / 504) are retried twice,
 * after 2 and 5 s, while it shows loading; other errors (400, 404, 500) are
 * not. The error state carries `reintentar` to run it again by hand.
 */
export function useBackend<T>(
  key: string | null,
  load: (signal: AbortSignal) => Promise<T>,
): BackendState<T> {
  // The state of the request it belongs to; another key means still loading
  const [result, setResult] = useState<{ key: string; state: BackendState<T> } | null>(null);
  // Bumped by "Reintentar": the same key runs again
  const [intento, setIntento] = useState(0);
  const claveIntento = key === null ? null : `${key}#${intento}`;

  useEffect(() => {
    if (claveIntento === null) return;
    const controller = new AbortController();
    const { signal } = controller;
    const cargar = async (): Promise<T> => {
      for (let i = 0; ; i++) {
        try {
          return await load(signal);
        } catch (err) {
          if (signal.aborted || !(err instanceof ErrorTemporal) || i >= ESPERAS_REINTENTO_MS.length) throw err;
          await esperar(ESPERAS_REINTENTO_MS[i], signal);
        }
      }
    };
    cargar()
      .then((data) => {
        if (!signal.aborted) setResult({ key: claveIntento, state: { status: 'data', data } });
      })
      .catch((err: unknown) => {
        if (signal.aborted) return;
        const message = err instanceof Error ? err.message : String(err);
        const reintentar = () => setIntento((n) => n + 1);
        setResult({ key: claveIntento, state: { status: 'error', message, reintentar } });
      });
    return () => controller.abort();
    // `load` is a new function every render; `key` identifies the request
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [claveIntento]);

  if (claveIntento === null) return { status: 'idle' };
  return result?.key === claveIntento ? result.state : { status: 'loading' };
}
