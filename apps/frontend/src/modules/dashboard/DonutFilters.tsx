import { useId } from 'react';
import { CERO_OPTIONS } from './donutSimulation';
import type { CeroId } from './donutSimulation';
import { PeriodoSelector } from './PeriodoSelector';
import type { PeriodoFechas } from './PeriodoSelector';
import type { Periodo } from './periodo';
import styles from './dashboard.module.css';

/** Result of checking the selected CERO against the backend */
export type CeroCheck =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'ok' }
  | { status: 'error'; message: string };

interface DonutFiltersProps {
  cero: CeroId;
  /** Dates of the shared period (donut, events table and trend chart) */
  periodoFechas?: PeriodoFechas;
  ceroCheck: CeroCheck;
  onCeroChange: (cero: CeroId) => void;
  onPeriodoChange: (periodo: Periodo) => void;
}

function CheckIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M5 12.5l4.5 4.5L19 7.5" />
    </svg>
  );
}

function AlertIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="10" />
      <path d="M12 7v6" />
      <path d="M12 17h.01" />
    </svg>
  );
}

const CHECK_CLASS: Record<CeroCheck['status'], string> = {
  idle: '',
  loading: styles.filterSelectBusy,
  ok: `${styles.filterSelectBusy} ${styles.filterSelectOk}`,
  error: styles.filterSelectError,
};

/**
 * CERO + period selectors. The period is a free date range (two calendars);
 * it drives the donut, the events table and the trend chart, like the fixed
 * periods of the table buttons.
 */
export function DonutFilters({ cero, periodoFechas, ceroCheck, onCeroChange, onPeriodoChange }: DonutFiltersProps) {
  const ceroId = useId();
  const periodId = useId();
  const errorId = useId();
  const error = ceroCheck.status === 'error' ? ceroCheck.message : null;

  return (
    <>
      <div className={styles.filters}>
        <div className={styles.filterField}>
          <label htmlFor={ceroId} className={styles.filterLabel}>
            CERO
          </label>
          <div className={styles.filterSelectWrap}>
            <select
              id={ceroId}
              className={`${styles.filterSelect} ${CHECK_CLASS[ceroCheck.status]}`}
              value={cero}
              aria-invalid={error ? true : undefined}
              aria-describedby={error ? errorId : undefined}
              aria-busy={ceroCheck.status === 'loading' || undefined}
              onChange={(e) => onCeroChange(e.target.value as CeroId)}
            >
              {CERO_OPTIONS.map((id) => (
                <option key={id} value={id}>
                  {id}
                </option>
              ))}
            </select>
            {ceroCheck.status === 'loading' && (
              <span className={styles.filterSpinner} aria-label="Verificando equipo" role="status" />
            )}
            {ceroCheck.status === 'ok' && (
              <span className={styles.filterOkIcon} role="status" aria-label="Equipo verificado">
                <CheckIcon />
              </span>
            )}
          </div>
        </div>

        <div className={styles.filterField}>
          <label htmlFor={periodId} className={styles.filterLabel}>
            Período
          </label>
          <PeriodoSelector
            id={periodId}
            fechas={periodoFechas}
            onAplicar={(desde, hasta) => onPeriodoChange({ desde, hasta })}
          />
        </div>
      </div>

      {error && (
        <div id={errorId} className={styles.filterError} role="alert">
          <AlertIcon />
          <span>{error}</span>
        </div>
      )}
    </>
  );
}
