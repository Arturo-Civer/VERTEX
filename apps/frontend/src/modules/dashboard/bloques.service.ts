import { API_URL } from '../../shared/api';
import type { ValidationStatus } from '../../contracts/dashboard';
import type { ResumenData } from './operacion.service';

/** Consecutive time with the same state (dbo.sp_vx_resumen_estados) */
export interface Bloque {
  inicio: string;
  fin: string;
  duracion_min: number;
  segmento: ValidationStatus;
  /** Rule that decided the block, e.g. "4b corriente 0 con marca previa" */
  regla: string;
  /** Records of the block with an event mark */
  marcas: number;
}

export interface BloquesData {
  /** Latest record; the day window counts back from it (null: no records) */
  fecha_referencia: string | null;
  desde: string | null;
  /** Newest first */
  bloques: Bloque[];
}

const NETWORK_ERROR = 'Sin conexión con el servidor';
const GENERIC_ERROR = 'No se pudieron consultar los eventos';
const NOT_FOUND = 'Equipo no encontrado';

/**
 * GET /api/equipos/:codigo/bloques?dias=N (`dias` null: all the data).
 * Rejects with the backend's `mensaje` (400 / 404 / 503 / 500) or a network
 * error message. An aborted request rejects with an AbortError.
 */
export async function fetchBloques(
  codigo: string,
  dias: number | null,
  signal?: AbortSignal,
): Promise<BloquesData> {
  const query = dias === null ? '' : `?dias=${dias}`;
  let res: Response;
  try {
    res = await fetch(`${API_URL}/api/equipos/${encodeURIComponent(codigo)}/bloques${query}`, {
      signal,
    });
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') throw err;
    throw new Error(NETWORK_ERROR);
  }

  const body = (await res.json().catch(() => null)) as
    | (Partial<BloquesData> & { mensaje?: string })
    | null;

  if (res.ok && body && Array.isArray(body.bloques)) {
    return { fecha_referencia: body.fecha_referencia ?? null, desde: body.desde ?? null, bloques: body.bloques };
  }
  throw new Error(body?.mensaje || GENERIC_ERROR);
}

// ── Demo mode (Netlify, no backend) ─────────────────────────
// Simulated blocks with the CERO-010 seed shifts: weekdays 06–22 h,
// Saturday 06–14 h, Sunday off (UTC). After the event mark every stop
// counts as EVENTO until the next maintenance. CERO-011 / 012 vary the
// dates; CERO-013 simulates a missing equipment.

interface DemoPerfil {
  desde: string;
  hasta: string;
  /** First record with an event mark (null: none) */
  marca: string | null;
  mantenimientos: { inicio: string; fin: string }[];
}

const DEMO_PERFILES: Record<string, DemoPerfil> = {
  'CERO-010': {
    desde: '2026-08-15T00:00:00Z',
    hasta: '2026-10-14T04:00:00Z',
    marca: '2026-09-21T06:11:00Z',
    mantenimientos: [
      { inicio: '2026-09-10T14:30:00Z', fin: '2026-09-11T08:00:00Z' },
      { inicio: '2026-09-28T07:00:00Z', fin: '2026-09-29T09:00:00Z' },
      { inicio: '2026-10-07T13:00:00Z', fin: '2026-10-07T18:00:00Z' },
    ],
  },
  'CERO-011': {
    desde: '2026-09-01T00:00:00Z',
    hasta: '2026-10-01T00:00:00Z',
    marca: null,
    mantenimientos: [{ inicio: '2026-09-15T08:00:00Z', fin: '2026-09-15T16:00:00Z' }],
  },
  'CERO-012': {
    desde: '2026-09-20T00:00:00Z',
    hasta: '2026-10-14T04:00:00Z',
    marca: '2026-10-09T09:30:00Z',
    mantenimientos: [{ inicio: '2026-09-30T06:00:00Z', fin: '2026-09-30T20:00:00Z' }],
  },
};

const MIN_MS = 60_000;
const HORA_MS = 60 * MIN_MS;
const DAY_MS = 24 * HORA_MS;

/** Running window of a UTC day by the seed shifts (null: Sunday, off) */
function turno(dia: number): [number, number] | null {
  const semana = new Date(dia).getUTCDay();
  if (semana === 0) return null;
  return [dia + 6 * HORA_MS, dia + (semana === 6 ? 14 : 22) * HORA_MS];
}

const REGLAS: Record<ValidationStatus, string> = {
  MANTENIMIENTO: '1 hueco > tolerancia',
  ENCENDIDO: '4a corriente > 0',
  EVENTO: '4b corriente 0 con marca previa',
  APAGADO: '4c corriente 0 sin marcas',
};

/** Minute-by-minute state of the profile, merged into blocks (newest first) */
function demoBloques(p: DemoPerfil): Bloque[] {
  const desde = Date.parse(p.desde);
  const hasta = Date.parse(p.hasta);
  const marca = p.marca ? Date.parse(p.marca) : null;
  const mantos = p.mantenimientos.map((m) => [Date.parse(m.inicio), Date.parse(m.fin)] as const);
  // The mark counts until the first maintenance after it
  const finMarca = marca === null ? null : (mantos.find(([a]) => a > marca)?.[0] ?? Infinity);

  const bloques: Bloque[] = [];
  // `as`: TS narrows a `null` initializer and misses the loop's assignments
  let actual = null as { segmento: ValidationStatus; inicio: number } | null;
  const cerrar = (fin: number) => {
    if (!actual) return;
    bloques.push({
      inicio: new Date(actual.inicio).toISOString(),
      fin: new Date(fin).toISOString(),
      duracion_min: (fin - actual.inicio) / MIN_MS,
      segmento: actual.segmento,
      regla: REGLAS[actual.segmento],
      marcas: 0,
    });
  };

  for (let t = desde; t < hasta; t += MIN_MS) {
    const enTurno = turno(t - (t % DAY_MS));
    let segmento: ValidationStatus;
    if (mantos.some(([a, b]) => t >= a && t < b)) segmento = 'MANTENIMIENTO';
    else if (enTurno && t >= enTurno[0] && t < enTurno[1]) segmento = 'ENCENDIDO';
    else if (marca !== null && finMarca !== null && t >= marca && t < finMarca) segmento = 'EVENTO';
    else segmento = 'APAGADO';

    if (actual?.segmento !== segmento) {
      cerrar(t);
      actual = { segmento, inicio: t };
    }
  }
  cerrar(hasta);
  return bloques.reverse();
}

/** Demo blocks with the same day window as the backend (counted back from the latest record) */
export async function demoBloquesData(codigo: string, dias: number | null): Promise<BloquesData> {
  return demoBloquesSync(codigo, dias);
}

/**
 * Demo donut hours from the same simulated blocks as the table, so both
 * always agree (the backend does the same from dbo.sp_vx_resumen_estados).
 * Throws "Equipo no encontrado" for an unknown CERO.
 */
export function demoResumen(codigo: string, dias: number): ResumenData {
  const { fecha_referencia, desde, bloques } = demoBloquesSync(codigo, dias);
  const minutos: Record<ValidationStatus, number> = { ENCENDIDO: 0, APAGADO: 0, EVENTO: 0, MANTENIMIENTO: 0 };
  for (const b of bloques) minutos[b.segmento] += b.duracion_min;
  const horas = Object.fromEntries(
    Object.entries(minutos).map(([estado, min]) => [estado, Math.round((min / 60) * 100) / 100]),
  ) as Record<ValidationStatus, number>;
  return { fecha_referencia, desde, horas, estado_actual: bloques[0]?.segmento ?? null };
}

function demoBloquesSync(codigo: string, dias: number | null): BloquesData {
  const perfil = DEMO_PERFILES[codigo];
  if (!perfil) throw new Error(NOT_FOUND);

  const inicio = Date.parse(perfil.desde);
  const desde = dias === null ? inicio : Math.max(inicio, Date.parse(perfil.hasta) - dias * DAY_MS);
  const bloques = demoBloques(perfil)
    .filter((b) => Date.parse(b.fin) > desde)
    .map((b) => {
      // Clip the oldest block to the window, as the stored procedure does
      if (Date.parse(b.inicio) >= desde) return b;
      return { ...b, inicio: new Date(desde).toISOString(), duracion_min: (Date.parse(b.fin) - desde) / MIN_MS };
    });
  return { fecha_referencia: perfil.hasta, desde: new Date(desde).toISOString(), bloques };
}
