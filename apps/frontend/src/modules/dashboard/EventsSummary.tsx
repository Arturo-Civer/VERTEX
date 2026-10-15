import { useId } from 'react';
import type { ValidationStatus } from '../../contracts/dashboard';
import type { BloquesData } from './bloques.service';
import { esDias } from './periodo';
import type { Periodo } from './periodo';
import type { BackendState } from './useBackend';
import styles from './dashboard.module.css';

/** Fixed periods of the table: they set the same shared period as the donut selector */
const RANGE_OPTIONS = [
  { id: '7', label: '7 días', dias: 7 },
  { id: '15', label: '15 días', dias: 15 },
  { id: '30', label: '30 días', dias: 30 },
  { id: 'todo', label: 'Todo', dias: null },
] as const;

// corto: label on phones, as in the donut legend, so the table fits 360 px
const ESTADOS: Record<ValidationStatus, { label: string; corto: string; className: string }> = {
  ENCENDIDO: { label: 'Encendido', corto: 'Encend.', className: styles.eventStateOn },
  APAGADO: { label: 'Apagado', corto: 'Apagado', className: styles.eventStateOff },
  EVENTO: { label: 'Evento', corto: 'Evento', className: styles.eventStateEvent },
  MANTENIMIENTO: { label: 'Mantenimiento', corto: 'Mtto.', className: styles.eventStateMaint },
};

// Times are shown as stored (the backend sends them with a Z suffix), so
// format in UTC to avoid shifting them to the browser's time zone
const DATE_FORMAT = new Intl.DateTimeFormat('es', {
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  timeZone: 'UTC',
});
const TIME_FORMAT = new Intl.DateTimeFormat('es', {
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
  timeZone: 'UTC',
});
const HOURS_FORMAT = new Intl.NumberFormat('es', {
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
});

/** Date, plus the time on a second line when the value has one (demo data is date-only) */
function DateCell({ value }: { value: string }) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return <>{value}</>;
  return (
    <>
      {DATE_FORMAT.format(date)}
      {value.length > 10 && <span className={styles.eventsTime}>{TIME_FORMAT.format(date)}</span>}
    </>
  );
}

interface EventsSummaryProps {
  /** Blocks of the shared period: the same request as the donut */
  state: BackendState<BloquesData>;
  periodo: Periodo;
  onPeriodoChange: (periodo: Periodo) => void;
}

/**
 * "Resumen de eventos": state blocks of the selected CERO, as classified by
 * dbo.sp_vx_resumen_estados. The buttons set fixed periods (up to the latest
 * record); a custom range from the donut selector leaves none checked.
 */
export function EventsSummary({ state, periodo, onPeriodoChange }: EventsSummaryProps) {
  const name = useId();

  return (
    <div className={styles.card}>
      <h3 className={styles.cardTitle}>Resumen de eventos</h3>

      <fieldset className={styles.eventsRanges}>
        <legend className={styles.srOnly}>Período</legend>
        {RANGE_OPTIONS.map((r) => (
          <label key={r.id} className={styles.eventsRange}>
            <input
              type="radio"
              name={name}
              value={r.id}
              checked={esDias(periodo, r.dias)}
              onChange={() => onPeriodoChange({ dias: r.dias })}
            />
            <span>{r.label}</span>
          </label>
        ))}
      </fieldset>

      <div className={styles.eventsBody} aria-busy={state.status === 'loading' || undefined}>
        {(state.status === 'loading' || state.status === 'idle') && (
          <div className={styles.eventsMessage} role="status">
            <span className={styles.eventsSpinner} aria-hidden="true" />
            Cargando eventos…
          </div>
        )}

        {state.status === 'error' && (
          <div className={styles.filterError} role="alert">
            {state.message}
          </div>
        )}

        {state.status === 'data' && state.data.bloques.length === 0 && (
          <div className={styles.eventsMessage}>Sin eventos en el período</div>
        )}

        {state.status === 'data' && state.data.bloques.length > 0 && (
          <table className={styles.eventsTable}>
            <thead>
              <tr>
                <th scope="col" className={styles.eventsIndex}>#</th>
                <th scope="col">Inicio</th>
                <th scope="col">Fin</th>
                <th scope="col">Duración</th>
                <th scope="col">Estado</th>
              </tr>
            </thead>
            <tbody>
              {/* Numbered in display order: 1 is the most recent */}
              {state.data.bloques.map((b, n) => {
                const e = ESTADOS[b.segmento];
                return (
                  <tr key={b.inicio} title={b.regla}>
                    <td className={styles.eventsIndex}>{n + 1}</td>
                    <td>
                      <DateCell value={b.inicio} />
                    </td>
                    <td>
                      <DateCell value={b.fin} />
                    </td>
                    <td className={styles.eventsNum}>
                      {`${HOURS_FORMAT.format(b.duracion_min / 60)} h`}
                    </td>
                    <td>
                      <span className={`${styles.eventState} ${e.className}`} title={e.label}>
                        <span className={styles.eventStateLong}>{e.label}</span>
                        <span className={styles.eventStateShort}>{e.corto}</span>
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
