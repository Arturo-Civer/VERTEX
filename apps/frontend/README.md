# VERTEX Dashboard — CERO (Cerámica Italia)

Dashboard industrial responsive para la plataforma de monitoreo de equipos CERO.

## Stack

- React 18/19 + TypeScript + Vite
- Recharts (donut + línea de tendencia)
- CSS Modules (sin Material UI / Ant Design)

## Estructura

```
src/
  contracts/dashboard.ts     # Tipos compartidos
  modules/dashboard/
    DashboardPage.tsx        # Página principal
    DonutChart.tsx
    KpiRow.tsx
    HorizontalBars.tsx
    TrendChart.tsx
    NavTabs.tsx              # Tabs móviles
    Sidebar.tsx              # Sidebar desktop
    mockData.ts
    dashboard.module.css
```

## Cómo ejecutar

```bash
cd vertex-dashboard   # o apps/frontend
npm install
npm run dev
```

Abre http://localhost:5173

## Responsive

- **Móvil** (`< 768px`): header fijo + tabs horizontales + stack vertical
- **Desktop** (`≥ 768px`): sidebar 200px + grid 12 columnas

## Datos demo (mock)

- Motor: CERO-010 — WEG W22 3CV-4P
- Período: últimos 30 días
- Donut: Confirmado 840 h / Provisional 192 h / Pend. Valid. 28 h
- KPIs: 4 080 mediciones · 30 días · 96 % confianza
- Barras por turno: mañana 340 · tarde 310 · noche 410
