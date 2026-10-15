import { useEffect, useMemo, useRef, useState } from 'react';
import { DEMO_MODE } from '../../shared/api';
import type { NavTabId, TrendVariable, TrendVariableId } from '../../contracts/dashboard';
import { mockData, NAV_TABS } from './mockData';
import { DonutFilters } from './DonutFilters';
import type { CeroCheck } from './DonutFilters';
import { DonutPanel } from './DonutPanel';
import type { DonutPeriodo } from './DonutPanel';
import type { PeriodoFechas } from './PeriodoSelector';
import { fetchEquipo } from './equipos.service';
import type { CeroId, DonutData } from './donutSimulation';
import { demoBloquesData, fetchBloques } from './bloques.service';
import type { BloquesData } from './bloques.service';
import { demoMedicionesData, fetchMediciones } from './operacion.service';
import type { MedicionesData } from './operacion.service';
import { esRango, PERIODO_INICIAL, periodoClave } from './periodo';
import type { Periodo } from './periodo';
import { useBackend } from './useBackend';
import type { BackendState } from './useBackend';
import { EventsSummary } from './EventsSummary';
import { LogoutIcon } from './LogoutIcon';
import { NavTabs } from './NavTabs';
import { Sidebar } from './Sidebar';
import { TrendChart } from './TrendChart';
import type { TrendBanda, TrendSeriesPoint } from './TrendChart';
import { TrendVariablePicker } from './TrendVariablePicker';
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

/** Demo mode: simulated trend of the demo blocks (same errors, e.g. unknown CERO) */
function medicionesDemo(
  cero: string,
  variable: TrendVariable,
  bloques: BackendState<BloquesData>,
): BackendState<MedicionesData> | null {
  if (bloques.status !== 'data') return bloques.status === 'error' ? bloques : null;
  const data = demoMedicionesData(cero, variable, bloques.data);
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

/** "cada 15 min" / "cada 1 h" / "cada 4 h" / "diario" for the trend notice */
function etiquetaPunto(minutos: number) {
  if (minutos >= 1440) return 'diario';
  return minutos >= 60 ? `cada ${minutos / 60} h` : `cada ${minutos} min`;
}

interface DashboardPageProps {
  onLogout: () => void;
}

export function DashboardPage({ onLogout }: DashboardPageProps) {
  const [activeTab, setActiveTab] = useState<NavTabId>('resumen');
  const [cero, setCero] = useState<CeroId>('CERO-010');
  // One period for the donut, the events table and the trend chart
  const [periodo, setPeriodo] = useState<Periodo>(PERIODO_INICIAL);
  const [variableId, setVariableId] = useState<TrendVariableId>('corriente');
  const [ceroCheck, setCeroCheck] = useState<CeroCheck>({ status: 'idle' });
  const checkRequest = useRef<AbortController | null>(null);

  useEffect(() => () => checkRequest.current?.abort(), []);

  // Picking a CERO checks it exists in the database. A newer pick cancels
  // the previous request. Demo mode (Netlify) has no backend: no check.
  function handleCeroChange(next: CeroId) {
    setCero(next);
    checkRequest.current?.abort();
    if (DEMO_MODE) return;

    const controller = new AbortController();
    checkRequest.current = controller;
    setCeroCheck({ status: 'loading' });
    fetchEquipo(next, controller.signal)
      .then(() => setCeroCheck({ status: 'ok' }))
      .catch((err: unknown) => {
        if (controller.signal.aborted) return;
        setCeroCheck({ status: 'error', message: err instanceof Error ? err.message : String(err) });
      });
  }

  const clave = periodoClave(periodo);
  const variable =
    mockData.trendVariables.find((v) => v.id === variableId) ?? mockData.trendVariables[0];
  const variableTitle = variable.unit ? `${variable.label} (${variable.unit})` : variable.label;

  // A single request (one execution of dbo.sp_vx_resumen_estados) feeds the
  // donut, the motor state and the events table, so they always agree.
  // Demo mode (Netlify) simulates the same data; variables without a
  // database code stay simulated in the trend chart.
  const bloquesBackend = useBackend(DEMO_MODE ? null : `${cero}|${clave}`, (signal) =>
    fetchBloques(cero, periodo, signal),
  );
  const bloquesSimulados = useMemo(() => (DEMO_MODE ? bloquesDemo(cero, periodo) : null), [cero, periodo]);
  const bloques = bloquesSimulados ?? bloquesBackend;
  const trendCodigo = DEMO_MODE ? undefined : variable.codigo;
  const medicionesBackend = useBackend(
    trendCodigo ? `${cero}|${trendCodigo}|${clave}` : null,
    (signal) => fetchMediciones(cero, trendCodigo ?? '', periodo, signal),
  );
  const medicionesSimuladas = useMemo(
    () => (bloquesSimulados ? medicionesDemo(cero, variable, bloquesSimulados) : null),
    [cero, variable, bloquesSimulados],
  );
  const mediciones = medicionesSimuladas ?? medicionesBackend;

  // Last loaded data: keeps the selector dates steady while a new period
  // loads (a fixed period shows its own dates once its data arrives)
  const [ultimosBloques, setUltimosBloques] = useState<BloquesData | null>(null);
  if (bloques.status === 'data' && bloques.data !== ultimosBloques) setUltimosBloques(bloques.data);
  const periodoFechas = fechasDelPeriodo(periodo, ultimosBloques);

  const donut = donutFromBloques(bloques, cero);
  const motorInfo =
    bloques.status === 'data' && bloques.data.estado_actual
      ? { ...mockData.motorInfo, estado: bloques.data.estado_actual }
      : mockData.motorInfo;

  // Trend X axis = the period of the donut and the events table. Only data of
  // the current period counts: while its blocks load, the trend's own period
  // (same dates); the previous blocks only as a last resort
  const bloquesActuales = bloques.status === 'data' ? bloques.data : null;
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
  } else if (mediciones.status === 'data') {
    // Each point at the middle of its interval
    trendPuntoMs = mediciones.data.minutos_punto * 60_000;
    trendPoints = mediciones.data.puntos.map((p) => ({
      t: Date.parse(p.inicio) + trendPuntoMs / 2,
      value: p.promedio,
      max: p.maximo,
      marcas: p.marcas,
    }));
    trendNotice = trendPoints.length
      ? { text: `Promedio ${etiquetaPunto(mediciones.data.minutos_punto)} con el motor encendido` }
      : { text: `Sin mediciones de ${variable.label.toLowerCase()} para ${cero} en el período` };
  }
  const trendUmbral = mediciones.status === 'data' ? mediciones.data.umbral : null;
  // Evento / Mantenimiento blocks of the events table as chart bands (current period only)
  const trendBandas: TrendBanda[] = (bloquesActuales?.bloques ?? [])
    .filter((b) => b.segmento === 'EVENTO' || b.segmento === 'MANTENIMIENTO')
    .map((b) => ({ desde: Date.parse(b.inicio), hasta: Date.parse(b.fin), tipo: b.segmento as TrendBanda['tipo'] }));
  const motorLabel = cero === mockData.motor.id ? `${cero} — ${mockData.motor.name}` : cero;

  return (
    <div className={styles.dashboard}>
      {/* Desktop sidebar */}
      <Sidebar tabs={NAV_TABS} active={activeTab} onChange={setActiveTab} onLogout={onLogout} />

      {/* Mobile header + tabs */}
      <header className={styles.mobileHeader}>
        <div className={styles.mobileLogo}>VX</div>
        <NavTabs tabs={NAV_TABS} active={activeTab} onChange={setActiveTab} />
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

      <main className={styles.main}>
        <div className={styles.pageTitle}>
          <div className={styles.motorBadge}>{motorLabel}</div>
          <h1>Resumen operativo</h1>
        </div>

        <div className={styles.grid}>
          {/* Donut column: selectors on top, then the donut card */}
          <div className={`${styles.col5} ${styles.colStack}`}>
            <DonutFilters
              cero={cero}
              periodoFechas={periodoFechas}
              ceroCheck={ceroCheck}
              onCeroChange={handleCeroChange}
              onPeriodoChange={setPeriodo}
            />
            <DonutPanel
              segments={donut.segments}
              totalHours={donut.totalHours}
              motorInfo={motorInfo}
              periodo={donut.periodo}
              notice={donut.notice}
            />
          </div>

          {/* Trend column: variable picker on top, then the trend card */}
          <div className={`${styles.col7} ${styles.colStack}`}>
            <TrendVariablePicker
              variables={mockData.trendVariables}
              value={variableId}
              onChange={setVariableId}
            />
            <TrendChart
              title={`Tendencia — ${variableTitle}`}
              yTitle={variableTitle}
              points={trendPoints}
              puntoMs={trendPuntoMs}
              desde={ejeDesde}
              hasta={ejeHasta}
              nominalValue={variable.nominal}
              umbral={trendUmbral}
              bandas={trendBandas}
              notice={trendNotice}
            />
          </div>

          {/* State blocks of the selected CERO: same request and period as the donut */}
          <div className={styles.col5}>
            <EventsSummary state={bloques} periodo={periodo} onPeriodoChange={setPeriodo} />
          </div>

          {/* Map placeholder */}
          <div className={styles.col7}>
            <div className={styles.card}>
              <h3 className={styles.cardTitle}>Ubicación de equipos</h3>
              <div className={styles.mapPlaceholder}>
                <span>🗺️</span>
                <div>Mapa de planta — Fase 2</div>
              </div>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}

export default DashboardPage;
