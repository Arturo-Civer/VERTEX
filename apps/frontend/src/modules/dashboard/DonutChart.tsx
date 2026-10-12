import type { DonutSegment } from '../../contracts/dashboard';
import styles from './dashboard.module.css';

interface DonutChartProps {
  segments: DonutSegment[];
  totalHours: number;
  totalLabel: string;
}

/** Pure-SVG donut (no external chart lib required for MVP) */
export function DonutChart({ segments, totalHours, totalLabel }: DonutChartProps) {
  const size = 200;
  const stroke = 22;
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const total = segments.reduce((s, seg) => s + seg.hours, 0) || 1;

  let offset = 0;
  const arcs = segments.map((seg) => {
    const len = (seg.hours / total) * circumference;
    const arc = {
      ...seg,
      dash: len,
      gap: circumference - len,
      offset: -offset,
    };
    offset += len;
    return arc;
  });

  return (
    <div className={styles.card}>
      <div className={styles.donutWrap}>
        <div className={styles.donutChart} style={{ width: size, height: size }}>
          <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
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
              {totalHours.toLocaleString('es-CO')} h
            </div>
            <div className={styles.donutLabel}>{totalLabel}</div>
          </div>
        </div>

        <div className={styles.donutLegend}>
          {segments.map((s) => (
            <div key={s.status} className={styles.legendItem}>
              <span
                className={styles.legendDot}
                style={{ backgroundColor: s.color }}
              />
              <span className={styles.legendLabel}>{s.label}</span>
              <span className={styles.legendValue}>{s.hours} h</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
