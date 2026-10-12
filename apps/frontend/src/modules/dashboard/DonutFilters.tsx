import { useId } from 'react';
import { CERO_OPTIONS, PERIOD_OPTIONS } from './donutSimulation';
import type { CeroId, PeriodId } from './donutSimulation';
import styles from './dashboard.module.css';

interface DonutFiltersProps {
  cero: CeroId;
  period: PeriodId;
  onCeroChange: (cero: CeroId) => void;
  onPeriodChange: (period: PeriodId) => void;
}

/** CERO + period selectors that drive the donut */
export function DonutFilters({ cero, period, onCeroChange, onPeriodChange }: DonutFiltersProps) {
  const ceroId = useId();
  const periodId = useId();

  return (
    <div className={styles.filters}>
      <div className={styles.filterField}>
        <label htmlFor={ceroId} className={styles.filterLabel}>
          CERO
        </label>
        <select
          id={ceroId}
          className={styles.filterSelect}
          value={cero}
          onChange={(e) => onCeroChange(e.target.value as CeroId)}
        >
          {CERO_OPTIONS.map((id) => (
            <option key={id} value={id}>
              {id}
            </option>
          ))}
        </select>
      </div>

      <div className={styles.filterField}>
        <label htmlFor={periodId} className={styles.filterLabel}>
          Período
        </label>
        <select
          id={periodId}
          className={styles.filterSelect}
          value={period}
          onChange={(e) => onPeriodChange(e.target.value as PeriodId)}
        >
          {PERIOD_OPTIONS.map((p) => (
            <option key={p.id} value={p.id}>
              {p.label}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}
