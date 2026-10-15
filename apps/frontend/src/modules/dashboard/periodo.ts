/**
 * Period shared by the donut, the events table and the trend chart: the last
 * `dias` days up to the latest record (null: all the data), or a date range
 * (AAAA-MM-DD, UTC days, both included). The backend clips it to the records.
 */
export type Periodo = { dias: number | null } | { desde: string; hasta: string };

export const PERIODO_INICIAL: Periodo = { dias: 30 };

export function esRango(p: Periodo): p is { desde: string; hasta: string } {
  return 'desde' in p;
}

/** Query string of the period for the backend ('' = all the data) */
export function periodoQuery(p: Periodo): string {
  if (esRango(p)) return `desde=${p.desde}&hasta=${p.hasta}`;
  return p.dias === null ? '' : `dias=${p.dias}`;
}

/** Stable key of the period, for request caching */
export function periodoClave(p: Periodo): string {
  return esRango(p) ? `${p.desde}..${p.hasta}` : `dias:${p.dias ?? 'todo'}`;
}

/** Whether the period is the fixed one of `dias` days (null: Todo) */
export function esDias(p: Periodo, dias: number | null): boolean {
  return !esRango(p) && p.dias === dias;
}
