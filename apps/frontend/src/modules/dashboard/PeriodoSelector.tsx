import { useId, useState } from 'react';
import type { KeyboardEvent, MouseEvent } from 'react';
import styles from './dashboard.module.css';

/** Dates shown and allowed by the selector (AAAA-MM-DD, UTC days) */
export interface PeriodoFechas {
  /** Current period, whatever set it (these fields or the table buttons) */
  desde: string;
  hasta: string;
  /** Days with records: the calendars cannot go outside them */
  min?: string;
  max?: string;
}

interface PeriodoSelectorProps {
  /** Undefined only before the first period has loaded */
  fechas?: PeriodoFechas;
  /** Called with a valid range as soon as a date changes */
  onAplicar: (desde: string, hasta: string) => void;
}

/** dd/mm/aaaa from AAAA-MM-DD */
const ddmmaaaa = (fecha: string) => `${fecha.slice(8, 10)}/${fecha.slice(5, 7)}/${fecha.slice(0, 4)}`;

/** The browser's own calendar right under the field (not every browser has showPicker) */
function abrirCalendario(input: HTMLInputElement) {
  try {
    input.showPicker?.();
  } catch {
    // e.g. not allowed without a user gesture: the field still takes typing
  }
}

function CalendarIcon() {
  return (
    <svg
      className={styles.periodoIcono}
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
      <rect x="3" y="5" width="18" height="16" rx="2" />
      <path d="M3 10h18M8 3v4M16 3v4" />
    </svg>
  );
}

/** Message for a range that cannot be applied (null: valid) */
function errorDe(desde: string, hasta: string, min?: string, max?: string): string | null {
  if (desde > hasta) return 'La fecha de inicio no puede ser posterior a la de fin';
  if ((min && desde < min) || (max && hasta > max)) {
    return min && max ? `Elige fechas entre el ${ddmmaaaa(min)} y el ${ddmmaaaa(max)}` : 'Fecha fuera del rango con datos';
  }
  return null;
}

/**
 * Período of the dashboard: two native date fields ("Desde" → "Hasta")
 * always visible in one box. A valid change applies at once to the shared
 * period (no Apply button); an invalid range is marked in red and not
 * applied; an emptied field gets its previous date back when left. The
 * fields follow the period when the table buttons (7 / 15 / 30 días / Todo)
 * change it, and keep their dates while the new one loads.
 */
export function PeriodoSelector({ fechas, onAplicar }: PeriodoSelectorProps) {
  const grupoId = useId();
  const desdeId = useId();
  const hastaId = useId();
  const errorId = useId();

  // What the fields show: the current period, or what the user is typing
  const [desde, setDesde] = useState(fechas?.desde ?? '');
  const [hasta, setHasta] = useState(fechas?.hasta ?? '');
  // A new period from outside (table buttons, another equipment) replaces it
  const [origen, setOrigen] = useState(fechas);
  if (fechas?.desde !== origen?.desde || fechas?.hasta !== origen?.hasta) {
    setOrigen(fechas);
    setDesde(fechas?.desde ?? '');
    setHasta(fechas?.hasta ?? '');
  }

  const completo = desde !== '' && hasta !== '';
  const error = completo ? errorDe(desde, hasta, fechas?.min, fechas?.max) : null;

  function cambiar(nuevoDesde: string, nuevoHasta: string) {
    setDesde(nuevoDesde);
    setHasta(nuevoHasta);
    if (!nuevoDesde || !nuevoHasta) return;
    if (errorDe(nuevoDesde, nuevoHasta, fechas?.min, fechas?.max)) return;
    if (nuevoDesde !== fechas?.desde || nuevoHasta !== fechas?.hasta) onAplicar(nuevoDesde, nuevoHasta);
  }

  // Emptied with the calendar's "Borrar" (or by hand): back to the period's date
  const restaurar = () => {
    if (!desde) setDesde(fechas?.desde ?? '');
    if (!hasta) setHasta(fechas?.hasta ?? '');
  };

  const alClic = (e: MouseEvent<HTMLInputElement>) => abrirCalendario(e.currentTarget);
  const alTecla = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      abrirCalendario(e.currentTarget);
    }
  };

  // Range with data: tooltip of the box (no text line under it)
  const rango =
    fechas?.min && fechas.max
      ? `Datos del ${ddmmaaaa(fechas.min)} al ${ddmmaaaa(fechas.max)} (UTC)${fechas.hasta === fechas.max ? ' · hasta la última medición' : ''}`
      : undefined;
  const describe = error ? errorId : undefined;
  const campo = (
    id: string,
    etiqueta: string,
    valor: string,
    min: string | undefined,
    max: string | undefined,
    onChange: (v: string) => void,
  ) => (
    <div className={styles.periodoCampo}>
      <label htmlFor={id} className={styles.periodoEtiqueta}>
        {etiqueta}
      </label>
      <input
        id={id}
        type="date"
        className={styles.periodoInput}
        value={valor}
        min={min}
        max={max}
        required
        disabled={!fechas}
        aria-invalid={error ? true : undefined}
        aria-describedby={describe}
        onChange={(e) => onChange(e.target.value)}
        onBlur={restaurar}
        onClick={alClic}
        onKeyDown={alTecla}
      />
    </div>
  );

  return (
    <div className={styles.periodoSelector} role="group" aria-labelledby={grupoId}>
      <span id={grupoId} className={styles.filterLabel}>
        Período
      </span>
      <div className={`${styles.periodoCaja} ${error ? styles.periodoCajaError : ''}`} title={rango}>
        <CalendarIcon />
        {campo(desdeId, 'Desde', desde, fechas?.min, hasta || fechas?.max, (v) => cambiar(v, hasta))}
        <span className={styles.periodoFlecha} aria-hidden="true">
          →
        </span>
        {campo(hastaId, 'Hasta', hasta, desde || fechas?.min, fechas?.max, (v) => cambiar(desde, v))}
      </div>
      {error && (
        <p id={errorId} className={styles.periodoError} role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
