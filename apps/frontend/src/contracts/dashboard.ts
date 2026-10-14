/** Shared contracts for VERTEX dashboard (CERO monitoring) */

export type ValidationStatus = 'ENCENDIDO' | 'APAGADO' | 'EVENTO' | 'MANTENIMIENTO';

export interface DonutSegment {
  status: ValidationStatus;
  label: string;
  hours: number;
  color: string;
}

export interface KpiItem {
  id: string;
  value: string;
  label: string;
}

export interface BarItem {
  id: string;
  label: string;
  hours: number;
  color?: string;
}

export type Producto = 'Ceranatto' | 'Esedra' | 'Gemas' | 'Ambrato' | 'Líbano';

export type LineaProduccion =
  | 'Línea 1'
  | 'Línea 2'
  | 'Línea 3'
  | 'Línea 4'
  | 'Línea 5'
  | 'Línea 6';

/** Current assignment of the motor shown next to the donut */
export interface MotorInfo {
  producto: Producto;
  estado: ValidationStatus;
  linea: LineaProduccion;
}

/** Unit used to display the donut values (stored values are always hours) */
export type TimeUnit = 'horas' | 'dias' | 'semanas' | 'meses';

export type TrendVariableId = 'corriente' | 'vibracion' | 'temperatura' | 'voltaje' | 'produccion';

export interface TrendPoint {
  day: string;
  value: number;
}

/** A measured variable for the trend chart, with its nominal reference value */
export interface TrendVariable {
  id: TrendVariableId;
  /** dbo.Variables.codigo read from the backend; omitted: simulated only */
  codigo?: string;
  label: string;
  /** Unit shown next to the label, e.g. "A"; omitted for unitless variables */
  unit?: string;
  nominal: number;
  data: TrendPoint[];
}

export interface DashboardMockData {
  motor: {
    id: string;
    name: string;
  };
  motorInfo: MotorInfo;
  period: string;
  donut: {
    segments: DonutSegment[];
    totalHours: number;
    totalLabel: string;
  };
  kpis: KpiItem[];
  bars: BarItem[];
  trendVariables: TrendVariable[];
}

export type NavTabId = 'resumen' | 'motores' | 'mantenimiento' | 'produccion';

export interface NavTab {
  id: NavTabId;
  label: string;
  icon?: string;
}
