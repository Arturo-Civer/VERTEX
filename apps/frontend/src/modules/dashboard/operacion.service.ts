import { API_URL } from '../../shared/api';
import type { ValidationStatus } from '../../contracts/dashboard';

/** Hours per state over a day window (GET /api/equipos/:codigo/resumen) */
export interface ResumenData {
  /** Latest measurement; the window counts back from it (null: no measurements) */
  fecha_referencia: string | null;
  desde: string | null;
  horas: Record<ValidationStatus, number>;
  /** State after the latest operating interval (null: no intervals) */
  estado_actual: ValidationStatus | null;
}

/** Daily statistics of a variable, motor running only */
export interface PuntoDiario {
  /** YYYY-MM-DD (UTC) */
  dia: string;
  promedio: number;
  minimo: number;
  maximo: number;
  lecturas: number;
}

/** GET /api/equipos/:codigo/mediciones */
export interface MedicionesData {
  variable: string;
  unidad: string;
  fecha_referencia: string | null;
  puntos: PuntoDiario[];
}

const NETWORK_ERROR = 'Sin conexión con el servidor';

/**
 * GET {API_URL}/api/equipos/:codigo/{ruta}. Rejects with the backend's
 * `mensaje` (400 / 404 / 503 / 500) or a network error message; an aborted
 * request rejects with an AbortError.
 */
async function getJson<T>(codigo: string, ruta: string, genericError: string, signal?: AbortSignal): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${API_URL}/api/equipos/${encodeURIComponent(codigo)}/${ruta}`, { signal });
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') throw err;
    throw new Error(NETWORK_ERROR);
  }
  const body = (await res.json().catch(() => null)) as (T & { mensaje?: string }) | null;
  if (res.ok && body) return body;
  throw new Error(body?.mensaje || genericError);
}

export function fetchResumen(codigo: string, dias: number, signal?: AbortSignal) {
  return getJson<ResumenData>(codigo, `resumen?dias=${dias}`, 'No se pudo consultar el resumen', signal);
}

export function fetchMediciones(codigo: string, variable: string, dias: number, signal?: AbortSignal) {
  return getJson<MedicionesData>(
    codigo,
    `mediciones?variable=${encodeURIComponent(variable)}&dias=${dias}`,
    'No se pudieron consultar las mediciones',
    signal,
  );
}
