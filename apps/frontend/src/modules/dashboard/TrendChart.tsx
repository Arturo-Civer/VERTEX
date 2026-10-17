import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import type { ValidationStatus } from '../../contracts/dashboard';
import { BotonReintentar } from './BotonReintentar';
import styles from './dashboard.module.css';

/** Resumen: running time only, whole period in view. Detalle: real time, scrolls */
export type TrendModo = 'resumen' | 'detalle';

/** One point of the series: one interval with the motor running */
export interface TrendSeriesPoint {
  /** Middle of its interval (ms, UTC) */
  t: number;
  /** Average of the interval (tooltip only) */
  value: number;
  /** Maximum of the interval: the drawn value (simulated data has none: value) */
  max?: number;
  /** Minutes with the motor running in the interval: its width in Resumen */
  lecturas?: number;
  /** Readings out of the database threshold (tooltip only) */
  marcas?: number;
}

/** State block of GET /bloques (the donut and the events table): ms, UTC */
export interface TrendEstado {
  desde: number;
  hasta: number;
  segmento: ValidationStatus;
}

interface TrendChartProps {
  title: string;
  /** Drawn inside the plot, top left (e.g. "A") */
  unidad?: string;
  modo: TrendModo;
  onModoChange: (modo: TrendModo) => void;
  points: TrendSeriesPoint[];
  /** Interval of each point (ms) */
  puntoMs: number;
  /** Period (ms, UTC): the same as the donut and the events table */
  desde: number;
  hasta: number;
  /**
   * Red reference line (null: none). It comes from referenciasTendencia.ts:
   * the DEMO values, or UMBRAL_MAX of ConfiguracionVariables with real data
   */
  linea: number | null;
  /** Mark the episodes above the line (measured variables only) */
  marcarFuera: boolean;
  /** suave: monotone curve through the points (never past them); recta: straight segments */
  curva?: 'suave' | 'recta';
  /** State blocks of the period, any order (Detalle) */
  estados?: TrendEstado[];
  /** Loading / empty / error message, over the plot */
  notice?: { text: string; error?: boolean; reintentar?: () => void };
}

// Existing --vx-* colors (style, not presentation attributes, so var() works);
// the band tints are the Evento / Mantenimiento ones of the events table
const LINEA = 'var(--vx-secondary)';
const ROJO = 'var(--vx-danger)';
const OSCURO = 'var(--vx-primary)';
const TENUE = 'var(--vx-text-muted)';
const REJILLA = 'var(--vx-border)';
const BLANCO = 'var(--vx-white)';
const BANDA_COLOR = { EVENTO: '#FFEBEE', MANTENIMIENTO: '#FFF3E0' } as const;

/** Text size in screen pixels: the chart is drawn at its real size, not scaled */
const FONT = 11;
/** Approximate width of a character at FONT (labels are digits and "/", ":") */
const CHAR_W = 6.2;
/** Width of a two-line "dd/mm" / "hh:mm" label plus its gap */
const LABEL_W = 38;
/** Points with a date in Detalle */
const MAX_MARCADORES = 50;
/** Widest scrollable plot (px) */
const MAX_DETALLE_W = 24_000;
const PAD_TOP = 8;
const PAD_BOTTOM = { resumen: 18, detalle: 30 } as const;
const MIN_W = 160;
const MIN_H = 120;

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

const SIN_ESTADOS: TrendEstado[] = [];

const MODOS: { id: TrendModo; label: string; corto: string }[] = [
  { id: 'resumen', label: 'Resumen', corto: 'Res.' },
  { id: 'detalle', label: 'Detalle', corto: 'Det.' },
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
const diaMes = (t: number) => {
  const d = new Date(t);
  return `${dos(d.getUTCDate())}/${dos(d.getUTCMonth() + 1)}`;
};
const horaMin = (t: number) => {
  const d = new Date(t);
  return `${dos(d.getUTCHours())}:${dos(d.getUTCMinutes())}`;
};

/** Drawn value of a point: the interval maximum */
const valor = (p: TrendSeriesPoint) => p.max ?? p.value;

/** Y scale fitted to the values and the reference line, with "nice" ticks */
function escalaY(valores: number[], linea: number | null) {
  let lo = linea ?? valores[0] ?? 0;
  let hi = lo;
  for (const v of valores) {
    if (v < lo) lo = v;
    if (v > hi) hi = v;
  }
  const span = hi - lo || Math.abs(lo) * 0.1 || 1;
  lo -= span * 0.12;
  hi += span * 0.12;
  // At least two regular ticks besides the red line
  const step = niceStep((hi - lo) / 4);
  const ticks: number[] = [];
  for (let v = Math.ceil(lo / step) * step; v <= hi + step * 1e-6; v += step) ticks.push(Number(v.toFixed(6)));
  return { lo, hi, ticks, decimals: decimalsFor(step) };
}

/** Tooltip of a point: interval start, maximum, average and database marks */
function tooltip(p: TrendSeriesPoint, puntoMs: number, unidad: string) {
  const u = unidad ? ` ${unidad}` : '';
  const inicio = p.t - puntoMs / 2;
  return [
    `${diaMes(inicio)} ${horaMin(inicio)} UTC`,
    p.max === undefined ? `${format(p.value, 2)}${u}` : `máx. ${format(p.max, 2)}${u}`,
    p.max === undefined ? null : `promedio ${format(p.value, 2)}${u}`,
    p.marcas ? `${p.marcas} marca${p.marcas === 1 ? '' : 's'} de evento` : null,
  ]
    .filter(Boolean)
    .join(' · ');
}

type Punto = { x: number; y: number };

/**
 * Path through the points: straight segments, or a monotone cubic curve
 * (Fritsch–Carlson, like d3's curveMonotoneX) that passes through every
 * point and never goes above or below its two neighbours, so it neither
 * invents values nor hides peaks.
 */
function trazado(pts: Punto[], suave: boolean) {
  if (!pts.length) return '';
  const f = (v: number) => v.toFixed(1);
  let d = `M ${f(pts[0].x)} ${f(pts[0].y)}`;
  if (!suave || pts.length < 3) {
    for (let k = 1; k < pts.length; k++) d += ` L ${f(pts[k].x)} ${f(pts[k].y)}`;
    return d;
  }
  const n = pts.length;
  const pend: number[] = [];
  for (let k = 0; k < n - 1; k++) pend.push((pts[k + 1].y - pts[k].y) / (pts[k + 1].x - pts[k].x || 1));
  const tan: number[] = [pend[0]];
  for (let k = 1; k < n - 1; k++) {
    const s0 = pend[k - 1];
    const s1 = pend[k];
    // Local peak or valley: flat tangent, so the curve turns right at the point
    if (s0 * s1 <= 0) {
      tan.push(0);
      continue;
    }
    const h0 = pts[k].x - pts[k - 1].x;
    const h1 = pts[k + 1].x - pts[k].x;
    const p = (s0 * h1 + s1 * h0) / (h0 + h1 || 1);
    tan.push(Math.sign(s0) * Math.min(Math.abs(s0), Math.abs(s1), 0.5 * Math.abs(p)) * 2);
  }
  tan.push(pend[n - 2]);
  for (let k = 0; k < n - 1; k++) {
    const a = pts[k];
    const b = pts[k + 1];
    const dx = (b.x - a.x) / 3;
    d += ` C ${f(a.x + dx)} ${f(a.y + dx * tan[k])} ${f(b.x - dx)} ${f(b.y - dx * tan[k + 1])} ${f(b.x)} ${f(b.y)}`;
  }
  return d;
}

/**
 * Episodes: runs of consecutive items above the line (`seguido(k)`: item k
 * directly follows k - 1). Each one is marked once, at its peak.
 */
function episodios(n: number, fuera: (k: number) => boolean, seguido: (k: number) => boolean, alto: (k: number) => number) {
  const lista: { inicio: number; fin: number; pico: number }[] = [];
  for (let k = 0; k < n; k++) {
    if (!fuera(k)) continue;
    const ultimo = lista[lista.length - 1];
    if (ultimo && ultimo.fin === k - 1 && seguido(k)) {
      ultimo.fin = k;
      if (alto(k) > alto(ultimo.pico)) ultimo.pico = k;
    } else {
      lista.push({ inicio: k, fin: k, pico: k });
    }
  }
  return lista;
}

// ── Resumen ──────────────────────────────────────────────────

interface PuntoResumen {
  /** Position along the running time, 0..1 */
  pos: number;
  p: TrendSeriesPoint;
}

/**
 * Running time only: each point is as wide as its running minutes, so stops
 * and maintenance take no room and the line goes straight to the next point.
 * Over `maxPuntos`, consecutive points merge keeping the highest one; the
 * episode peaks are placed from every point (`posiciones`).
 */
function serieResumen(points: TrendSeriesPoint[], puntoMs: number, maxPuntos: number) {
  const peso = (p: TrendSeriesPoint) => p.lecturas ?? puntoMs / MIN;
  const total = points.reduce((s, p) => s + peso(p), 0) || 1;
  const serie: PuntoResumen[] = [];
  const posiciones: number[] = [];
  // Days on the axis: position where each UTC day starts running
  const dias: { pos: number; t: number }[] = [];
  let acumulado = 0;
  let diaAnterior = -1;
  let grupoAnterior = -1;
  for (const p of points) {
    const inicio = p.t - puntoMs / 2;
    const dia = Math.floor(inicio / DAY);
    if (dia !== diaAnterior) dias.push({ pos: acumulado / total, t: inicio });
    diaAnterior = dia;
    const pos = (acumulado + peso(p) / 2) / total;
    posiciones.push(pos);
    acumulado += peso(p);
    const grupo = points.length > maxPuntos ? Math.min(maxPuntos - 1, Math.floor(pos * maxPuntos)) : serie.length;
    const ultimo = serie[serie.length - 1];
    if (grupo === grupoAnterior && ultimo) {
      if (valor(p) > valor(ultimo.p)) serie[serie.length - 1] = { pos, p };
    } else {
      serie.push({ pos, p });
    }
    grupoAnterior = grupo;
  }
  return { serie, dias, posiciones };
}

// ── Detalle ──────────────────────────────────────────────────

type Tipo = 'episodio' | 'pico' | 'sube' | 'baja' | 'apaga' | 'enciende';

const TIPO_TEXTO: Record<Tipo, string> = {
  episodio: 'Pico del episodio sobre la línea',
  pico: 'Pico',
  sube: 'Empieza a subir',
  baja: 'Baja',
  apaga: 'Se apaga',
  enciende: 'Vuelve a encender',
};

interface Slot {
  i: number;
  /** on: point with the motor running; off: stopped (or no reading); mtto: maintenance */
  kind: 'on' | 'off' | 'mtto';
  p?: TrendSeriesPoint;
  fuera: boolean;
}

interface Candidato {
  i: number;
  tipo: Tipo;
  /** 0: episode peak; 2: rise / peak / fall; 3: on / off */
  prioridad: number;
}

/**
 * Continuous timeline in intervals of `puntoMs` aligned to 00:00 UTC: the
 * interval maximum while the motor runs, its state block otherwise. Also the
 * episodes (consecutive running intervals above the line; a stop ends them)
 * and the candidate points to mark: only the changes (episode peaks, rise /
 * peak / fall of each running stretch, switching off and on), never every point.
 */
function serieDetalle(
  points: TrendSeriesPoint[],
  puntoMs: number,
  desde: number,
  hasta: number,
  estados: TrendEstado[],
  esFuera: (v: number) => boolean,
  relevante: number,
) {
  const g0 = Math.floor(desde / puntoMs) * puntoMs;
  const n = Math.min(50_000, Math.max(1, Math.ceil((hasta - g0) / puntoMs)));
  const porIndice = new Map<number, TrendSeriesPoint>();
  for (const p of points) {
    const i = Math.floor((p.t - g0) / puntoMs);
    if (i >= 0 && i < n) porIndice.set(i, p);
  }
  const ordenados = [...estados].sort((a, b) => a.desde - b.desde);
  const slots: Slot[] = [];
  let j = 0;
  for (let i = 0; i < n; i++) {
    const p = porIndice.get(i);
    if (p) {
      slots.push({ i, kind: 'on', p, fuera: esFuera(valor(p)) });
      continue;
    }
    const centro = g0 + (i + 0.5) * puntoMs;
    while (j < ordenados.length && ordenados[j].hasta <= centro) j++;
    const e = ordenados[j];
    const mtto = e && e.desde <= centro && e.segmento === 'MANTENIMIENTO';
    slots.push({ i, kind: mtto ? 'mtto' : 'off', fuera: false });
  }

  const candidatos = new Map<number, Candidato>();
  const agregar = (i: number, tipo: Tipo, prioridad: number) => {
    const actual = candidatos.get(i);
    if (!actual || prioridad < actual.prioridad) candidatos.set(i, { i, tipo, prioridad });
  };
  const v = (s: Slot) => (s.p ? valor(s.p) : 0);

  // Episodes: only running slots are out, so contiguous indices are
  // consecutive readings and a stop in between ends the episode
  const eps = episodios(n, (i) => slots[i].fuera, () => true, (i) => v(slots[i]));
  for (const e of eps) agregar(e.pico, 'episodio', 0);

  // Running stretches: switching on / off, and rise, peak and fall when the
  // peak stands out. The shape is read on a ~2 h moving average, so the
  // noise of single intervals does not count as a rise or a fall.
  const ventana = Math.max(1, Math.round(HOUR / puntoMs));
  for (let a = 0; a < n; ) {
    if (slots[a].kind !== 'on') {
      a++;
      continue;
    }
    let b = a;
    while (b + 1 < n && slots[b + 1].kind === 'on') b++;
    if (a > 0) agregar(a, 'enciende', 3);
    if (b < n - 1) agregar(b, 'apaga', 3);
    const suave = (m: number) => {
      let suma = 0;
      let cuenta = 0;
      for (let q = Math.max(a, m - ventana); q <= Math.min(b, m + ventana); q++) {
        suma += v(slots[q]);
        cuenta++;
      }
      return suma / cuenta;
    };
    const media = Array.from({ length: b - a + 1 }, (_, k) => suave(a + k));
    const sm = (m: number) => media[m - a];
    let pico = a;
    for (let m = a; m <= b; m++) if (sm(m) > sm(pico)) pico = m;
    let minimo = a;
    for (let m = a; m <= pico; m++) if (sm(m) < sm(minimo)) minimo = m;
    if (sm(pico) - sm(minimo) >= relevante) {
      // The peak itself: the highest interval around the smoothed peak
      let alto = pico;
      for (let m = Math.max(a, pico - ventana); m <= Math.min(b, pico + ventana); m++) if (v(slots[m]) > v(slots[alto])) alto = m;
      agregar(alto, 'pico', 2);
      if (minimo !== pico) agregar(minimo, 'sube', 2);
      const mitad = (sm(pico) + sm(minimo)) / 2;
      for (let m = pico + 1; m <= b; m++) {
        if (sm(m) <= mitad) {
          agregar(m, 'baja', 2);
          break;
        }
      }
    }
    a = b + 1;
  }

  return { g0, n, slots, episodios: eps, candidatos: [...candidatos.values()] };
}

/**
 * Up to MAX_MARCADORES marks. First the episode peaks: all of them when they
 * fit; otherwise the highest ones, first those whose labels do not overlap
 * (so they spread over the period), then the rest by height. Then the state
 * changes: each time the one farthest from those already chosen (the latest
 * on a tie), only while their date labels do not overlap.
 */
function elegirMarcadores(candidatos: Candidato[], xDe: (i: number) => number, alto: (i: number) => number) {
  const picos = candidatos
    .filter((c) => c.prioridad === 0)
    .map((c) => ({ ...c, x: xDe(c.i) }))
    .sort((a, b) => alto(b.i) - alto(a.i));
  const repartidos: typeof picos = [];
  for (const c of picos) if (repartidos.every((o) => Math.abs(o.x - c.x) >= LABEL_W)) repartidos.push(c);
  const elegidos = [...repartidos, ...picos.filter((c) => !repartidos.includes(c))].slice(0, MAX_MARCADORES);
  for (const prioridad of [2, 3]) {
    const resto = candidatos.filter((c) => c.prioridad === prioridad).map((c) => ({ ...c, x: xDe(c.i) }));
    while (elegidos.length < MAX_MARCADORES && resto.length) {
      let mejor = 0;
      let mejorD = -1;
      resto.forEach((r, k) => {
        let d = Infinity;
        for (const e of elegidos) d = Math.min(d, Math.abs(e.x - r.x));
        if (d > mejorD || (d === mejorD && r.x > resto[mejor].x)) {
          mejor = k;
          mejorD = d;
        }
      });
      if (mejorD < LABEL_W) break;
      elegidos.push(resto[mejor]);
      resto.splice(mejor, 1);
    }
  }
  return elegidos.sort((a, b) => a.i - b.i);
}

/** Labels kept, in order, only while they do not overlap the ones already placed */
function sinSolape<T extends { x: number; ancho: number }>(etiquetas: T[], separacion = 4) {
  const puestas: T[] = [];
  for (const e of etiquetas) {
    if (!puestas.some((p) => Math.abs(p.x - e.x) < (p.ancho + e.ancho) / 2 + separacion)) puestas.push(e);
  }
  return puestas;
}

/**
 * Pure-SVG trend of the interval maximum against the red reference line,
 * drawn at the real size of its box (one SVG unit = one pixel). The Y axis is
 * a separate, fixed SVG; the plot scrolls horizontally in Detalle. Consecutive
 * points above the line form an episode, marked once in red at its peak.
 * - Resumen: running time only, whole period in view, episodes without labels.
 * - Detalle: the whole timeline (running, stopped, maintenance) with the
 *   Evento / MTTO bands and up to 50 dated marks: episodes (with their value)
 *   first, then the state changes.
 */
export function TrendChart({
  title,
  unidad = '',
  modo,
  onModoChange,
  points,
  puntoMs,
  desde,
  hasta,
  linea,
  marcarFuera,
  curva = 'recta',
  estados = SIN_ESTADOS,
  notice,
}: TrendChartProps) {
  // Size of the plot viewport (the scroll box, without its scrollbar)
  const scroll = useRef<HTMLDivElement>(null);
  const [tam, setTam] = useState({ w: 320, h: 200 });
  useLayoutEffect(() => {
    const el = scroll.current;
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
  const detalle = modo === 'detalle';

  const suave = curva === 'suave';

  // Y scale: running maximums and the reference line
  const escala = useMemo(() => escalaY(points.map(valor), linea), [points, linea]);
  const { lo, hi, decimals } = escala;
  const plotBottom = h - PAD_BOTTOM[modo];
  const innerH = plotBottom - PAD_TOP;
  const yFor = (val: number) => PAD_TOP + innerH * (1 - (val - lo) / (hi - lo));
  const lineaY = linea === null ? null : yFor(linea);
  // Without points there is no scale: the line keeps its own decimals
  const lineaDecimals =
    linea === null ? decimals : Math.max(points.length ? decimals : 0, decimalsFor(linea));
  // Regular ticks that would touch the red line label give way to it
  // Without points yet (loading, empty) only the red line has a label
  const ticks = escala.ticks.filter(
    (t) => points.length > 0 && (lineaY === null || Math.abs(yFor(t) - lineaY) >= FONT + 1),
  );
  const etiquetasY = [...ticks.map((t) => format(t, decimals)), ...(linea === null ? [] : [format(linea, lineaDecimals)])];
  // Fixed Y axis: as wide as its longest label
  const yW = Math.ceil(Math.max(1, ...etiquetasY.map((e) => e.length)) * CHAR_W + 8);
  const fuera = (val: number) => marcarFuera && linea !== null && val >= linea;

  const fueraTexto = (val: number) => `${format(val, val >= 100 ? 0 : 1)}${unidad ? ` ${unidad}` : ''}`;

  // ── Resumen geometry
  const padL = 4;
  const resumenR = 8;
  const maxPuntos = Math.max(20, Math.floor((w - padL - resumenR) / 3));
  const resumen = useMemo(
    () => (detalle ? null : serieResumen(points, puntoMs, maxPuntos)),
    [detalle, points, puntoMs, maxPuntos],
  );

  // ── Detalle geometry
  const datosDetalle = useMemo(
    () =>
      detalle
        ? serieDetalle(
            points,
            puntoMs,
            desde,
            hasta,
            estados,
            (val) => marcarFuera && linea !== null && val >= linea,
            (hi - lo) * 0.15,
          )
        : null,
    [detalle, points, puntoMs, desde, hasta, estados, marcarFuera, linea, hi, lo],
  );
  let plotW = w;
  let xSlot = (i: number) => i;
  let xTiempo = (t: number) => t;
  if (datosDetalle) {
    const { n, g0, episodios: eps } = datosDetalle;
    // Width proportional to the period: 2 px per 15-min interval, 4 px per
    // hour beyond; wider when the episode labels need room
    let pxSlot = puntoMs <= 15 * MIN ? 2 : 4;
    if (eps.length > 1 && eps.length <= MAX_MARCADORES) {
      let gap = Infinity;
      for (let k = 1; k < eps.length; k++) gap = Math.min(gap, eps[k].pico - eps[k - 1].pico);
      pxSlot = Math.max(pxSlot, LABEL_W / gap);
    }
    plotW = Math.round(Math.min(MAX_DETALLE_W, Math.max(w, n * pxSlot + padL + LABEL_W / 2)));
    const anchoUtil = plotW - padL - LABEL_W / 2;
    xSlot = (i: number) => padL + ((i + 0.5) / n) * anchoUtil;
    xTiempo = (t: number) => padL + ((t - g0) / (n * puntoMs)) * anchoUtil;
  }

  // Detalle opens on the latest data
  const hayPuntos = points.length > 0;
  useLayoutEffect(() => {
    const el = scroll.current;
    if (el && detalle) el.scrollLeft = el.scrollWidth;
  }, [detalle, desde, hasta, puntoMs, hayPuntos]);

  // ── Resumen layers
  let resumenCapa: ReactNode = null;
  if (resumen) {
    const xPos = (pos: number) => padL + pos * (w - padL - resumenR);
    const d = trazado(
      resumen.serie.map((s) => ({ x: xPos(s.pos), y: yFor(valor(s.p)) })),
      suave,
    );
    // One red point per episode, at its peak; consecutive = the next interval
    // (a stop or maintenance in between ends the episode)
    const eps = episodios(
      points.length,
      (k) => fuera(valor(points[k])),
      (k) => points[k].t - points[k - 1].t <= puntoMs * 1.5,
      (k) => valor(points[k]),
    );
    // Dates: the start of each running day; for short periods also hours
    const pocosDias = resumen.dias.length < 4;
    const candidatasX = [
      ...resumen.dias.map((dd) => ({ x: xPos(dd.pos), texto: diaMes(dd.t), ancho: 5 * CHAR_W })),
      ...(pocosDias
        ? resumen.serie
            .filter((s) => new Date(s.p.t - puntoMs / 2).getUTCHours() % 3 === 0)
            .map((s) => ({ x: xPos(s.pos), texto: horaMin(s.p.t - puntoMs / 2), ancho: 5 * CHAR_W }))
        : []),
    ].filter((e) => e.x >= e.ancho / 2 && e.x <= w - e.ancho / 2);
    const fechas = sinSolape(candidatasX, 10);
    resumenCapa = (
      <>
        <path d={d} fill="none" strokeWidth={1.5} strokeLinejoin="round" style={{ stroke: LINEA }} />
        {resumen.serie.length === 1 && <circle cx={xPos(resumen.serie[0].pos)} cy={yFor(valor(resumen.serie[0].p))} r={2.5} style={{ fill: LINEA }} />}
        {eps.map((e) => {
          const p = points[e.pico];
          return (
            <circle key={p.t} cx={xPos(resumen.posiciones[e.pico])} cy={yFor(valor(p))} r={3.5} strokeWidth={1} style={{ fill: ROJO, stroke: BLANCO }}>
              <title>{`${TIPO_TEXTO.episodio} · ${tooltip(p, puntoMs, unidad)}`}</title>
            </circle>
          );
        })}
        {fechas.map((f) => (
          <g key={`${f.x}-${f.texto}`}>
            <line x1={f.x} y1={plotBottom} x2={f.x} y2={plotBottom + 3} style={{ stroke: TENUE }} />
            <text x={f.x} y={plotBottom + 14} textAnchor="middle" fontSize={FONT} style={{ fill: TENUE }}>
              {f.texto}
            </text>
          </g>
        ))}
      </>
    );
  }

  // ── Detalle layers
  let detalleFondo: ReactNode = null;
  let detalleCapa: ReactNode = null;
  const bandasVisibles = new Set<TrendEstado['segmento']>();
  if (datosDetalle) {
    const { slots, candidatos, episodios: eps, g0, n } = datosDetalle;
    const yApagado = plotBottom - 3;
    const ySlot = (s: Slot) => (s.kind === 'on' && s.p ? yFor(valor(s.p)) : s.kind === 'off' ? yApagado : plotBottom);
    // Running: strong line (one path per running stretch); stopped and
    // maintenance, and the way down and up: faint straight line
    const tramos: Punto[][] = [];
    let tenue = '';
    const aislados: Slot[] = [];
    const xy = (s: Slot) => `${xSlot(s.i).toFixed(1)} ${ySlot(s).toFixed(1)}`;
    slots.forEach((s, k) => {
      const prev = slots[k - 1];
      if (s.kind === 'on') {
        if (prev?.kind !== 'on') tramos.push([]);
        tramos[tramos.length - 1].push({ x: xSlot(s.i), y: ySlot(s) });
        if (prev && prev.kind !== 'on') tenue += `L ${xy(s)} `;
        if (prev?.kind !== 'on' && slots[k + 1]?.kind !== 'on') aislados.push(s);
      } else if (!prev) {
        tenue += `M ${xy(s)} `;
      } else {
        tenue += prev.kind === 'on' ? `M ${xy(prev)} L ${xy(s)} ` : `L ${xy(s)} `;
      }
    });

    const bandas = estados
      .filter((e) => e.segmento === 'EVENTO' || e.segmento === 'MANTENIMIENTO')
      .map((e) => ({ ...e, x1: xTiempo(Math.max(e.desde, desde)), x2: xTiempo(Math.min(e.hasta, hasta)) }))
      .filter((b) => b.x2 > b.x1);
    bandas.forEach((b) => bandasVisibles.add(b.segmento));

    const fuerte = tramos.map((t) => trazado(t, suave)).join(' ');
    const alto = (i: number) => (slots[i].p ? valor(slots[i].p) : 0);
    const marcadores = elegirMarcadores(candidatos, xSlot, alto);
    // Dates: episodes first, highest first. When the plot is at its widest
    // and two episodes are still too close, the lower one keeps only its red point
    const fechas = sinSolape(
      [...marcadores]
        .sort((a, b) => a.prioridad - b.prioridad || (a.tipo === 'episodio' ? alto(b.i) - alto(a.i) : 0))
        .map((m) => {
          const s = slots[m.i];
          const inicio = g0 + m.i * puntoMs;
          // Switching off: the end of its last running interval
          const t = m.tipo === 'apaga' ? inicio + puntoMs : inicio;
          return { ...m, s, t, y: ySlot(s), x: xSlot(m.i), ancho: LABEL_W - 4 };
        }),
      0,
    );
    // Value of the marked episodes, highest first, while they do not overlap
    const valores = sinSolape(
      marcadores
        .filter((m) => m.tipo === 'episodio')
        .sort((a, b) => alto(b.i) - alto(a.i))
        .map((m) => {
          const texto = fueraTexto(alto(m.i));
          return { x: xSlot(m.i), y: ySlot(slots[m.i]) - 8, texto, ancho: texto.length * CHAR_W, i: m.i };
        }),
    );

    // Day ticks (00:00 UTC), no labels: the dates go with the marks
    const dias: number[] = [];
    for (let t = Math.ceil(g0 / DAY) * DAY; t <= g0 + n * puntoMs; t += DAY) dias.push(t);

    detalleFondo = (
      <>
        {/* Evento / MTTO bands, behind everything */}
        {bandas.map((b) => (
          <rect key={`${b.segmento}-${b.desde}`} x={b.x1} y={PAD_TOP} width={b.x2 - b.x1} height={innerH} style={{ fill: BANDA_COLOR[b.segmento as 'EVENTO' | 'MANTENIMIENTO'] }} />
        ))}
        {bandas
          .filter((b) => b.segmento === 'MANTENIMIENTO' && b.x2 - b.x1 >= FONT + 1)
          .map((b) => {
            const x = (b.x1 + b.x2) / 2 + FONT / 2 - 1;
            return (
              <text key={`t-${b.desde}`} x={x} y={plotBottom - 6} transform={`rotate(-90 ${x} ${plotBottom - 6})`} fontSize={FONT} style={{ fill: TENUE }}>
                Mantenimiento
              </text>
            );
          })}
      </>
    );
    detalleCapa = (
      <>
        {dias.map((t) => (
          <line key={t} x1={xTiempo(t)} y1={plotBottom} x2={xTiempo(t)} y2={plotBottom + 3} style={{ stroke: REJILLA }} />
        ))}
        {/* Guides from each mark down to its date */}
        {fechas.map((f) => (
          <line key={`g-${f.i}`} x1={xSlot(f.i)} y1={f.y} x2={xSlot(f.i)} y2={plotBottom} strokeDasharray="2 3" style={{ stroke: REJILLA }} />
        ))}
        <path d={tenue} fill="none" strokeWidth={1} strokeLinejoin="round" style={{ stroke: TENUE, opacity: 0.45 }} />
        <path d={fuerte} fill="none" strokeWidth={1.5} strokeLinejoin="round" style={{ stroke: LINEA }} />
        {aislados.map((s) => (
          <circle key={`a-${s.i}`} cx={xSlot(s.i)} cy={ySlot(s)} r={1.8} style={{ fill: LINEA }} />
        ))}
        {/* One red point per episode, at its peak (the marked ones also get a date) */}
        {eps.map((e) => (
          <circle key={`e-${e.pico}`} cx={xSlot(e.pico)} cy={ySlot(slots[e.pico])} r={3.5} strokeWidth={1} style={{ fill: ROJO, stroke: BLANCO }}>
            <title>{`${TIPO_TEXTO.episodio} · ${tooltip(slots[e.pico].p!, puntoMs, unidad)}`}</title>
          </circle>
        ))}
        {fechas.map((f) => (
          <g key={`m-${f.i}`}>
            <circle cx={xSlot(f.i)} cy={f.y} r={3.5} strokeWidth={1} style={{ fill: f.tipo === 'episodio' ? ROJO : OSCURO, stroke: BLANCO }}>
              <title>{[TIPO_TEXTO[f.tipo], f.s.p ? tooltip(f.s.p, puntoMs, unidad) : null].filter(Boolean).join(' · ')}</title>
            </circle>
            <text x={xSlot(f.i)} y={plotBottom + 12} textAnchor="middle" fontSize={FONT} style={{ fill: f.tipo === 'episodio' ? ROJO : TENUE }}>
              <tspan x={xSlot(f.i)}>{diaMes(f.t)}</tspan>
              <tspan x={xSlot(f.i)} dy={FONT + 1}>
                {horaMin(f.t)}
              </tspan>
            </text>
          </g>
        ))}
        {valores.map((e) => (
          <text key={`v-${e.i}`} x={e.x} y={e.y} textAnchor="middle" fontSize={FONT} fontWeight={600} paintOrder="stroke" strokeWidth={3} style={{ fill: ROJO, stroke: BLANCO }}>
            {e.texto}
          </text>
        ))}
      </>
    );
  }

  const conPuntos = points.length > 0;
  const svgStyle: CSSProperties = { overflow: 'visible' };

  return (
    <div className={styles.card}>
      {/* Title and the Resumen | Detalle control on one line */}
      <div className={styles.trendHeader}>
        <h3 className={styles.cardTitle}>{title}</h3>
        <div className={styles.trendModos} role="group" aria-label="Vista de la tendencia">
          {MODOS.map((m) => (
            <button
              key={m.id}
              type="button"
              className={styles.trendModo}
              aria-pressed={modo === m.id}
              aria-label={m.label}
              onClick={() => onModoChange(m.id)}
            >
              <span className={styles.trendModoLargo}>{m.label}</span>
              <span className={styles.trendModoCorto}>{m.corto}</span>
            </button>
          ))}
        </div>
      </div>

      <div className={styles.trendChart}>
        {/* Fixed Y axis: the scale and the reference value in red */}
        <svg className={styles.trendEjeY} width={yW} height={h} style={svgStyle} aria-hidden="true">
          {ticks.map((t) => (
            <text key={t} x={yW - 4} y={yFor(t) + 4} textAnchor="end" fontSize={FONT} style={{ fill: TENUE }}>
              {format(t, decimals)}
            </text>
          ))}
          {linea !== null && lineaY !== null && (
            <text x={yW - 4} y={lineaY + 4} textAnchor="end" fontSize={FONT} fontWeight={700} style={{ fill: ROJO }}>
              {format(linea, lineaDecimals)}
            </text>
          )}
          <line x1={yW - 0.5} y1={PAD_TOP} x2={yW - 0.5} y2={plotBottom} style={{ stroke: REJILLA }} />
        </svg>

        <div
          ref={scroll}
          className={`${styles.trendScroll} ${detalle ? styles.trendScrollDetalle : ''}`}
          style={{ left: yW }}
          tabIndex={detalle ? 0 : undefined}
          aria-label={detalle ? 'Detalle de la tendencia: desplace horizontalmente' : undefined}
        >
          <svg width={plotW} height={h} viewBox={`0 0 ${plotW} ${h}`}>
            {detalleFondo}
            {ticks.map((t) => (
              <line key={t} x1={0} y1={yFor(t)} x2={plotW} y2={yFor(t)} strokeDasharray="3 3" style={{ stroke: REJILLA }} />
            ))}
            <line x1={0} y1={plotBottom} x2={plotW} y2={plotBottom} style={{ stroke: REJILLA }} />
            {lineaY !== null && (
              <line x1={0} y1={lineaY} x2={plotW} y2={lineaY} strokeWidth={1.5} strokeDasharray="6 4" style={{ stroke: ROJO }} />
            )}
            {resumenCapa}
            {detalleCapa}
          </svg>
        </div>

        {unidad && (
          <span className={styles.trendUnidad} style={{ left: yW + 4 }}>
            {unidad}
          </span>
        )}
        {notice && (
          <p
            className={`${styles.trendNotice} ${conPuntos ? styles.trendNoticeEsquina : ''} ${notice.error ? styles.chartNoticeError : ''}`}
            style={conPuntos ? undefined : { left: yW }}
            role={notice.error ? 'alert' : 'status'}
          >
            {notice.text}
            {notice.reintentar && <BotonReintentar onClick={notice.reintentar} />}
          </p>
        )}
      </div>

      <ul className={styles.trendLegend}>
        {conPuntos && (
          <li>
            <span className={styles.trendLegendLine} style={{ background: LINEA }} />
            {points.some((p) => p.max !== undefined) ? 'Máximo' : 'Valor'}
          </li>
        )}
        {linea !== null && (
          <li>
            <span className={styles.trendLegendDash} style={{ borderColor: ROJO }} />
            Nominal
          </li>
        )}
        {bandasVisibles.has('EVENTO') && (
          <li>
            <span className={styles.trendLegendBox} style={{ background: BANDA_COLOR.EVENTO }} />
            Evento
          </li>
        )}
        {bandasVisibles.has('MANTENIMIENTO') && (
          <li>
            <span className={styles.trendLegendBox} style={{ background: BANDA_COLOR.MANTENIMIENTO }} />
            MTTO
          </li>
        )}
      </ul>
    </div>
  );
}
