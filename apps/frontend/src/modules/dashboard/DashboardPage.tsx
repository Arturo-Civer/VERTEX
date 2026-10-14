import { useEffect, useMemo, useRef, useState } from 'react';
import { DEMO_MODE } from '../../shared/api';
import type { NavTabId, TrendVariableId } from '../../contracts/dashboard';
import { mockData, NAV_TABS } from './mockData';
import { DonutFilters } from './DonutFilters';
import type { CeroCheck } from './DonutFilters';
import { DonutPanel } from './DonutPanel';
import type { DonutPeriodo } from './DonutPanel';
import { fetchEquipo } from './equipos.service';
import { PERIOD_OPTIONS, simulateDonut } from './donutSimulation';
import type { CeroId, DonutData, PeriodId } from './donutSimulation';
import { fetchMediciones, fetchResumen } from './operacion.service';
import type { ResumenData } from './operacion.service';
import { useBackend } from './useBackend';
import type { BackendState } from './useBackend';
import { EventsSummary } from './EventsSummary';
import { LogoutIcon } from './LogoutIcon';
import { NavTabs } from './NavTabs';
import { Sidebar } from './Sidebar';
import { TrendChart } from './TrendChart';
import { TrendVariablePicker } from './TrendVariablePicker';
import styles from './dashboard.module.css';

type Notice = { text: string; error?: boolean };

type DonutView = DonutData & { periodo?: DonutPeriodo; notice?: Notice };

/** dd/mm from YYYY-MM-DD… (UTC, as stored) */
const diaMes = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;

/** "2026", or "2025 – 2026" when the period crosses a new year */
const anios = (desde: string | number, hasta: string | number) =>
  desde === hasta ? String(hasta) : `${desde} – ${hasta}`;

/** dd/mm of a local date */
const diaMesLocal = (d: Date) =>
  `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}`;

/** Demo mode has no measurements: the simulated period ends today */
function periodoDemo(days: number): DonutPeriodo {
  const hasta = new Date();
  const desde = new Date(hasta);
  desde.setDate(desde.getDate() - days);
  return {
    rango: `Del ${diaMesLocal(desde)} al ${diaMesLocal(hasta)}`,
    anio: anios(desde.getFullYear(), hasta.getFullYear()),
  };
}

/**
 * Donut from the backend hours; zeros plus a message while loading, on error
 * or without data. The evaluated period goes inside the donut, not in the notice.
 */
function donutFromResumen(state: BackendState<ResumenData>, cero: string): DonutView {
  const horas = state.status === 'data' ? state.data.horas : null;
  const segments = mockData.donut.segments.map((seg) => ({
    ...seg,
    hours: horas ? Math.round(horas[seg.status]) : 0,
  }));
  const totalHours = segments.reduce((sum, s) => sum + s.hours, 0);
  const base = { segments, totalHours, totalLabel: mockData.donut.totalLabel };

  if (state.status === 'error') return { ...base, notice: { text: state.message, error: true } };
  if (state.status !== 'data') return { ...base, notice: { text: 'Cargando horas…' } };
  const { desde, fecha_referencia } = state.data;
  if (!desde || !fecha_referencia) return { ...base, notice: { text: `Sin mediciones de ${cero} en la base de datos` } };
  return {
    ...base,
    periodo: {
      rango: `Del ${diaMes(desde)} al ${diaMes(fecha_referencia)}`,
      anio: anios(desde.slice(0, 4), fecha_referencia.slice(0, 4)),
      detalle: '(última medición)',
    },
  };
}

interface DashboardPageProps {
  onLogout: () => void;
}

export function DashboardPage({ onLogout }: DashboardPageProps) {
  const [activeTab, setActiveTab] = useState<NavTabId>('resumen');
  const [cero, setCero] = useState<CeroId>('CERO-010');
  const [period, setPeriod] = useState<PeriodId>('month');
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

  const periodDays = (PERIOD_OPTIONS.find((p) => p.id === period) ?? PERIOD_OPTIONS[2]).days;
  const variable =
    mockData.trendVariables.find((v) => v.id === variableId) ?? mockData.trendVariables[0];
  const variableTitle = variable.unit ? `${variable.label} (${variable.unit})` : variable.label;

  // Normal mode reads hours per state and the daily trend from the backend;
  // demo mode (Netlify) and variables without a database code stay simulated
  const resumen = useBackend(DEMO_MODE ? null : `${cero}|${periodDays}`, (signal) =>
    fetchResumen(cero, periodDays, signal),
  );
  const trendCodigo = DEMO_MODE ? undefined : variable.codigo;
  const mediciones = useBackend(
    trendCodigo ? `${cero}|${trendCodigo}|${periodDays}` : null,
    (signal) => fetchMediciones(cero, trendCodigo ?? '', periodDays, signal),
  );

  const simulatedDonut = useMemo(() => simulateDonut(cero, period), [cero, period]);
  const donut: DonutView = DEMO_MODE
    ? { ...simulatedDonut, periodo: periodoDemo(periodDays) }
    : donutFromResumen(resumen, cero);
  const motorInfo =
    resumen.status === 'data' && resumen.data.estado_actual
      ? { ...mockData.motorInfo, estado: resumen.data.estado_actual }
      : mockData.motorInfo;

  let trendData = variable.data;
  let trendNotice: Notice | undefined;
  if (!DEMO_MODE && !variable.codigo) {
    trendNotice = { text: 'Datos simulados: no hay una variable de producción en la base de datos' };
  } else if (mediciones.status === 'loading') {
    trendData = [];
    trendNotice = { text: 'Cargando mediciones…' };
  } else if (mediciones.status === 'error') {
    trendData = [];
    trendNotice = { text: mediciones.message, error: true };
  } else if (mediciones.status === 'data') {
    trendData = mediciones.data.puntos.map((p) => ({ day: diaMes(p.dia), value: p.promedio }));
    trendNotice = trendData.length
      ? { text: 'Promedio diario con el motor encendido' }
      : { text: `Sin mediciones de ${variable.label.toLowerCase()} para ${cero} en el período` };
  }
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
              period={period}
              ceroCheck={ceroCheck}
              onCeroChange={handleCeroChange}
              onPeriodChange={setPeriod}
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
              title={`Tendencia diaria — ${variableTitle}`}
              data={trendData}
              nominalValue={variable.nominal}
              notice={trendNotice}
            />
          </div>

          {/* Operating intervals of the selected CERO */}
          <div className={styles.col5}>
            <EventsSummary cero={cero} />
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
