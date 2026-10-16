import { useMemo, useState } from 'react';
import { DEMO_MODE } from '../../shared/api';
import type { TrendVariable, TrendVariableId } from '../../contracts/dashboard';
import { mockData } from './mockData';
import { ArbolMovil } from './ArbolEquipos';
import type { CeroCheck } from './ArbolEquipos';
import { DonutFilters } from './DonutFilters';
import { DonutPanel } from './DonutPanel';
import type { DonutPeriodo } from './DonutPanel';
import type { PeriodoFechas } from './PeriodoSelector';
import { fetchEquipo } from './equipos.service';
import type { CeroId, DonutData } from './donutSimulation';
import { resolverRuta, textoRuta } from './jerarquiaDemo';
import { demoBloquesData, fetchBloques } from './bloques.service';
import type { BloquesData } from './bloques.service';
import { demoMedicionesData, fetchMediciones, fetchMedicionesDetalle, minutosDetalle } from './operacion.service';
import type { MedicionesData } from './operacion.service';
import { esRango, PERIODO_INICIAL, periodoClave } from './periodo';
import type { Periodo } from './periodo';
import { useBackend } from './useBackend';
import type { BackendState } from './useBackend';
import { EventsSummary } from './EventsSummary';
import { LogoutIcon } from './LogoutIcon';
import { Sidebar } from './Sidebar';
import { TrendChart } from './TrendChart';
import type { TrendEstado, TrendModo, TrendSeriesPoint } from './TrendChart';
import { TrendVariablePicker } from './TrendVariablePicker';
import { lineaReferencia } from './referenciasTendencia';
import styles from './dashboard.module.css';

type Notice = { text: string; error?: boolean };

type DonutView = DonutData & { periodo?: DonutPeriodo; notice?: Notice };

/** dd/mm from YYYY-MM-DD… (UTC, as stored) */
const diaMes = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;

/**
 * Last day of a period that ends at `fin` (ISO, UTC). A range of whole days
 * ends at 00:00 of the next day, which is not part of the period.
 */
const ultimoDia = (fin: string) =>
  fin.endsWith('T00:00:00.000Z') ? new Date(Date.parse(fin) - 1).toISOString() : fin;

/** "2026", or "2025 – 2026" when the period crosses a new year */
const anios = (desde: string, hasta: string) => (desde === hasta ? hasta : `${desde} – ${hasta}`);

/** Demo mode (Netlify): simulated blocks and their hours, same shape as the backend */
function bloquesDemo(cero: string, periodo: Periodo): BackendState<BloquesData> {
  try {
    return { status: 'data', data: demoBloquesData(cero, periodo) };
  } catch (err) {
    return { status: 'error', message: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * Demo mode: simulated trend of the demo blocks (same errors, e.g. unknown
 * CERO). `detalle`: the shorter intervals of the Detalle view.
 */
function medicionesDemo(
  cero: string,
  variable: TrendVariable,
  bloques: BackendState<BloquesData>,
  detalle = false,
): BackendState<MedicionesData> | null {
  if (bloques.status !== 'data') return bloques.status === 'error' ? bloques : null;
  const { desde, fecha_referencia } = bloques.data;
  const minutos =
    detalle && desde && fecha_referencia ? minutosDetalle(Date.parse(fecha_referencia) - Date.parse(desde)) : undefined;
  const data = demoMedicionesData(cero, variable, bloques.data, minutos);
  return data ? { status: 'data', data } : null;
}

/**
 * Donut from the backend hours; zeros plus a message while loading, on error
 * or without data. The evaluated period goes inside the donut, not in the notice.
 */
function donutFromBloques(state: BackendState<BloquesData>, cero: string): DonutView {
  const horas = state.status === 'data' ? state.data.horas : null;
  const segments = mockData.donut.segments.map((seg) => ({
    ...seg,
    hours: horas ? Math.round(horas[seg.status]) : 0,
  }));
  const totalHours = segments.reduce((sum, s) => sum + s.hours, 0);
  const base = { segments, totalHours, totalLabel: mockData.donut.totalLabel };

  if (state.status === 'error') return { ...base, notice: { text: state.message, error: true } };
  if (state.status !== 'data') return { ...base, notice: { text: 'Cargando horas…' } };
  const { desde, fecha_referencia, ultimo_registro } = state.data;
  if (!desde || !fecha_referencia) return { ...base, notice: { text: `Sin mediciones de ${cero} en la base de datos` } };
  const hasta = ultimoDia(fecha_referencia);
  return {
    ...base,
    periodo: {
      rango: `Del ${diaMes(desde)} al ${diaMes(hasta)}`,
      anio: anios(desde.slice(0, 4), hasta.slice(0, 4)),
      // Only when the period reaches the latest record (not for an earlier range)
      detalle: fecha_referencia === ultimo_registro ? '(última medición)' : undefined,
    },
  };
}

/**
 * Dates of the period selector: the chosen range, or the dates a fixed
 * period (table buttons) resolved to; limited to the days with records.
 * `ultimos`: the latest data, kept while a new period loads.
 */
function fechasDelPeriodo(periodo: Periodo, ultimos: BloquesData | null): PeriodoFechas | undefined {
  const min = ultimos?.primer_registro?.slice(0, 10);
  const max = ultimos?.ultimo_registro?.slice(0, 10);
  if (esRango(periodo)) return { desde: periodo.desde, hasta: periodo.hasta, min, max };
  if (!ultimos?.desde || !ultimos.fecha_referencia) return undefined;
  return { desde: ultimos.desde.slice(0, 10), hasta: ultimoDia(ultimos.fecha_referencia).slice(0, 10), min, max };
}

/** localStorage key of the chosen tree route (ids from the root down) */
const RUTA_KEY = 'vx_ruta';

/**
 * Saved route, if every level still exists in the tree data; otherwise the
 * root (empty route). localStorage may be unavailable: then also the root.
 */
function rutaGuardada(): string[] {
  try {
    const ruta: unknown = JSON.parse(localStorage.getItem(RUTA_KEY) ?? '[]');
    if (Array.isArray(ruta) && ruta.every((id) => typeof id === 'string') && resolverRuta(ruta)) return ruta;
  } catch {
    // unreadable or blocked storage: start at the root
  }
  return [];
}

/**
 * What the chosen route shows: the dashboard of a CERO (its equipment or its
 * Motor), or a message instead of the cards.
 */
function seleccionDe(ruta: string[]): { cero: CeroId } | { cero: null; aviso: string } {
  const nodos = resolverRuta(ruta) ?? [];
  const equipo = nodos.find((n) => n.nivel === 'equipo');
  const componente = nodos.find((n) => n.nivel === 'componente');
  if (!equipo) return { cero: null, aviso: 'Elige un equipo para ver su información' };
  if (componente && !componente.sensores) return { cero: null, aviso: 'Sin mediciones para este componente' };
  if (!equipo.cero) return { cero: null, aviso: 'Sin mediciones para este equipo' };
  return { cero: equipo.cero };
}

/** Card with a title and a message in place of its content */
function AvisoCard({ titulo, texto }: { titulo: string; texto: string }) {
  return (
    <div className={styles.card}>
      <h3 className={styles.cardTitle}>{titulo}</h3>
      <p className={styles.avisoCard} role="status">
        {texto}
      </p>
    </div>
  );
}

interface DashboardPageProps {
  onLogout: () => void;
}

export function DashboardPage({ onLogout }: DashboardPageProps) {
  // Route chosen in the equipment tree, kept across reloads
  const [ruta, setRuta] = useState<string[]>(rutaGuardada);
  // One period for the donut, the events table and the trend chart
  const [periodo, setPeriodo] = useState<Periodo>(PERIODO_INICIAL);
  const [variableId, setVariableId] = useState<TrendVariableId>('corriente');
  const [trendModo, setTrendModo] = useState<TrendModo>('resumen');

  function cambiarRuta(siguiente: string[]) {
    setRuta(siguiente);
    try {
      localStorage.setItem(RUTA_KEY, JSON.stringify(siguiente));
    } catch {
      // storage blocked (private mode): the route just is not kept
    }
  }

  // The CERO of the route (null: no equipment with data chosen)
  const seleccion = seleccionDe(ruta);
  const cero = seleccion.cero;

  // The chosen CERO is checked against the database; a newer choice cancels
  // the previous request. Demo mode (Netlify) has no backend: no check.
  const verificacionBackend = useBackend(DEMO_MODE || !cero ? null : `equipo|${cero}`, (signal) =>
    fetchEquipo(cero ?? '', signal),
  );
  const ceroCheck: CeroCheck =
    verificacionBackend.status === 'data'
      ? { status: 'ok' }
      : verificacionBackend.status === 'error'
        ? { status: 'error', message: verificacionBackend.message }
        : { status: verificacionBackend.status };

  const clave = periodoClave(periodo);
  const variable =
    mockData.trendVariables.find((v) => v.id === variableId) ?? mockData.trendVariables[0];

  // A single request (one execution of dbo.sp_vx_resumen_estados) feeds the
  // donut, the motor state and the events table, so they always agree.
  // Demo mode (Netlify) simulates the same data; variables without a
  // database code stay simulated in the trend chart.
  const bloquesBackend = useBackend(DEMO_MODE || !cero ? null : `${cero}|${clave}`, (signal) =>
    fetchBloques(cero ?? '', periodo, signal),
  );
  const bloquesSimulados = useMemo(() => (DEMO_MODE && cero ? bloquesDemo(cero, periodo) : null), [cero, periodo]);
  const bloques = bloquesSimulados ?? bloquesBackend;
  const trendCodigo = DEMO_MODE || !cero ? undefined : variable.codigo;
  const medicionesBackend = useBackend(
    trendCodigo ? `${cero}|${trendCodigo}|${clave}` : null,
    (signal) => fetchMediciones(cero ?? '', trendCodigo ?? '', periodo, signal),
  );
  const medicionesSimuladas = useMemo(
    () => (cero && bloquesSimulados ? medicionesDemo(cero, variable, bloquesSimulados) : null),
    [cero, variable, bloquesSimulados],
  );

  // Detalle: shorter intervals over the resolved period of the blocks (a
  // fixed number of days only has dates once its blocks arrive)
  const detalle = trendModo === 'detalle';
  const bloquesListos = bloques.status === 'data' ? bloques.data : null;
  const detalleDesde = bloquesListos?.desde;
  const detalleHasta = bloquesListos?.fecha_referencia;
  const detalleBackend = useBackend(
    detalle && trendCodigo && detalleDesde && detalleHasta ? `${cero}|${trendCodigo}|${detalleDesde}|${detalleHasta}` : null,
    (signal) => fetchMedicionesDetalle(cero ?? '', trendCodigo ?? '', detalleDesde ?? '', detalleHasta ?? '', signal),
  );
  const detalleSimulado = useMemo(
    () => (cero && detalle && bloquesSimulados ? medicionesDemo(cero, variable, bloquesSimulados, true) : null),
    [detalle, cero, variable, bloquesSimulados],
  );
  // Blocks failed: their error; no records in the period: the (empty) Resumen data
  const detalleMediciones: BackendState<MedicionesData> =
    detalleSimulado ??
    (bloques.status === 'error' ? bloques : bloquesListos && !detalleDesde ? medicionesBackend : detalleBackend);
  const mediciones = detalle ? detalleMediciones : (medicionesSimuladas ?? medicionesBackend);
  // Each point at the middle of its interval; drawn value: the interval maximum
  const puntosMedidos = useMemo(() => {
    if (mediciones.status !== 'data') return null;
    const puntoMs = mediciones.data.minutos_punto * 60_000;
    const points: TrendSeriesPoint[] = mediciones.data.puntos.map((p) => ({
      t: Date.parse(p.inicio) + puntoMs / 2,
      value: p.promedio,
      max: p.maximo,
      lecturas: p.lecturas,
      marcas: p.marcas,
    }));
    return { points, puntoMs };
  }, [mediciones]);

  // Last loaded data: keeps the selector dates steady while a new period
  // loads (a fixed period shows its own dates once its data arrives)
  const [ultimosBloques, setUltimosBloques] = useState<BloquesData | null>(null);
  if (bloques.status === 'data' && bloques.data !== ultimosBloques) setUltimosBloques(bloques.data);
  const periodoFechas = fechasDelPeriodo(periodo, ultimosBloques);

  const donut = donutFromBloques(bloques, cero ?? '');
  const motorInfo =
    bloques.status === 'data' && bloques.data.estado_actual
      ? { ...mockData.motorInfo, estado: bloques.data.estado_actual }
      : mockData.motorInfo;

  // Trend X axis = the period of the donut and the events table. Only data of
  // the current period counts: while its blocks load, the trend's own period
  // (same dates); the previous blocks only as a last resort
  const bloquesActuales = bloques.status === 'data' ? bloques.data : null;
  // State blocks (the same as the donut and the events table) for the Detalle timeline
  const trendEstados = useMemo<TrendEstado[]>(
    () =>
      (bloquesActuales?.bloques ?? []).map((b) => ({
        desde: Date.parse(b.inicio),
        hasta: Date.parse(b.fin),
        segmento: b.segmento,
      })),
    [bloquesActuales],
  );
  const medicionesActuales = mediciones.status === 'data' ? mediciones.data : null;
  const ejeDesdeIso = bloquesActuales?.desde ?? medicionesActuales?.desde ?? ultimosBloques?.desde;
  const ejeHastaIso =
    bloquesActuales?.fecha_referencia ?? medicionesActuales?.fecha_referencia ?? ultimosBloques?.fecha_referencia;
  const ejeDesde = ejeDesdeIso ? Date.parse(ejeDesdeIso) : 0;
  const ejeHasta = ejeHastaIso ? Date.parse(ejeHastaIso) : 1;
  // Variables without a database code: their sample values spread evenly
  // over the period, one point per value
  const simPaso = (ejeHasta - ejeDesde) / Math.max(variable.data.length, 1);
  let trendPoints: TrendSeriesPoint[] = variable.data.map((d, i) => ({ t: ejeDesde + (i + 0.5) * simPaso, value: d.value }));
  let trendPuntoMs = simPaso;
  let trendNotice: Notice | undefined;
  if (!variable.codigo) {
    // Demo mode: everything is simulated, no notice
    if (!DEMO_MODE) trendNotice = { text: 'Datos simulados: no hay una variable de producción en la base de datos' };
  } else if (mediciones.status === 'loading' || mediciones.status === 'idle') {
    trendPoints = [];
    trendNotice = { text: 'Cargando mediciones…' };
  } else if (mediciones.status === 'error') {
    trendPoints = [];
    trendNotice = { text: mediciones.message, error: true };
  } else if (puntosMedidos) {
    trendPoints = puntosMedidos.points;
    trendPuntoMs = puntosMedidos.puntoMs;
    if (!trendPoints.length) trendNotice = { text: `Sin mediciones de ${variable.label.toLowerCase()} para ${cero} en el período` };
  }
  // Red line: DEMO value, or UMBRAL_MAX of ConfiguracionVariables with real data
  const referencia = lineaReferencia(variable.id, mediciones.status === 'data' ? mediciones.data.umbral : null);
  const rutaTexto = textoRuta(ruta);

  return (
    <div className={styles.dashboard}>
      {/* Desktop sidebar */}
      <Sidebar ruta={ruta} onRutaChange={cambiarRuta} verificacion={ceroCheck} onLogout={onLogout} />

      {/* Phone portrait: header, then the tree as a folding panel */}
      <header className={styles.mobileHeader}>
        <div className={styles.mobileLogo}>VX</div>
        <span className={styles.mobileTitle}>VERTEX</span>
        <button
          type="button"
          className={styles.mobileLogout}
          onClick={onLogout}
          aria-label="Cerrar sesión"
          title="Cerrar sesión"
        >
          <LogoutIcon />
        </button>
      </header>
      <ArbolMovil ruta={ruta} onRutaChange={cambiarRuta} verificacion={ceroCheck} />

      <main className={styles.main}>
        {/* Route of the chosen equipment: information only, navigation is the tree */}
        <p className={styles.rutaTexto} title={rutaTexto || undefined}>
          {rutaTexto || 'Ningún equipo elegido'}
        </p>
        <div className={styles.pageTitle}>
          <h1>Resumen operativo</h1>
        </div>

        <div className={styles.grid}>
          {/* Donut column: period selector on top, then the donut card */}
          <div className={`${styles.col5} ${styles.colStack}`}>
            {seleccion.cero === null ? (
              <AvisoCard titulo="Horas por estado" texto={seleccion.aviso} />
            ) : (
              <>
                <DonutFilters periodoFechas={periodoFechas} onPeriodoChange={setPeriodo} />
                <DonutPanel
                  segments={donut.segments}
                  totalHours={donut.totalHours}
                  motorInfo={motorInfo}
                  periodo={donut.periodo}
                  notice={donut.notice}
                />
              </>
            )}
          </div>

          {/* Trend column: variable picker on top, then the trend card */}
          <div className={`${styles.col7} ${styles.colStack}`}>
            {seleccion.cero === null ? (
              <AvisoCard titulo="Tendencia" texto={seleccion.aviso} />
            ) : (
              <>
                <TrendVariablePicker
                  variables={mockData.trendVariables}
                  value={variableId}
                  onChange={setVariableId}
                />
                <TrendChart
                  title={`Tendencia — ${variable.label}`}
                  unidad={variable.unit}
                  modo={trendModo}
                  onModoChange={setTrendModo}
                  points={trendPoints}
                  puntoMs={trendPuntoMs}
                  desde={ejeDesde}
                  hasta={ejeHasta}
                  linea={referencia.valor}
                  marcarFuera={referencia.marcar && Boolean(variable.codigo)}
                  curva={variable.curva}
                  estados={trendEstados}
                  notice={trendNotice}
                />
              </>
            )}
          </div>

          {/* State blocks of the selected CERO: same request and period as the donut */}
          <div className={styles.col5}>
            {seleccion.cero === null ? (
              <AvisoCard titulo="Resumen de eventos" texto={seleccion.aviso} />
            ) : (
              <EventsSummary state={bloques} periodo={periodo} onPeriodoChange={setPeriodo} />
            )}
          </div>

          {/* Map placeholder */}
          <div className={styles.col7}>
            {seleccion.cero === null ? (
              <AvisoCard titulo="Ubicación de equipos" texto={seleccion.aviso} />
            ) : (
              <div className={styles.card}>
                <h3 className={styles.cardTitle}>Ubicación de equipos</h3>
                <div className={styles.mapPlaceholder}>
                  <span>🗺️</span>
                  <div>Mapa de planta — Fase 2</div>
                </div>
              </div>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}

export default DashboardPage;
