import { API_URL } from '../../shared/api';

/** Operating interval of an equipment (dbo.IntervalosFuncionamiento) */
export interface Intervalo {
  inicio: string;
  /** null while the interval is still open */
  fin: string | null;
  duracion_min: number | null;
  /** PARADA_NORMAL, MANTENIMIENTO, … — null while the interval is still open */
  tipo_cierre: string | null;
}

export interface IntervalosData {
  /** Latest interval end; the day window counts back from it (null: no intervals) */
  fecha_referencia: string | null;
  intervalos: Intervalo[];
}

const NETWORK_ERROR = 'Sin conexión con el servidor';
const GENERIC_ERROR = 'No se pudieron consultar los intervalos';
const NOT_FOUND = 'Equipo no encontrado';

/**
 * GET /api/equipos/:codigo/intervalos?dias=N (`dias` null: every interval).
 * Rejects with the backend's `mensaje` (400 / 404 / 503 / 500) or a network
 * error message. An aborted request rejects with an AbortError.
 */
export async function fetchIntervalos(
  codigo: string,
  dias: number | null,
  signal?: AbortSignal,
): Promise<IntervalosData> {
  const query = dias === null ? '' : `?dias=${dias}`;
  let res: Response;
  try {
    res = await fetch(`${API_URL}/api/equipos/${encodeURIComponent(codigo)}/intervalos${query}`, {
      signal,
    });
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') throw err;
    throw new Error(NETWORK_ERROR);
  }

  const body = (await res.json().catch(() => null)) as
    | (Partial<IntervalosData> & { mensaje?: string })
    | null;

  if (res.ok && body && Array.isArray(body.intervalos)) {
    return { fecha_referencia: body.fecha_referencia ?? null, intervalos: body.intervalos };
  }
  throw new Error(body?.mensaje || GENERIC_ERROR);
}

// ── Demo mode (Netlify, no backend) ─────────────────────────
// Copies of the CERO-010 seed intervals; CERO-011 / 012 take subsets of
// them to look like other motors, CERO-013 simulates a missing equipment.
const DEMO_INTERVALOS: Record<string, IntervalosData> = {
  'CERO-010': {
    fecha_referencia: '2026-10-08',
    intervalos: [
      { inicio: '2026-10-08', fin: null, duracion_min: null, tipo_cierre: null },
      { inicio: '2026-10-01', fin: '2026-10-08', duracion_min: 3360, tipo_cierre: 'PARADA_NORMAL' },
      { inicio: '2026-09-21', fin: '2026-10-01', duracion_min: 4800, tipo_cierre: 'MANTENIMIENTO' },
      { inicio: '2026-09-11', fin: '2026-09-19', duracion_min: 3840, tipo_cierre: 'PARADA_NORMAL' },
      { inicio: '2026-08-29', fin: '2026-09-10', duracion_min: 5760, tipo_cierre: 'MANTENIMIENTO' },
      { inicio: '2026-08-18', fin: '2026-08-27', duracion_min: 4320, tipo_cierre: 'PARADA_NORMAL' },
      { inicio: '2026-08-12', fin: '2026-08-17', duracion_min: 2400, tipo_cierre: 'PARADA_NORMAL' },
    ],
  },
  'CERO-011': {
    fecha_referencia: '2026-10-01',
    intervalos: [
      { inicio: '2026-09-21', fin: '2026-10-01', duracion_min: 4800, tipo_cierre: 'MANTENIMIENTO' },
      { inicio: '2026-09-11', fin: '2026-09-19', duracion_min: 3840, tipo_cierre: 'PARADA_NORMAL' },
      { inicio: '2026-08-29', fin: '2026-09-10', duracion_min: 5760, tipo_cierre: 'MANTENIMIENTO' },
    ],
  },
  'CERO-012': {
    fecha_referencia: '2026-10-08',
    intervalos: [
      { inicio: '2026-10-01', fin: '2026-10-08', duracion_min: 3360, tipo_cierre: 'PARADA_NORMAL' },
      { inicio: '2026-09-21', fin: '2026-10-01', duracion_min: 4800, tipo_cierre: 'MANTENIMIENTO' },
    ],
  },
};

const DAY_MS = 24 * 60 * 60 * 1000;

/** Demo data with the same day window as the backend (counted back from fecha_referencia) */
export async function demoIntervalos(codigo: string, dias: number | null): Promise<IntervalosData> {
  const data = DEMO_INTERVALOS[codigo];
  if (!data) throw new Error(NOT_FOUND);
  if (dias === null || !data.fecha_referencia) return data;

  const desde = Date.parse(data.fecha_referencia) - dias * DAY_MS;
  return {
    fecha_referencia: data.fecha_referencia,
    intervalos: data.intervalos.filter((i) => Date.parse(i.inicio) >= desde),
  };
}
