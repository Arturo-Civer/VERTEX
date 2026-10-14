import { useId, useState, useSyncExternalStore } from 'react';
import type { DonutSegment, MotorInfo, TimeUnit, ValidationStatus } from '../../contracts/dashboard';
import styles from './dashboard.module.css';

/** Evaluated period shown under the donut's center value */
export interface DonutPeriodo {
  /** e.g. "Del 14/09 al 14/10" */
  rango: string;
  /** Year line under the range: "2026", or "2025 – 2026" across a new year */
  anio: string;
  /** Last line, e.g. "(última medición)" */
  detalle?: string;
}

interface DonutPanelProps {
  segments: DonutSegment[];
  totalHours: number;
  motorInfo: MotorInfo;
  periodo?: DonutPeriodo;
  /** Loading / empty / error message shown under the legend */
  notice?: { text: string; error?: boolean };
}

const TIME_UNITS: {
  id: TimeUnit;
  label: string;
  suffix: string;
  /** Shorter suffix for the legend on phones */
  mobileSuffix: string;
  /** Letter glued to the donut's center value (720H) */
  centerSuffix: string;
  hoursPerUnit: number;
}[] = [
  { id: 'horas', label: 'Horas', suffix: 'h', mobileSuffix: 'h', centerSuffix: 'H', hoursPerUnit: 1 },
  { id: 'dias', label: 'Días', suffix: 'd', mobileSuffix: 'd', centerSuffix: 'D', hoursPerUnit: 24 },
  { id: 'semanas', label: 'Sem', suffix: 'sem', mobileSuffix: 's', centerSuffix: 'S', hoursPerUnit: 168 },
  { id: 'meses', label: 'Meses', suffix: 'mes', mobileSuffix: 'm', centerSuffix: 'M', hoursPerUnit: 720 },
];

// Same "phone" mode as the CSS (everything that is not desktop), so phones
// in landscape also get the short legend suffixes their font formula expects
const MOBILE_QUERY = 'not all and (min-width: 768px) and (min-height: 501px)';

function subscribeMobile(onChange: () => void) {
  const mql = window.matchMedia(MOBILE_QUERY);
  mql.addEventListener('change', onChange);
  return () => mql.removeEventListener('change', onChange);
}

/** True in phone mode; re-renders when the viewport crosses the breakpoint */
function useIsMobile() {
  return useSyncExternalStore(
    subscribeMobile,
    () => window.matchMedia(MOBILE_QUERY).matches,
    () => false,
  );
}

const STATUS_DISPLAY: Record<ValidationStatus, { label: string; color: string }> = {
  ENCENDIDO: { label: 'Encendido', color: '#1F3864' },
  APAGADO: { label: 'Apagado', color: '#90A4AE' },
  EVENTO: { label: 'Evento', color: '#E53935' },
  MANTENIMIENTO: { label: 'Mantenimiento', color: '#FF9800' },
};

/** Hours shown as-is; converted units with 1 decimal */
function formatValue(hours: number, unit: (typeof TIME_UNITS)[number]) {
  if (unit.hoursPerUnit === 1) return hours.toLocaleString('es-CO');
  return (hours / unit.hoursPerUnit).toLocaleString('es-CO', {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  });
}

/**
 * Donut card: motor info (left), pure-SVG donut (center), time-unit picker
 * (right) and the legend underneath.
 */
export function DonutPanel({ segments, totalHours, motorInfo, periodo, notice }: DonutPanelProps) {
  const [unitId, setUnitId] = useState<TimeUnit>('horas');
  const unit = TIME_UNITS.find((u) => u.id === unitId) ?? TIME_UNITS[0];
  const legendSuffix = useIsMobile() ? unit.mobileSuffix : unit.suffix;
  const radioName = useId();

  const size = 200;
  const stroke = 22;
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const total = segments.reduce((s, seg) => s + seg.hours, 0) || 1;

  const arcs = segments.map((seg, i) => {
    const before = segments.slice(0, i).reduce((s, x) => s + x.hours, 0);
    const len = (seg.hours / total) * circumference;
    return { ...seg, dash: len, gap: circumference - len, offset: -(before / total) * circumference };
  });

  const status = STATUS_DISPLAY[motorInfo.estado];
  const producto = motorInfo.estado === 'APAGADO' ? 'Sin asignación' : motorInfo.producto;

  // translate="no": browser translators (e.g. Chrome's) swap the text nodes
  // for their own copies, so React's updates to the values and units stop
  // showing ("mes" was even translated as if it were English "mess").
  return (
    <div className={`${styles.card} notranslate`} translate="no">
      <div className={styles.donutBody}>
        {/* Left: motor info */}
        <dl className={styles.motorInfo}>
          <div className={styles.motorInfoRow}>
            <dt>Producto:</dt>
            <dd>{producto}</dd>
          </div>
          <div className={styles.motorInfoRow}>
            <dt>Estado:</dt>
            <dd style={{ color: status.color }}>{status.label}</dd>
          </div>
          <div className={styles.motorInfoRow}>
            <dt>Línea:</dt>
            <dd>{motorInfo.linea}</dd>
          </div>
        </dl>

        {/* Center: donut */}
        <div className={styles.donutWrap}>
          <div className={styles.donutChart}>
            <svg viewBox={`0 0 ${size} ${size}`}>
              {/* track */}
              <circle
                cx={size / 2}
                cy={size / 2}
                r={radius}
                fill="none"
                stroke="#E8EEF5"
                strokeWidth={stroke}
              />
              {arcs.map((arc) => (
                <circle
                  key={arc.status}
                  cx={size / 2}
                  cy={size / 2}
                  r={radius}
                  fill="none"
                  stroke={arc.color}
                  strokeWidth={stroke}
                  strokeDasharray={`${arc.dash} ${arc.gap}`}
                  strokeDashoffset={arc.offset}
                  strokeLinecap="butt"
                  transform={`rotate(-90 ${size / 2} ${size / 2})`}
                />
              ))}
            </svg>
            <div className={styles.donutCenter}>
              <div className={styles.donutValue}>
                {formatValue(totalHours, unit)}
                <span className={styles.donutUnit}>{unit.centerSuffix}</span>
              </div>
              {periodo && (
                <div className={styles.donutPeriod}>
                  <span>{periodo.rango}</span>
                  <span>{periodo.anio}</span>
                  {periodo.detalle && <span>{periodo.detalle}</span>}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Right: time unit */}
        <fieldset className={styles.unitPicker}>
          <legend className={styles.unitPickerTitle}>Unidad</legend>
          {TIME_UNITS.map((u) => (
            <label key={u.id} className={styles.unitOption}>
              <input
                type="radio"
                name={radioName}
                value={u.id}
                checked={unitId === u.id}
                onChange={() => setUnitId(u.id)}
              />
              {u.label}
            </label>
          ))}
        </fieldset>
      </div>

      {/* Legend */}
      <div className={styles.donutLegend}>
        {segments.map((s) => (
          <div key={s.status} className={styles.legendItem}>
            <span className={styles.legendDot} style={{ backgroundColor: s.color }} />
            <span className={styles.legendLabel}>{s.label}</span>
            <span className={styles.legendValue}>
              {formatValue(s.hours, unit)} {legendSuffix}
            </span>
          </div>
        ))}
      </div>
      {notice && (
        <p
          className={`${styles.chartNotice} ${notice.error ? styles.chartNoticeError : ''}`}
          role={notice.error ? 'alert' : 'status'}
        >
          {notice.text}
        </p>
      )}
    </div>
  );
}
