import { useEffect, useState } from 'react';

export type BackendState<T> =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'data'; data: T };

/**
 * Runs `load` whenever `key` changes (null: nothing to load → idle). A newer
 * key cancels the previous request through its AbortSignal. `load` must
 * depend only on what `key` encodes.
 */
export function useBackend<T>(
  key: string | null,
  load: (signal: AbortSignal) => Promise<T>,
): BackendState<T> {
  // The state of the request it belongs to; another key means still loading
  const [result, setResult] = useState<{ key: string; state: BackendState<T> } | null>(null);

  useEffect(() => {
    if (key === null) return;
    const controller = new AbortController();
    load(controller.signal)
      .then((data) => {
        if (!controller.signal.aborted) setResult({ key, state: { status: 'data', data } });
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted) return;
        const message = err instanceof Error ? err.message : String(err);
        setResult({ key, state: { status: 'error', message } });
      });
    return () => controller.abort();
    // `load` is a new function every render; `key` identifies the request
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  if (key === null) return { status: 'idle' };
  return result?.key === key ? result.state : { status: 'loading' };
}
