import { useEffect, useId, useRef, useState } from 'react';
import styles from './dashboard.module.css';

/** Dates shown and allowed by the selector (AAAA-MM-DD, UTC days) */
export interface PeriodoFechas {
  /** Current period, whatever set it (these calendars or the table buttons) */
  desde: string;
  hasta: string;
  /** Days with records: the calendars cannot go outside them */
  min?: string;
  max?: string;
}

interface PeriodoSelectorProps {
  id: string;
  /** Undefined while the first period is loading */
  fechas?: PeriodoFechas;
  onAplicar: (desde: string, hasta: string) => void;
}

/** dd/mm/aaaa from AAAA-MM-DD */
const ddmmaaaa = (fecha: string) => `${fecha.slice(8, 10)}/${fecha.slice(5, 7)}/${fecha.slice(0, 4)}`;

/**
 * Period selector of the donut: a button with the current dates that opens
 * two calendars (start and end date) for a free range. The fixed periods are
 * the buttons of the events table; both set the same shared period.
 */
export function PeriodoSelector({ id, fechas, onAplicar }: PeriodoSelectorProps) {
  const [abierto, setAbierto] = useState(false);
  const [desde, setDesde] = useState('');
  const [hasta, setHasta] = useState('');
  const raiz = useRef<HTMLDivElement>(null);
  const boton = useRef<HTMLButtonElement>(null);
  const inicioId = useId();
  const finId = useId();
  const errorId = useId();

  // Close on Escape (focus back to the button) or on a click outside
  useEffect(() => {
    if (!abierto) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setAbierto(false);
        boton.current?.focus();
      }
    };
    const onPointer = (e: PointerEvent) => {
      if (!raiz.current?.contains(e.target as Node)) setAbierto(false);
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('pointerdown', onPointer);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('pointerdown', onPointer);
    };
  }, [abierto]);

  function abrir() {
    if (abierto) {
      setAbierto(false);
      return;
    }
    // The calendars start at the current period
    setDesde(fechas?.desde ?? '');
    setHasta(fechas?.hasta ?? '');
    setAbierto(true);
  }

  let error: string | null = null;
  if (!desde || !hasta) error = 'Elige la fecha de inicio y la de fin';
  else if (desde > hasta) error = 'La fecha de inicio no puede ser posterior a la de fin';

  function aplicar(e: React.FormEvent) {
    e.preventDefault();
    if (error) return;
    onAplicar(desde, hasta);
    setAbierto(false);
    boton.current?.focus();
  }

  return (
    <div className={styles.periodoSelector} ref={raiz}>
      <button
        ref={boton}
        id={id}
        type="button"
        className={`${styles.filterSelect} ${styles.periodoBoton}`}
        aria-haspopup="dialog"
        aria-expanded={abierto}
        onClick={abrir}
      >
        {fechas ? `${ddmmaaaa(fechas.desde)} – ${ddmmaaaa(fechas.hasta)}` : 'Cargando…'}
      </button>

      {abierto && (
        <form className={styles.periodoPanel} role="dialog" aria-label="Elegir período" onSubmit={aplicar}>
          <div className={styles.periodoFechas}>
            <div className={styles.periodoCampo}>
              <label htmlFor={inicioId} className={styles.filterLabel}>
                Fecha inicio
              </label>
              <input
                id={inicioId}
                type="date"
                className={styles.periodoInput}
                value={desde}
                min={fechas?.min}
                max={hasta || fechas?.max}
                required
                autoFocus
                aria-describedby={error ? errorId : undefined}
                onChange={(e) => setDesde(e.target.value)}
              />
            </div>
            <div className={styles.periodoCampo}>
              <label htmlFor={finId} className={styles.filterLabel}>
                Fecha fin
              </label>
              <input
                id={finId}
                type="date"
                className={styles.periodoInput}
                value={hasta}
                min={desde || fechas?.min}
                max={fechas?.max}
                required
                aria-describedby={error ? errorId : undefined}
                onChange={(e) => setHasta(e.target.value)}
              />
            </div>
          </div>

          {fechas?.min && fechas.max && (
            <p className={styles.periodoAyuda}>
              Datos del {ddmmaaaa(fechas.min)} al {ddmmaaaa(fechas.max)} (UTC)
            </p>
          )}
          {error && desde && hasta && (
            <p id={errorId} className={styles.periodoError} role="alert">
              {error}
            </p>
          )}

          <div className={styles.periodoAcciones}>
            <button type="button" className={styles.periodoCancelar} onClick={() => setAbierto(false)}>
              Cancelar
            </button>
            <button type="submit" className={styles.periodoAplicar} disabled={error !== null}>
              Aplicar
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
