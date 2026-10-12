import { useMemo, useState } from 'react';
import type { NavTabId, TrendVariableId } from '../../contracts/dashboard';
import { mockData, NAV_TABS } from './mockData';
import { DonutFilters } from './DonutFilters';
import { DonutPanel } from './DonutPanel';
import { simulateDonut } from './donutSimulation';
import type { CeroId, PeriodId } from './donutSimulation';
import { HorizontalBars } from './HorizontalBars';
import { NavTabs } from './NavTabs';
import { Sidebar } from './Sidebar';
import { TrendChart } from './TrendChart';
import { TrendVariablePicker } from './TrendVariablePicker';
import styles from './dashboard.module.css';

export function DashboardPage() {
  const [activeTab, setActiveTab] = useState<NavTabId>('resumen');
  const [cero, setCero] = useState<CeroId>('CERO-010');
  const [period, setPeriod] = useState<PeriodId>('month');
  const [variableId, setVariableId] = useState<TrendVariableId>('corriente');

  const donut = useMemo(() => simulateDonut(cero, period), [cero, period]);
  const variable =
    mockData.trendVariables.find((v) => v.id === variableId) ?? mockData.trendVariables[0];
  const variableTitle = variable.unit ? `${variable.label} (${variable.unit})` : variable.label;
  const motorLabel = cero === mockData.motor.id ? `${cero} — ${mockData.motor.name}` : cero;

  return (
    <div className={styles.dashboard}>
      {/* Desktop sidebar */}
      <Sidebar tabs={NAV_TABS} active={activeTab} onChange={setActiveTab} />

      {/* Mobile header + tabs */}
      <header className={styles.mobileHeader}>
        <div className={styles.mobileLogo}>VX</div>
        <NavTabs tabs={NAV_TABS} active={activeTab} onChange={setActiveTab} />
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
              onCeroChange={setCero}
              onPeriodChange={setPeriod}
            />
            <DonutPanel
              segments={donut.segments}
              totalHours={donut.totalHours}
              motorInfo={mockData.motorInfo}
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
              data={variable.data}
              nominalValue={variable.nominal}
            />
          </div>

          {/* Horizontal bars */}
          <div className={styles.col5}>
            <HorizontalBars title="Horas por turno" items={mockData.bars} />
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
