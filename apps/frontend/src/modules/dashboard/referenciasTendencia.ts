import type { TrendVariableId } from '../../contracts/dashboard';
import type { Umbral } from './operacion.service';

// ═══════════════════════════════════════════════════════════════════
//  ⚠ DEMO — reference lines of the trend chart
// ═══════════════════════════════════════════════════════════════════
// The data of VERTEX_DEMO is simulated (seed-mediciones.ts), and so are
// these lines: chosen from that data so that normal operation stays below
// them and the seeded anomalies go above. They live only here, in the
// frontend; the database thresholds (ConfiguracionVariables) are untouched.
//
// Going to real data: set USAR_REFERENCIAS_DEMO = false. The chart then
// draws UMBRAL_MAX of ConfiguracionVariables (the `umbral` of
// GET /api/equipos/:codigo/mediciones) and marks episodes only when that
// threshold is enabled; without a threshold there is no line. These DEMO
// values can then be deleted.
// ═══════════════════════════════════════════════════════════════════

/** DEMO: true while the data is simulated. false: read ConfiguracionVariables */
export const USAR_REFERENCIAS_DEMO = true;

/**
 * DEMO: red line of each variable (unit of the variable). Analysis of the
 * 68 072 running readings of CERO-010 (2026-07-13 → 10-14): each line sits
 * just above the maximum of normal operation, so every episode above it falls
 * inside a seeded event window (the anomalies are only 0.02–0.14 % of the
 * readings, too few for a percentile-based line).
 */
export const REFERENCIAS_DEMO: Record<TrendVariableId, number> = {
  corriente: 6.3, // A — normal max 6.23; 43 episodes, all in events
  vibracion: 3.4, // mm/s — normal max 3.31; 7 episodes, all in events
  temperatura: 64, // °C — normal max 63.86; 39 episodes, all in events
  voltaje: 225, // V — normal max 224.5; the demo has no voltage anomalies
  produccion: 100, // simulated variable, no database code
};

export interface LineaReferencia {
  /** Value of the red line (null: none) */
  valor: number | null;
  /** Whether points above it form episodes (red marks) */
  marcar: boolean;
}

/**
 * Red line of the trend chart for a variable: the DEMO value, or with real
 * data the variable's UMBRAL_MAX from the backend (`umbral` of /mediciones),
 * marking episodes only when that threshold is enabled.
 */
export function lineaReferencia(id: TrendVariableId, umbral: Umbral | null | undefined): LineaReferencia {
  if (USAR_REFERENCIAS_DEMO) return { valor: REFERENCIAS_DEMO[id], marcar: id !== 'produccion' };
  const valor = umbral?.max ?? null;
  return { valor, marcar: valor !== null && Boolean(umbral?.habilitado) };
}
