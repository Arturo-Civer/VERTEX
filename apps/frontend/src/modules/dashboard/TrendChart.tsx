import { useId, useLayoutEffect, useRef, useState } from 'react';
import type { Umbral } from './operacion.service';
import styles from './dashboard.module.css';

/** One point of the series: the middle of its interval (ms, UTC) and its value */
export interface TrendSeriesPoint {
  t: number;
  /** Average of the interval */
  value: number;
  /** Maximum of the interval (backend data only) */
  max?: number;
  /** Readings out of the threshold in the interval */
  marcas?: number;
}

/** EVENTO / MANTENIMIENTO block of the events table, drawn as a background band */
export interface TrendBanda {
  desde: number;
  hasta: number;
  tipo: 'EVENTO' | 'MANTENIMIENTO';
}

interface TrendChartProps {
  title: string;
  /** Y axis title: variable and unit, e.g. "Vibración (mm/s)" */
  yTitle: string;
  points: TrendSeriesPoint[];
  /** Interval of each point (ms): consecutive points further apart are not joined */
  puntoMs: number;
  /** Period on the X axis (ms, UTC): the same as the donut and the events table */
  desde: number;
  hasta: number;
  /** Reference value drawn as a dashed red line */
  nominalValue: number;
  /** Configured threshold of the variable (null: none) */
  umbral?: Umbral | null;
  bandas?: TrendBanda[];
  /** Loading / empty / error message shown under the title */
  notice?: { text: string; error?: boolean };
}

const NOMINAL_COLOR = '#E53935';
const PROMEDIO_COLOR = '#2E75B6';
const MAXIMO_COLOR = '#9CC3E6';
const UMBRAL_COLOR = '#B71C1C';
const UMBRAL_OFF_COLOR = '#9E9E9E';
const MARCA_COLOR = '#E53935';
// Same tints as the Evento / Mantenimiento states of the events table
const BANDA_COLOR = { EVENTO: '#FFEBEE', MANTENIMIENTO: '#FFF3E0' } as const;
// Point markers only while they are at least this far apart (px)
const MARKER_GAP = 10;
/** Text size in screen pixels: the chart is drawn at its real size, not scaled */
const FONT = 11;
/** Size before the first measurement (and the smallest one drawn) */
const MIN_W = 240;
const MIN_H = 140;

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
/** X tick steps, aligned to 00:00 UTC */
const TICK_STEPS = [
  15 * MIN, 30 * MIN, HOUR, 2 * HOUR, 3 * HOUR, 6 * HOUR, 12 * HOUR,
  DAY, 2 * DAY, 3 * DAY, 4 * DAY, 5 * DAY, 7 * DAY, 14 * DAY, 30 * DAY,
];

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

const dos = (n: number) => String(n).padStart(2, '0');
/** dd/mm, or dd/mm hh:mm when the ticks are less than a day apart (UTC) */
function tickLabel(t: number, conHora: boolean) {
  const d = new Date(t);
  const fecha = `${dos(d.getUTCDate())}/${dos(d.getUTCMonth() + 1)}`;
  return conHora ? `${fecha} ${dos(d.getUTCHours())}:${dos(d.getUTCMinutes())}` : fecha;
}

/**
 * Pure-SVG line chart on a real time axis: the X axis spans exactly the
 * selected period, each point sits at its time, and the line breaks where
 * there is no data (motor off or maintenance) instead of joining far points.
 * Adds the interval maximum, the configured threshold, the points with event
 * marks and the Evento / Mantenimiento blocks of the events table.
 */
export function TrendChart({
  title,
  yTitle,
  points,
  puntoMs,
  desde,
  hasta,
  nominalValue,
  umbral,
  bandas = [],
  notice,
}: TrendChartProps) {
  // Clip id for the plot area (useId has characters url(#…) does not accept)
  const clipId = `trend-clip-${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`;
  // Drawn at the real size of its box (one SVG unit = one pixel), so the
  // plot fills the whole box and the text keeps the same size on any screen
  const caja = useRef<HTMLDivElement>(null);
  const [tam, setTam] = useState({ w: 400, h: 200 });
  useLayoutEffect(() => {
    const el = caja.current;
    if (!el) return;
    const medir = () => {
      const w = Math.max(MIN_W, Math.round(el.clientWidth));
      const h = Math.max(MIN_H, Math.round(el.clientHeight));
      setTam((t) => (t.w === w && t.h === h ? t : { w, h }));
    };
    medir();
    const obs = new ResizeObserver(medir);
    obs.observe(el);
    return () => obs.disconnect();
  }, []);
  const { w, h } = tam;
  // Left: Y title + labels; right: "Nominal: X" / threshold labels; bottom: X labels + title
  const pad = { top: 12, right: 76, bottom: 44, left: 56 };
  const innerW = w - pad.left - pad.right;
  const innerH = h - pad.top - pad.bottom;

  // Threshold lines: an enabled threshold always shows (it widens the Y
  // domain); a disabled one only if it falls inside the data (e.g. the 396 V
  // voltage limits would flatten data around 220 V)
  const umbrales = [
    { valor: umbral?.max ?? null, etiqueta: 'Máx.' },
    { valor: umbral?.min ?? null, etiqueta: 'Mín.' },
  ].filter((u): u is { valor: number; etiqueta: string } => u.valor !== null);

  // Y domain fits the data (averages and maximums), the nominal line and the
  // enabled thresholds with some headroom, snapped to round numbers: three
  // labels (min, mid, max) one nice step apart
  const values = [
    ...points.map((p) => p.value),
    ...points.flatMap((p) => (p.max === undefined ? [] : [p.max])),
    nominalValue,
    ...(umbral?.habilitado ? umbrales.map((u) => u.valor) : []),
  ];
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

  const duracion = Math.max(hasta - desde, 1);
  const xFor = (t: number) => pad.left + ((t - desde) / duracion) * innerW;
  const yFor = (v: number) => pad.top + innerH - ((v - minY) / (maxY - minY)) * innerH;

  // Line segments: a gap longer than 1.5 intervals starts a new segment
  const coords = points.map((p) => ({
    ...p,
    x: xFor(p.t),
    y: yFor(p.value),
    yMax: p.max === undefined ? null : yFor(p.max),
  }));
  let pathD = '';
  let pathMax = '';
  const aislados: typeof coords = [];
  coords.forEach((c, i) => {
    const unidoAntes = i > 0 && c.t - coords[i - 1].t <= puntoMs * 1.5;
    const unidoDespues = i < coords.length - 1 && coords[i + 1].t - c.t <= puntoMs * 1.5;
    const orden = unidoAntes ? 'L' : 'M';
    pathD += `${orden} ${c.x.toFixed(1)} ${c.y.toFixed(1)} `;
    if (c.yMax !== null) pathMax += `${orden} ${c.x.toFixed(1)} ${c.yMax.toFixed(1)} `;
    if (!unidoAntes && !unidoDespues) aislados.push(c);
  });
  const conMarca = coords.filter((c) => (c.marcas ?? 0) > 0);
  // A marker on every point while they do not overlap; otherwise only the isolated ones
  const conMarcadores = coords.length <= innerW / MARKER_GAP;

  // Tooltip of a point: interval start, average, maximum and event marks
  const conHoraPunto = puntoMs < DAY;
  const tooltip = (c: (typeof coords)[number]) =>
    [
      tickLabel(c.t - puntoMs / 2, conHoraPunto),
      `promedio ${format(c.value, 2)}`,
      c.max === undefined ? null : `máx. ${format(c.max, 2)}`,
      c.marcas ? `${c.marcas} marca${c.marcas === 1 ? '' : 's'} de evento` : null,
    ]
      .filter(Boolean)
      .join(' · ');
  const umbralesVisibles = umbrales.filter((u) => umbral?.habilitado || (u.valor >= minY && u.valor <= maxY));
  const umbralColor = umbral?.habilitado ? UMBRAL_COLOR : UMBRAL_OFF_COLOR;
  // Threshold label moved 12px away from the nominal label when they would overlap
  const etiquetaUmbralY = (valor: number) => {
    const y = yFor(valor);
    const dy = y - yFor(nominalValue);
    return Math.abs(dy) < 12 ? yFor(nominalValue) + (dy < 0 ? -12 : 12) : y;
  };

  // X ticks: the smallest UTC-aligned step that leaves room for the labels
  const conHora = (paso: number) => paso < DAY;
  // Room per label: "dd/mm hh:mm" is about twice as wide as "dd/mm"
  const maxTicks = (paso: number) => Math.max(2, Math.floor(innerW / (conHora(paso) ? 80 : 40)));
  const pasoX = TICK_STEPS.find((p) => duracion / p <= maxTicks(p)) ?? 30 * DAY;
  const ticks: number[] = [];
  for (let t = Math.ceil(desde / pasoX) * pasoX; t <= hasta; t += pasoX) ticks.push(t);

  const gridYs = [0.25, 0.5, 0.75, 1].map((f) => pad.top + innerH * (1 - f));
  const nominalY = yFor(nominalValue);
  const plotBottom = pad.top + innerH;

  return (
    <div className={styles.card}>
      {/* Title and notice on one line (they wrap when there is no room) */}
      <div className={styles.trendHeader}>
        <h3 className={styles.cardTitle}>{title}</h3>
        {notice && (
          <p
            className={`${styles.chartNotice} ${notice.error ? styles.chartNoticeError : ''}`}
            role={notice.error ? 'alert' : 'status'}
          >
            {notice.text}
          </p>
        )}
      </div>
      <div ref={caja} className={styles.trendChart}>
        <svg viewBox={`0 0 ${w} ${h}`} width={w} height={h}>
          <defs>
            <clipPath id={clipId}>
              <rect x={pad.left} y={pad.top - 4} width={innerW} height={innerH + 8} />
            </clipPath>
          </defs>

          {/* Evento / Mantenimiento bands, behind everything */}
          {bandas.map((b) => {
            const x1 = xFor(Math.max(b.desde, desde));
            const x2 = xFor(Math.min(b.hasta, hasta));
            return x2 > x1 ? (
              <rect
                key={`${b.tipo}-${b.desde}`}
                x={x1}
                y={pad.top}
                width={x2 - x1}
                height={innerH}
                fill={BANDA_COLOR[b.tipo]}
              />
            ) : null;
          })}

          {gridYs.map((gy, i) => (
            <line key={i} x1={pad.left} y1={gy} x2={w - pad.right} y2={gy} stroke="#E0E0E0" strokeDasharray="3 3" />
          ))}

          {/* Axes */}
          <line x1={pad.left} y1={pad.top} x2={pad.left} y2={plotBottom} stroke="#BDBDBD" />
          <line x1={pad.left} y1={plotBottom} x2={w - pad.right} y2={plotBottom} stroke="#BDBDBD" />

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
          <text x={w - pad.right + 6} y={nominalY + 3.5} textAnchor="start" fontSize={FONT} fontWeight={600} fill={NOMINAL_COLOR}>
            Nominal: {nominalValue.toLocaleString('es-CO')}
          </text>

          {/* Configured thresholds: dark red when enabled, grey when disabled */}
          {umbralesVisibles.map((u) => (
            <g key={u.etiqueta}>
              <line
                x1={pad.left}
                y1={yFor(u.valor)}
                x2={w - pad.right}
                y2={yFor(u.valor)}
                stroke={umbralColor}
                strokeWidth={1}
                strokeDasharray="2 3"
              />
              <text x={w - pad.right + 6} y={etiquetaUmbralY(u.valor) + 3.5} fontSize={FONT - 1} fill={umbralColor}>
                {u.etiqueta} {u.valor.toLocaleString('es-CO')}
                {umbral?.habilitado ? '' : ' (desh.)'}
              </text>
            </g>
          ))}

          {/* Data layers, clipped to the plot area */}
          <g clipPath={`url(#${clipId})`}>
            {pathMax && <path d={pathMax} fill="none" stroke={MAXIMO_COLOR} strokeWidth={1} strokeLinejoin="round" />}
            <path d={pathD} fill="none" stroke={PROMEDIO_COLOR} strokeWidth={2} strokeLinejoin="round" />
            {(conMarcadores ? coords : aislados).map((c) => (
              <circle key={c.t} cx={c.x} cy={c.y} r={conMarcadores ? 3 : 1.8} fill="#1F3864">
                <title>{tooltip(c)}</title>
              </circle>
            ))}
            {/* Points with event marks, always visible */}
            {conMarca.map((c) => (
              <circle key={`m-${c.t}`} cx={c.x} cy={c.y} r={3.5} fill={MARCA_COLOR} stroke="#FFFFFF" strokeWidth={1}>
                <title>{tooltip(c)}</title>
              </circle>
            ))}
          </g>

          {/* X ticks and labels (UTC) */}
          {ticks.map((t) => (
            <g key={t}>
              <line x1={xFor(t)} y1={plotBottom} x2={xFor(t)} y2={plotBottom + 4} stroke="#BDBDBD" />
              <text x={xFor(t)} y={plotBottom + 16} textAnchor="middle" fontSize={FONT} fill="#757575">
                {tickLabel(t, conHora(pasoX))}
              </text>
            </g>
          ))}

          {/* Y labels */}
          {[0, 0.5, 1].map((f) => {
            const val = minY + f * (maxY - minY);
            const y = pad.top + innerH * (1 - f);
            return (
              <text key={f} x={pad.left - 6} y={y + 4} textAnchor="end" fontSize={FONT} fill="#757575">
                {format(val, decimals)}
              </text>
            );
          })}

          {/* Axis titles */}
          <text
            x={12}
            y={pad.top + innerH / 2}
            transform={`rotate(-90 12 ${pad.top + innerH / 2})`}
            textAnchor="middle"
            fontSize={FONT}
            fontWeight={600}
            fill="#424242"
          >
            {yTitle}
          </text>
          <text x={pad.left + innerW / 2} y={h - 6} textAnchor="middle" fontSize={FONT} fontWeight={600} fill="#424242">
            Fecha (UTC)
          </text>
        </svg>
      </div>

      <ul className={styles.trendLegend}>
        <li>
          <span className={styles.trendLegendLine} style={{ background: PROMEDIO_COLOR }} />
          Promedio
        </li>
        {pathMax && (
          <li>
            <span className={styles.trendLegendLine} style={{ background: MAXIMO_COLOR }} />
            Máximo
          </li>
        )}
        <li>
          <span className={styles.trendLegendDash} style={{ borderColor: NOMINAL_COLOR }} />
          Nominal
        </li>
        {umbralesVisibles.length > 0 && (
          <li>
            <span className={styles.trendLegendDash} style={{ borderColor: umbralColor }} />
            Umbral{umbral?.habilitado ? '' : ' (deshabilitado)'}
          </li>
        )}
        {conMarca.length > 0 && (
          <li>
            <span className={styles.trendLegendDot} style={{ background: MARCA_COLOR }} />
            Marca de evento
          </li>
        )}
        {bandas.some((b) => b.tipo === 'EVENTO') && (
          <li>
            <span className={styles.trendLegendBox} style={{ background: BANDA_COLOR.EVENTO }} />
            Evento
          </li>
        )}
        {bandas.some((b) => b.tipo === 'MANTENIMIENTO') && (
          <li>
            <span className={styles.trendLegendBox} style={{ background: BANDA_COLOR.MANTENIMIENTO }} />
            Mantenimiento
          </li>
        )}
      </ul>
    </div>
  );
}
