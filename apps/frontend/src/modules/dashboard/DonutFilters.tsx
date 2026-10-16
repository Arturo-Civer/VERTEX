import { PeriodoSelector } from './PeriodoSelector';
import type { PeriodoFechas } from './PeriodoSelector';
import type { Periodo } from './periodo';
import styles from './dashboard.module.css';

interface DonutFiltersProps {
  /** Dates of the shared period (donut, events table and trend chart) */
  periodoFechas?: PeriodoFechas;
  onPeriodoChange: (periodo: Periodo) => void;
}

/**
 * Período over the donut: a free date range that applies as soon as it is
 * valid. It drives the donut, the events table and the trend chart, like the
 * fixed periods of the table buttons. The equipment is chosen in the tree.
 */
export function DonutFilters({ periodoFechas, onPeriodoChange }: DonutFiltersProps) {
  return (
    <div className={styles.filters}>
      <PeriodoSelector fechas={periodoFechas} onAplicar={(desde, hasta) => onPeriodoChange({ desde, hasta })} />
    </div>
  );
}
