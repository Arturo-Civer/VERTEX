import { API_URL } from '../../shared/api';
import type { TrendVariable } from '../../contracts/dashboard';
import { demoMarca } from './bloques.service';
import type { BloquesData } from './bloques.service';
import { periodoQuery } from './periodo';
import type { Periodo } from './periodo';

/** Statistics of a variable over one interval (minutos_punto), motor running only */
export interface PuntoTendencia {
  /** Interval start (ISO, UTC) */
  inicio: string;
  /** YYYY-MM-DD (UTC) of inicio */
  dia: string;
  promedio: number;
  minimo: number;
  maximo: number;
  lecturas: number;
  /** Readings out of the variable's threshold (0 when it is disabled) */
  marcas: number;
}

/** Threshold of a variable (ConfiguracionVariables) */
export interface Umbral {
  min: number | null;
  max: number | null;
  /** Disabled thresholds do not mark events (e.g. current and voltage in the demo) */
  habilitado: boolean;
}

/** GET /api/equipos/:codigo/mediciones */
export interface MedicionesData {
  variable: string;
  unidad: string;
  fecha_referencia: string | null;
  desde: string | null;
  /** Interval of each point, chosen by the stored procedure from the period length */
  minutos_punto: number;
  /** null: the variable has no threshold configured */
  umbral: Umbral | null;
  puntos: PuntoTendencia[];
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

/** GET /api/equipos/:codigo/mediciones for the shared period */
export function fetchMediciones(codigo: string, variable: string, periodo: Periodo, signal?: AbortSignal) {
  const query = periodoQuery(periodo);
  return getJson<MedicionesData>(
    codigo,
    `mediciones?variable=${encodeURIComponent(variable)}${query ? `&${query}` : ''}`,
    'No se pudieron consultar las mediciones',
    signal,
  );
}

// ── Demo mode (Netlify, no backend) ─────────────────────────
// Simulated readings, one per minute with the motor running (ENCENDIDO
// blocks of the demo period), grouped like dbo.sp_vx_tendencia_variable.
// Values and thresholds resemble the seed data of CERO-010.

interface DemoVariable {
  /** Typical value with the motor running; temperature warms up from `base` */
  base: number;
  /** Rise over the shift (temperature only) */
  calentamiento?: number;
  ruido: number;
  /** Value during the simulated event mark */
  pico: number;
  umbral: Umbral;
}

const DEMO_VARIABLES: Record<string, DemoVariable> = {
  CORRIENTE_MOTOR: { base: 5.15, ruido: 0.35, pico: 9.5, umbral: { min: null, max: 2.5, habilitado: false } },
  VIBRACION_MOT: { base: 2.5, ruido: 0.3, pico: 8.9, umbral: { min: null, max: 4.5, habilitado: true } },
  TEMPERATURA_MOT: { base: 40, calentamiento: 22, ruido: 0.8, pico: 71, umbral: { min: null, max: 65, habilitado: true } },
  VOLTAJE_MOTOR: { base: 220, ruido: 1.6, pico: 224, umbral: { min: 396, max: 484, habilitado: false } },
};

const MIN_MS = 60_000;
const HORA_MS = 60 * MIN_MS;
const DAY_MS = 24 * HORA_MS;

/** Repeatable noise in [-1, 1) for a minute and a variable */
function ruido(minuto: number, semilla: number) {
  const x = Math.sin(minuto * 12.9898 + semilla * 78.233) * 43758.5453;
  return (x - Math.floor(x)) * 2 - 1;
}

/** Same interval size as the stored procedure, from the period length */
function minutosPunto(duracionMs: number) {
  const dias = duracionMs / DAY_MS;
  if (dias <= 2) return 15;
  if (dias <= 16) return 60;
  return dias <= 60 ? 240 : 1440;
}

/**
 * Demo trend with the same shape as the backend, for the demo blocks of the
 * period (`datos`): points only while the motor runs, marks only inside the
 * simulated event mark of the CERO. null: the variable is not simulated.
 */
export function demoMedicionesData(codigo: string, variable: TrendVariable, datos: BloquesData): MedicionesData | null {
  const sim = variable.codigo ? DEMO_VARIABLES[variable.codigo] : undefined;
  if (!sim || !variable.codigo) return null;
  const desde = datos.desde ? Date.parse(datos.desde) : 0;
  const hasta = datos.fecha_referencia ? Date.parse(datos.fecha_referencia) : 0;
  const punto = minutosPunto(hasta - desde);
  const marca = demoMarca(codigo);
  const conMarca = marca?.variable === variable.codigo ? marca : null;
  const semilla = variable.codigo.length;

  const grupos = new Map<number, { suma: number; minimo: number; maximo: number; lecturas: number; marcas: number }>();
  for (const b of datos.bloques) {
    if (b.segmento !== 'ENCENDIDO') continue;
    for (let t = Date.parse(b.inicio); t < Date.parse(b.fin); t += MIN_MS) {
      // Hours since the 06:00 shift start (temperature warm-up)
      const horas = Math.max(0, ((t % DAY_MS) - 6 * HORA_MS) / HORA_MS);
      let valor = sim.base + (sim.calentamiento ?? 0) * (1 - Math.exp(-horas / 2.5)) + sim.ruido * ruido(t / MIN_MS, semilla);
      if (conMarca && t >= conMarca.inicio && t < conMarca.fin) valor = sim.pico + sim.ruido * ruido(t / MIN_MS, semilla + 1);
      const fuera =
        sim.umbral.habilitado &&
        ((sim.umbral.max !== null && valor > sim.umbral.max) || (sim.umbral.min !== null && valor < sim.umbral.min));
      const inicio = t - (t % (punto * MIN_MS));
      const g = grupos.get(inicio);
      if (g) {
        g.suma += valor;
        g.minimo = Math.min(g.minimo, valor);
        g.maximo = Math.max(g.maximo, valor);
        g.lecturas++;
        if (fuera) g.marcas++;
      } else {
        grupos.set(inicio, { suma: valor, minimo: valor, maximo: valor, lecturas: 1, marcas: fuera ? 1 : 0 });
      }
    }
  }

  const r3 = (n: number) => Math.round(n * 1000) / 1000;
  const puntos: PuntoTendencia[] = [...grupos.entries()]
    .sort(([a], [b]) => a - b)
    .map(([inicio, g]) => {
      const iso = new Date(inicio).toISOString();
      return {
        inicio: iso,
        dia: iso.slice(0, 10),
        promedio: r3(g.suma / g.lecturas),
        minimo: r3(g.minimo),
        maximo: r3(g.maximo),
        lecturas: g.lecturas,
        marcas: g.marcas,
      };
    });

  return {
    variable: variable.codigo,
    unidad: variable.unit ?? '',
    fecha_referencia: datos.fecha_referencia,
    desde: datos.desde,
    minutos_punto: punto,
    umbral: sim.umbral,
    puntos,
  };
}
