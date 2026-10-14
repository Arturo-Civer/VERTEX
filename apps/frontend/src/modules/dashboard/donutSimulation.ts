import type { DonutSegment } from '../../contracts/dashboard';

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

export interface DonutData {
  segments: DonutSegment[];
  totalHours: number;
  totalLabel: string;
}
