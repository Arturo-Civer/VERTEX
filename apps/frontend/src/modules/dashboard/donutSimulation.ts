import type { DonutSegment, ValidationStatus } from '../../contracts/dashboard';
import { mockData } from './mockData';

export const CERO_OPTIONS = ['CERO-010', 'CERO-011', 'CERO-012', 'CERO-013'] as const;
export type CeroId = (typeof CERO_OPTIONS)[number];

export const PERIOD_OPTIONS = [
  { id: '7d', label: 'Últimos 7 días', days: 7 },
  { id: '15d', label: 'Últimos 15 días', days: 15 },
  { id: 'month', label: 'Este mes', days: 30 },
  { id: '3m', label: 'Últimos 3 meses', days: 90 },
  { id: '6m', label: 'Últimos 6 meses', days: 180 },
] as const;
export type PeriodId = (typeof PERIOD_OPTIONS)[number]['id'];

/** Fixed share of the period's hours spent in each state, per CERO (simulated). */
const CERO_PROFILES: Record<CeroId, Record<ValidationStatus, number>> = {
  'CERO-010': { ENCENDIDO: 0.8, APAGADO: 0.11, EVENTO: 0.065, MANTENIMIENTO: 0.025 },
  'CERO-011': { ENCENDIDO: 0.68, APAGADO: 0.22, EVENTO: 0.06, MANTENIMIENTO: 0.04 },
  'CERO-012': { ENCENDIDO: 0.55, APAGADO: 0.3, EVENTO: 0.1, MANTENIMIENTO: 0.05 },
  'CERO-013': { ENCENDIDO: 0.88, APAGADO: 0.07, EVENTO: 0.03, MANTENIMIENTO: 0.02 },
};

/** Per-period drift moved from ENCENDIDO to APAGADO, so every combination differs. */
const PERIOD_DRIFT: Record<PeriodId, number> = {
  '7d': -0.02,
  '15d': -0.01,
  month: 0,
  '3m': 0.01,
  '6m': 0.02,
};

export interface DonutData {
  segments: DonutSegment[];
  totalHours: number;
  totalLabel: string;
}

/**
 * Simulated donut data for a CERO + period combination. Every hour of the
 * period falls in one state, so the segments always add up to days × 24.
 * Labels and colors come from mockData so they stay in a single place.
 */
export function simulateDonut(cero: CeroId, periodId: PeriodId): DonutData {
  const period = PERIOD_OPTIONS.find((p) => p.id === periodId) ?? PERIOD_OPTIONS[2];
  const totalHours = period.days * 24;
  const profile = { ...CERO_PROFILES[cero] };
  profile.ENCENDIDO -= PERIOD_DRIFT[periodId];
  profile.APAGADO += PERIOD_DRIFT[periodId];

  const segments = mockData.donut.segments.map((seg) => ({
    ...seg,
    hours: Math.round(totalHours * profile[seg.status]),
  }));

  // Absorb rounding into ENCENDIDO so the total is exact
  const rest = segments
    .filter((s) => s.status !== 'ENCENDIDO')
    .reduce((sum, s) => sum + s.hours, 0);
  const on = segments.find((s) => s.status === 'ENCENDIDO');
  if (on) on.hours = totalHours - rest;

  return { segments, totalHours, totalLabel: mockData.donut.totalLabel };
}
