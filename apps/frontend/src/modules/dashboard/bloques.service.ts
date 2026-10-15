import { API_URL } from '../../shared/api';
import type { ValidationStatus } from '../../contracts/dashboard';
import { esRango, periodoQuery } from './periodo';
import type { Periodo } from './periodo';

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

/**
 * GET /api/equipos/:codigo/bloques: one execution of dbo.sp_vx_resumen_estados
 * feeds both the donut (horas, estado_actual) and the events table (bloques)
 */
export interface BloquesData {
  /** Period end, clipped to the latest record (null: no records) */
  fecha_referencia: string | null;
  /** Period start, clipped to the first record */
  desde: string | null;
  /** First and latest record of the equipment: the range a period can take */
  primer_registro: string | null;
  ultimo_registro: string | null;
  horas: Record<ValidationStatus, number>;
  estado_actual: ValidationStatus | null;
  /** Newest first */
  bloques: Bloque[];
}

const NETWORK_ERROR = 'Sin conexión con el servidor';
const GENERIC_ERROR = 'No se pudieron consultar los eventos';
const NOT_FOUND = 'Equipo no encontrado';

/**
 * GET /api/equipos/:codigo/bloques for the period. Rejects with the backend's `mensaje` (400 / 404 / 503 / 500) or a network
 * error message. An aborted request rejects with an AbortError.
 */
export async function fetchBloques(codigo: string, periodo: Periodo, signal?: AbortSignal): Promise<BloquesData> {
  const query = periodoQuery(periodo);
  let res: Response;
  try {
    res = await fetch(`${API_URL}/api/equipos/${encodeURIComponent(codigo)}/bloques${query ? `?${query}` : ''}`, {
      signal,
    });
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') throw err;
    throw new Error(NETWORK_ERROR);
  }

  const body = (await res.json().catch(() => null)) as (BloquesData & { mensaje?: string }) | null;

  if (res.ok && body && Array.isArray(body.bloques)) return body;
  throw new Error(body?.mensaje || GENERIC_ERROR);
}

// ── Demo mode (Netlify, no backend) ─────────────────────────
// Simulated blocks with the CERO-010 seed shifts: weekdays 06–22 h,
// Saturday 06–14 h, Sunday off (UTC). The event mark lasts MARCA_MIN
// minutes of one variable; after it every stop counts as EVENTO until the
// next maintenance. CERO-011 / 012 vary the dates; CERO-013 simulates a
// missing equipment.

interface DemoPerfil {
  desde: string;
  hasta: string;
  /** First record with an event mark (null: none) */
  marca: string | null;
  /** dbo.Variables.codigo out of its threshold during the mark */
  variableMarca?: string;
  mantenimientos: { inicio: string; fin: string }[];
}

const DEMO_PERFILES: Record<string, DemoPerfil> = {
  'CERO-010': {
    desde: '2026-08-15T00:00:00Z',
    hasta: '2026-10-14T04:00:00Z',
    marca: '2026-09-21T06:11:00Z',
    variableMarca: 'VIBRACION_MOT',
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
    variableMarca: 'TEMPERATURA_MOT',
    mantenimientos: [{ inicio: '2026-09-30T06:00:00Z', fin: '2026-09-30T20:00:00Z' }],
  },
};

const MIN_MS = 60_000;
const HORA_MS = 60 * MIN_MS;
const DAY_MS = 24 * HORA_MS;
/** Minutes of the simulated event mark */
const MARCA_MIN = 10;

/** Simulated event mark of a CERO: [start, end) in ms and its variable (null: none) */
export function demoMarca(codigo: string): { inicio: number; fin: number; variable: string } | null {
  const p = DEMO_PERFILES[codigo];
  if (!p?.marca || !p.variableMarca) return null;
  const inicio = Date.parse(p.marca);
  return { inicio, fin: inicio + MARCA_MIN * MIN_MS, variable: p.variableMarca };
}

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
  let actual = null as { segmento: ValidationStatus; inicio: number; marcas: number } | null;
  const cerrar = (fin: number) => {
    if (!actual) return;
    bloques.push({
      inicio: new Date(actual.inicio).toISOString(),
      fin: new Date(fin).toISOString(),
      duracion_min: (fin - actual.inicio) / MIN_MS,
      segmento: actual.segmento,
      regla: REGLAS[actual.segmento],
      marcas: actual.marcas,
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
      actual = { segmento, inicio: t, marcas: 0 };
    }
    if (marca !== null && t >= marca && t < marca + MARCA_MIN * MIN_MS) actual.marcas++;
  }
  cerrar(hasta);
  return bloques.reverse();
}

/**
 * Demo data with the same shape as the backend: the simulated blocks of the
 * period plus their hours per state, so the donut and the table always agree.
 * Same period rules: `dias` counts back from the latest record, a date range
 * covers whole UTC days; both are clipped to the simulated records.
 * Throws "Equipo no encontrado" for an unknown CERO.
 */
export function demoBloquesData(codigo: string, periodo: Periodo): BloquesData {
  const perfil = DEMO_PERFILES[codigo];
  if (!perfil) throw new Error(NOT_FOUND);

  const primero = Date.parse(perfil.desde);
  const ultimo = Date.parse(perfil.hasta);
  let desde: number;
  let hasta: number;
  if (esRango(periodo)) {
    desde = Date.parse(`${periodo.desde}T00:00:00Z`);
    hasta = Math.min(ultimo, Date.parse(`${periodo.hasta}T00:00:00Z`) + DAY_MS);
  } else {
    hasta = ultimo;
    desde = periodo.dias === null ? primero : hasta - periodo.dias * DAY_MS;
  }
  desde = Math.min(Math.max(desde, primero), hasta);

  // Blocks clipped to the period, as the stored procedure does
  const bloques = demoBloques(perfil)
    .filter((b) => Date.parse(b.fin) > desde && Date.parse(b.inicio) < hasta)
    .map((b) => {
      const inicio = Math.max(Date.parse(b.inicio), desde);
      const fin = Math.min(Date.parse(b.fin), hasta);
      return { ...b, inicio: new Date(inicio).toISOString(), fin: new Date(fin).toISOString(), duracion_min: (fin - inicio) / MIN_MS };
    });

  const horas: Record<ValidationStatus, number> = { ENCENDIDO: 0, APAGADO: 0, EVENTO: 0, MANTENIMIENTO: 0 };
  for (const b of bloques) horas[b.segmento] += b.duracion_min / 60;
  for (const k of Object.keys(horas) as ValidationStatus[]) horas[k] = Math.round(horas[k] * 100) / 100;

  return {
    fecha_referencia: new Date(hasta).toISOString(),
    desde: new Date(desde).toISOString(),
    primer_registro: perfil.desde,
    ultimo_registro: perfil.hasta,
    horas,
    estado_actual: bloques[0]?.segmento ?? null,
    bloques,
  };
}
