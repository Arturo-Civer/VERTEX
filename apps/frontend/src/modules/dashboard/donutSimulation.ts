import type { DonutSegment } from '../../contracts/dashboard';

export const CERO_OPTIONS = ['CERO-010', 'CERO-011', 'CERO-012', 'CERO-013'] as const;
export type CeroId = (typeof CERO_OPTIONS)[number];

export interface DonutData {
  segments: DonutSegment[];
  totalHours: number;
  totalLabel: string;
}
