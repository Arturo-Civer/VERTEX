import { useId, useState } from 'react';
import type { ValidationStatus } from '../../contracts/dashboard';
import { useBloques } from './useBloques';
import styles from './dashboard.module.css';

const RANGE_OPTIONS = [
  { id: '7', label: '7 días', days: 7 },
  { id: '15', label: '15 días', days: 15 },
  { id: '30', label: '30 días', days: 30 },
  { id: 'todo', label: 'Todo', days: null },
] as const;
type RangeId = (typeof RANGE_OPTIONS)[number]['id'];

const ESTADOS: Record<ValidationStatus, { label: string; className: string }> = {
  ENCENDIDO: { label: 'Encendido', className: styles.eventStateOn },
  APAGADO: { label: 'Apagado', className: styles.eventStateOff },
  EVENTO: { label: 'Evento', className: styles.eventStateEvent },
  MANTENIMIENTO: { label: 'Mantenimiento', className: styles.eventStateMaint },
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
  cero: string;
}

/**
 * "Resumen de eventos": state blocks of the selected CERO, as classified by
 * dbo.sp_vx_resumen_estados (the same calculation as the donut)
 */
export function EventsSummary({ cero }: EventsSummaryProps) {
  const name = useId();
  const [range, setRange] = useState<RangeId>('30');
  const days = RANGE_OPTIONS.find((r) => r.id === range)?.days ?? null;
  const state = useBloques(cero, days);

  return (
    <div className={styles.card}>
      <h3 className={styles.cardTitle}>Resumen de eventos</h3>

      <fieldset className={styles.eventsRanges}>
        <legend className={styles.srOnly}>Período de la tabla</legend>
        {RANGE_OPTIONS.map((r) => (
          <label key={r.id} className={styles.eventsRange}>
            <input
              type="radio"
              name={name}
              value={r.id}
              checked={range === r.id}
              onChange={() => setRange(r.id)}
            />
            <span>{r.label}</span>
          </label>
        ))}
      </fieldset>

      <div className={styles.eventsBody} aria-busy={state.status === 'loading' || undefined}>
        {state.status === 'loading' && (
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
                      <span className={`${styles.eventState} ${e.className}`}>{e.label}</span>
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
