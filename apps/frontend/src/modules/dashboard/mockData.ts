import type { DashboardMockData, NavTab } from '../../contracts/dashboard';

export const NAV_TABS: NavTab[] = [
  { id: 'resumen', label: 'Resumen', icon: '📊' },
  { id: 'motores', label: 'Motores', icon: '⚙️' },
  { id: 'mantenimiento', label: 'Mantenimiento', icon: '🔧' },
  { id: 'produccion', label: 'Producción', icon: '🏭' },
];

export const mockData: DashboardMockData = {
  motor: {
    id: 'CERO-010',
    name: 'Motor WEG W22 3CV-4P',
  },
  motorInfo: {
    producto: 'Ceranatto',
    estado: 'ENCENDIDO',
    linea: 'Línea 3',
  },
  period: 'últimos 30 días',
  donut: {
    segments: [
      {
        status: 'ENCENDIDO',
        label: 'Encend.',
        hours: 840,
        color: '#1F3864',
      },
      {
        status: 'APAGADO',
        label: 'Apagado',
        hours: 120,
        color: '#90A4AE',
      },
      {
        status: 'EVENTO',
        label: 'Evento',
        hours: 72,
        color: '#E53935',
      },
      {
        status: 'MANTENIMIENTO',
        label: 'Mtto.',
        hours: 28,
        color: '#FF9800',
      },
    ],
    totalHours: 1060,
    totalLabel: 'Horas acumuladas',
  },
  kpis: [
    { id: 'mediciones', value: '4 080', label: 'Mediciones' },
    { id: 'dias', value: '30', label: 'Días del período' },
    { id: 'confianza', value: '96 %', label: 'Confianza' },
  ],
  bars: [
    { id: 'manana', label: 'Turno mañana', hours: 340, color: '#2E75B6' },
    { id: 'tarde', label: 'Turno tarde', hours: 310, color: '#2E75B6' },
    { id: 'noche', label: 'Turno noche', hours: 410, color: '#1F3864' },
  ],
  // Simulated readings that fluctuate around each variable's nominal value
  trendVariables: [
    // With `codigo`, the backend's daily averages replace `data` (normal mode);
    // `data` stays for demo mode. Nominal values: middle of the normal range.
    {
      id: 'corriente',
      codigo: 'CORRIENTE_MOTOR',
      label: 'Corriente',
      unit: 'A',
      nominal: 5.2,
      data: [
        { day: '01', value: 5.1 },
        { day: '05', value: 5.3 },
        { day: '10', value: 5.25 },
        { day: '15', value: 5.05 },
        { day: '20', value: 5.4 },
        { day: '25', value: 5.5 },
        { day: '30', value: 5.15 },
      ],
    },
    {
      id: 'vibracion',
      codigo: 'VIBRACION_MOT',
      label: 'Vibración',
      unit: 'mm/s',
      nominal: 2.5,
      data: [
        { day: '01', value: 2.3 },
        { day: '05', value: 2.5 },
        { day: '10', value: 2.7 },
        { day: '15', value: 2.4 },
        { day: '20', value: 2.2 },
        { day: '25', value: 2.8 },
        { day: '30', value: 2.6 },
      ],
    },
    {
      id: 'temperatura',
      codigo: 'TEMPERATURA_MOT',
      label: 'Temperatura',
      unit: '°C',
      nominal: 60,
      data: [
        { day: '01', value: 57 },
        { day: '05', value: 61 },
        { day: '10', value: 63 },
        { day: '15', value: 59 },
        { day: '20', value: 62 },
        { day: '25', value: 65 },
        { day: '30', value: 60 },
      ],
    },
    {
      id: 'voltaje',
      codigo: 'VOLTAJE_MOTOR',
      label: 'Voltaje',
      unit: 'V',
      nominal: 220,
      data: [
        { day: '01', value: 219.6 },
        { day: '05', value: 220.3 },
        { day: '10', value: 220.1 },
        { day: '15', value: 219.4 },
        { day: '20', value: 220.6 },
        { day: '25', value: 220.2 },
        { day: '30', value: 219.8 },
      ],
    },
    {
      id: 'produccion',
      label: 'Producción',
      nominal: 100,
      data: [
        { day: '01', value: 94 },
        { day: '05', value: 102 },
        { day: '10', value: 98 },
        { day: '15', value: 105 },
        { day: '20', value: 97 },
        { day: '25', value: 108 },
        { day: '30', value: 101 },
      ],
    },
  ],
};
