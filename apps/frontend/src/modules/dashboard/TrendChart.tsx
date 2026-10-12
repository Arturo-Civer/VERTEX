import type { TrendPoint } from '../../contracts/dashboard';
import styles from './dashboard.module.css';

interface TrendChartProps {
  title: string;
  data: TrendPoint[];
  /** Reference value drawn as a dashed red line */
  nominalValue: number;
}

const NOMINAL_COLOR = '#E53935';

/** Smallest "nice" step (1, 2, 2.5 or 5 × 10^n) that is ≥ raw */
function niceStep(raw: number) {
  const pow10 = 10 ** Math.floor(Math.log10(raw));
  const nice = [1, 2, 2.5, 5, 10].find((m) => m * pow10 >= raw) ?? 10;
  return nice * pow10;
}

/** Decimals needed to print multiples of the given step (0.5 → 1, 0.25 → 2) */
function decimalsFor(step: number) {
  const text = String(Number(step.toFixed(4)));
  const dot = text.indexOf('.');
  return dot < 0 ? 0 : text.length - dot - 1;
}

function format(value: number, decimals: number) {
  return value.toLocaleString('es-CO', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

/** Pure-SVG line chart for MVP (swap for Recharts LineChart when available) */
export function TrendChart({ title, data, nominalValue }: TrendChartProps) {
  const w = 400;
  const h = 180;
  // Right padding leaves room for the "Nominal: X" label outside the plot
  const pad = { top: 16, right: 64, bottom: 28, left: 40 };
  const innerW = w - pad.left - pad.right;
  const innerH = h - pad.top - pad.bottom;

  // Y domain fits the data and the nominal line with some headroom, so
  // variables that move little around their nominal (e.g. frequency) are
  // still readable instead of flattening against a 0-based axis. The domain
  // snaps to round numbers: three labels (min, mid, max) one nice step apart.
  const values = [...data.map((d) => d.value), nominalValue];
  const dataMin = Math.min(...values);
  const dataMax = Math.max(...values);
  const span = dataMax - dataMin || Math.abs(nominalValue) || 1;
  const lo = dataMin - span * 0.1;
  const hi = dataMax + span * 0.1;
  let step = niceStep((hi - lo) / 2);
  let minY = Math.floor(lo / step) * step;
  while (minY + 2 * step < hi) {
    step = niceStep(step * 1.01);
    minY = Math.floor(lo / step) * step;
  }
  const maxY = minY + 2 * step;
  const decimals = decimalsFor(step);

  const yFor = (v: number) => pad.top + innerH - ((v - minY) / (maxY - minY)) * innerH;

  const points = data.map((d, i) => ({
    x: pad.left + (i / (data.length - 1 || 1)) * innerW,
    y: yFor(d.value),
    ...d,
  }));

  const pathD = points
    .map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`)
    .join(' ');

  // grid lines
  const gridYs = [0.25, 0.5, 0.75, 1].map((t) => pad.top + innerH * (1 - t));
  const nominalY = yFor(nominalValue);

  return (
    <div className={styles.card}>
      <h3 className={styles.cardTitle}>{title}</h3>
      <div className={styles.trendChart}>
        <svg
          viewBox={`0 0 ${w} ${h}`}
          width="100%"
          height="100%"
          preserveAspectRatio="xMidYMid meet"
        >
          {gridYs.map((gy, i) => (
            <line
              key={i}
              x1={pad.left}
              y1={gy}
              x2={w - pad.right}
              y2={gy}
              stroke="#E0E0E0"
              strokeDasharray="3 3"
            />
          ))}

          {/* Nominal reference line + label in the right margin */}
          <line
            x1={pad.left}
            y1={nominalY}
            x2={w - pad.right}
            y2={nominalY}
            stroke={NOMINAL_COLOR}
            strokeWidth={1.5}
            strokeDasharray="6 4"
          />
          <text
            x={w - pad.right + 6}
            y={nominalY + 3.5}
            textAnchor="start"
            fontSize={10}
            fontWeight={600}
            fill={NOMINAL_COLOR}
          >
            Nominal: {nominalValue.toLocaleString('es-CO')}
          </text>

          <path d={pathD} fill="none" stroke="#2E75B6" strokeWidth={2.5} />
          {points.map((p) => (
            <circle key={p.day} cx={p.x} cy={p.y} r={3.5} fill="#1F3864" />
          ))}
          {/* X labels */}
          {points.map((p) => (
            <text
              key={`lbl-${p.day}`}
              x={p.x}
              y={h - 8}
              textAnchor="middle"
              fontSize={11}
              fill="#757575"
            >
              {p.day}
            </text>
          ))}
          {/* Y labels */}
          {[0, 0.5, 1].map((t) => {
            const val = minY + t * (maxY - minY);
            const y = pad.top + innerH * (1 - t);
            return (
              <text
                key={t}
                x={pad.left - 6}
                y={y + 4}
                textAnchor="end"
                fontSize={11}
                fill="#757575"
              >
                {format(val, decimals)}
              </text>
            );
          })}
        </svg>
      </div>
    </div>
  );
}
