/**
 * Audit snapshot of the database: docs/db-snapshot.xlsx (git-ignored).
 *
 *   npm run db:export        (from apps/backend, reads apps/backend/.env)
 *
 * Sheets:
 *   - "Mapeo Frontend-BD": every dashboard field → endpoint → table / column.
 *     Example values of the connected fields are read from the database.
 *   - One sheet per dbo table, with the columns as the first row and the
 *     rows as they are stored. Password hashes are never written.
 *
 * Read-only: only SELECT queries.
 */
import path from 'node:path';
import ExcelJS from 'exceljs';
import sql from 'mssql';
import { findMediciones, findResumen } from '../src/domains/equipos/equipos.service';
import type { EstadoMotor, VariableTendencia } from '../src/domains/equipos/equipos.service';

const OUTPUT = path.resolve(__dirname, '../../../docs/db-snapshot.xlsx');

// Equipment used for the example values of the mapping sheet
const EJEMPLO_CERO = 'CERO-010';

// Columns whose values are replaced: secrets must not leave the database
const SENSITIVE_COLUMN = /hash|password|secret|token|nonce/i;
const REDACTED = '[oculto]';

const PENDIENTE = 'Pendiente conexión real';

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Falta la variable de entorno ${name} (ver apps/backend/.env.example)`);
  return value;
}

// ── Mapping sheet ───────────────────────────────────────────

interface MapeoRow {
  seccion: string;
  campo: string;
  ejemplo: string;
  endpoint: string;
  tabla: string;
  columna: string;
  filtro: string;
  nota: string;
}

const MAPEO_COLUMNS: { header: string; key: keyof MapeoRow; width: number }[] = [
  { header: 'Sección dashboard', key: 'seccion', width: 24 },
  { header: 'Campo visible', key: 'campo', width: 30 },
  { header: 'Valor de ejemplo', key: 'ejemplo', width: 30 },
  { header: 'Endpoint', key: 'endpoint', width: 40 },
  { header: 'Tabla BD', key: 'tabla', width: 28 },
  { header: 'Columna BD', key: 'columna', width: 26 },
  { header: 'Filtro / condición', key: 'filtro', width: 60 },
  { header: 'Nota', key: 'nota', width: 60 },
];

const INTERVALOS_ENDPOINT = '/api/equipos/:codigo/intervalos?dias=N';
const INTERVALOS_FILTRO =
  'WHERE equipo_id = (SELECT equipo_id FROM EquiposCero WHERE codigo = :codigo AND activo = 1) ' +
  'AND inicio >= DATEADD(day, -N, fecha_referencia) ORDER BY inicio DESC';

const ESTADOS: Record<string, string> = {
  PARADA_NORMAL: 'Apagado',
  MANTENIMIENTO: 'Mantenimiento',
  FALLA: 'Evento',
};

// Example window of the donut and trend rows ("Este mes" in the dashboard)
const EJEMPLO_DIAS = 30;
const RESUMEN_ENDPOINT = '/api/equipos/:codigo/resumen?dias=N';
const RESUMEN_FILTRO =
  'Ventana: [MAX(Mediciones.event_time) - N días, MAX(event_time)] del equipo, sin empezar antes de la primera medición. ' +
  'Encendido = duración de los intervalos; el hueco hasta el siguiente intervalo toma el estado del tipo_cierre anterior';
const MEDICIONES_ENDPOINT = '/api/equipos/:codigo/mediciones?variable=CODIGO&dias=N';
const MEDICIONES_FILTRO =
  'AVG / MIN / MAX por día (UTC) de las lecturas con ESTADO_MOTOR = 1 en el mismo event_time, ' +
  'últimos N días contados desde MAX(event_time) del equipo';
const ESTADO_LABEL: Record<EstadoMotor, string> = {
  ENCENDIDO: 'Encendido',
  APAGADO: 'Apagado',
  EVENTO: 'Evento',
  MANTENIMIENTO: 'Mantenimiento',
};

/** Same format as the dashboard table: dd/mm/aaaa hh:mm, as stored (UTC) */
function fechaUtc(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getUTCDate())}/${p(d.getUTCMonth() + 1)}/${d.getUTCFullYear()} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}`;
}

function horas(min: number): string {
  return `${(min / 60).toFixed(1).replace('.', ',')} h`;
}

async function buildMapeo(): Promise<MapeoRow[]> {
  const equipo = (
    await new sql.Request()
      .input('codigo', sql.VarChar(30), EJEMPLO_CERO)
      .query<{ equipo_id: string; codigo: string }>(
        'SELECT equipo_id, codigo FROM dbo.EquiposCero WHERE codigo = @codigo AND activo = 1',
      )
  ).recordset[0];

  // Newest closed and open interval of the example equipment, for the examples
  const intervalos = equipo
    ? (
        await new sql.Request().input('equipo_id', sql.UniqueIdentifier, equipo.equipo_id).query<{
          inicio: Date;
          fin: Date | null;
          duracion_min: number | null;
          tipo_cierre: string | null;
        }>(`
          SELECT TOP 2 inicio, fin, duracion_min, tipo_cierre
          FROM dbo.IntervalosFuncionamiento
          WHERE equipo_id = @equipo_id
          ORDER BY inicio DESC
        `)
      ).recordset
    : [];
  const abierto = intervalos.find((i) => i.fin === null);
  const cerrado = intervalos.find((i) => i.fin !== null);
  const sinDato = `(sin datos para ${EJEMPLO_CERO})`;

  // Same queries as the endpoints, for the example values
  const resumen = equipo ? await findResumen(EJEMPLO_CERO, EJEMPLO_DIAS) : null;
  const horasDe = (estado: EstadoMotor) =>
    resumen?.fecha_referencia ? `${Math.round(resumen.horas[estado])} h` : sinDato;
  const tendencia = async (variable: VariableTendencia) => {
    const data = equipo ? await findMediciones(EJEMPLO_CERO, variable, EJEMPLO_DIAS) : null;
    if (!data?.puntos.length) return sinDato;
    const promedios = data.puntos.map((p) => p.promedio);
    const fmt = (v: number) => v.toLocaleString('es-CO', { maximumFractionDigits: 2 });
    return `${fmt(Math.min(...promedios))} – ${fmt(Math.max(...promedios))} ${data.unidad} (${data.puntos.length} días)`;
  };

  const conectado = (r: Omit<MapeoRow, 'nota'> & { nota?: string }): MapeoRow => ({ nota: '', ...r });
  const mock = (seccion: string, campo: string, ejemplo: string, tabla: string, columna: string, nota: string): MapeoRow => ({
    seccion,
    campo,
    ejemplo,
    endpoint: '',
    tabla,
    columna,
    filtro: '',
    nota: `${PENDIENTE}. ${nota}`,
  });

  return [
    // ── Connected to the database ──
    conectado({
      seccion: 'Selector CERO',
      campo: 'CERO (opciones del desplegable)',
      ejemplo: EJEMPLO_CERO,
      endpoint: '',
      tabla: '',
      columna: '',
      filtro: '',
      nota: 'Lista fija en el frontend (CERO_OPTIONS en donutSimulation.ts): CERO-010 a CERO-013. No se lee de la BD.',
    }),
    conectado({
      seccion: 'Selector CERO',
      campo: 'Verificación ✓ (borde verde)',
      ejemplo: equipo ? `✓ ${equipo.codigo}` : sinDato,
      endpoint: '/api/equipos/:codigo',
      tabla: 'EquiposCero',
      columna: 'codigo, activo',
      filtro: 'WHERE codigo = :codigo AND activo = 1',
      nota: 'Solo en modo normal; en modo demo no se consulta.',
    }),
    conectado({
      seccion: 'Selector CERO',
      campo: 'Banner de error (borde rojo)',
      ejemplo: 'Equipo no encontrado',
      endpoint: '/api/equipos/:codigo',
      tabla: 'EquiposCero',
      columna: 'codigo',
      filtro: '404 si no hay fila; 503 "Sin conexión a la base de datos" si SQL Server no responde',
    }),
    conectado({
      seccion: 'Selector CERO',
      campo: '(no se muestra) nombre, área',
      ejemplo: '',
      endpoint: '/api/equipos/:codigo',
      tabla: 'EquiposCero / Areas',
      columna: 'EquiposCero.nombre, Areas.nombre',
      filtro: 'JOIN Areas ON Areas.area_id = EquiposCero.area_id',
      nota: 'El endpoint los devuelve, pero el dashboard todavía no los muestra.',
    }),
    conectado({
      seccion: 'Tabla eventos',
      campo: 'Período: 7 / 15 / 30 días / Todo',
      ejemplo: '30 días',
      endpoint: INTERVALOS_ENDPOINT,
      tabla: 'IntervalosFuncionamiento',
      columna: 'fin (MAX) → fecha_referencia',
      filtro: 'fecha_referencia = COALESCE(MAX(fin), MAX(inicio)) del equipo; "Todo" = sin ?dias',
      nota: 'Nunca usa el reloj del servidor.',
    }),
    conectado({
      seccion: 'Tabla eventos',
      campo: 'Inicio',
      ejemplo: intervalos[0] ? fechaUtc(intervalos[0].inicio) : sinDato,
      endpoint: INTERVALOS_ENDPOINT,
      tabla: 'IntervalosFuncionamiento',
      columna: 'inicio',
      filtro: INTERVALOS_FILTRO,
      nota: 'Se muestra en UTC, tal como está guardado.',
    }),
    conectado({
      seccion: 'Tabla eventos',
      campo: 'Fin',
      ejemplo: cerrado?.fin ? fechaUtc(cerrado.fin) : abierto ? 'En curso' : sinDato,
      endpoint: INTERVALOS_ENDPOINT,
      tabla: 'IntervalosFuncionamiento',
      columna: 'fin',
      filtro: 'NULL → "En curso"',
    }),
    conectado({
      seccion: 'Tabla eventos',
      campo: 'Duración',
      ejemplo: cerrado?.duracion_min != null ? horas(cerrado.duracion_min) : sinDato,
      endpoint: INTERVALOS_ENDPOINT,
      tabla: 'IntervalosFuncionamiento',
      columna: 'duracion_min',
      filtro: 'duracion_min / 60 con 1 decimal + " h"; NULL → "—"',
    }),
    conectado({
      seccion: 'Tabla eventos',
      campo: 'Estado',
      ejemplo: abierto ? 'En marcha ▶' : cerrado?.tipo_cierre ? (ESTADOS[cerrado.tipo_cierre] ?? cerrado.tipo_cierre) : sinDato,
      endpoint: INTERVALOS_ENDPOINT,
      tabla: 'IntervalosFuncionamiento',
      columna: 'tipo_cierre',
      filtro: 'NULL → "En marcha ▶", PARADA_NORMAL → "Apagado", MANTENIMIENTO → "Mantenimiento", FALLA → "Evento"',
    }),
    conectado({
      seccion: 'Info motor',
      campo: 'Estado',
      ejemplo: resumen?.estado_actual ? ESTADO_LABEL[resumen.estado_actual] : sinDato,
      endpoint: RESUMEN_ENDPOINT,
      tabla: 'IntervalosFuncionamiento',
      columna: 'fin, tipo_cierre (último intervalo)',
      filtro: 'fin NULL → Encendido; si no, según tipo_cierre: MANTENIMIENTO → Mantenimiento, FALLA → Evento, otro → Apagado',
    }),
    conectado({
      seccion: 'Selector Período (dona)',
      campo: 'Últimos 7 / 15 días, Este mes, 3 / 6 meses',
      ejemplo: 'Este mes (30 días)',
      endpoint: `${RESUMEN_ENDPOINT} y ${MEDICIONES_ENDPOINT}`,
      tabla: 'Mediciones',
      columna: 'event_time (MAX) → fecha de referencia',
      filtro: 'dias = 7, 15, 30, 90 o 180',
      nota: 'Define la ventana de la dona y de la tendencia. Nunca usa el reloj del servidor.',
    }),
    conectado({
      seccion: 'Dona',
      campo: 'Horas acumuladas (total)',
      ejemplo: resumen?.fecha_referencia
        ? `${Object.values(resumen.horas).reduce((a, b) => a + Math.round(b), 0)} h`
        : sinDato,
      endpoint: RESUMEN_ENDPOINT,
      tabla: 'IntervalosFuncionamiento / Mediciones',
      columna: 'inicio, fin / event_time',
      filtro: 'Suma de los cuatro estados = horas de la ventana',
    }),
    conectado({ seccion: 'Dona', campo: 'Encendido (h)', ejemplo: horasDe('ENCENDIDO'), endpoint: RESUMEN_ENDPOINT, tabla: 'IntervalosFuncionamiento', columna: 'inicio, fin (NULL = hasta la última medición)', filtro: RESUMEN_FILTRO }),
    conectado({ seccion: 'Dona', campo: 'Apagado (h)', ejemplo: horasDe('APAGADO'), endpoint: RESUMEN_ENDPOINT, tabla: 'IntervalosFuncionamiento', columna: 'tipo_cierre = PARADA_NORMAL', filtro: 'Huecos tras intervalos cerrados por PARADA_NORMAL' }),
    conectado({ seccion: 'Dona', campo: 'Evento (h)', ejemplo: horasDe('EVENTO'), endpoint: RESUMEN_ENDPOINT, tabla: 'IntervalosFuncionamiento', columna: 'tipo_cierre = FALLA', filtro: 'Huecos tras intervalos cerrados por FALLA (parada precedida de anomalías)' }),
    conectado({ seccion: 'Dona', campo: 'Mantenimiento (h)', ejemplo: horasDe('MANTENIMIENTO'), endpoint: RESUMEN_ENDPOINT, tabla: 'IntervalosFuncionamiento / IntervencionesMantenimiento', columna: 'tipo_cierre = MANTENIMIENTO / fecha_inicio, fecha_fin', filtro: 'Huecos sin mediciones tras intervalos cerrados por MANTENIMIENTO (coinciden con las intervenciones)' }),
    conectado({ seccion: 'Tendencia', campo: 'Corriente (A)', ejemplo: await tendencia('CORRIENTE_MOTOR'), endpoint: MEDICIONES_ENDPOINT, tabla: 'Mediciones / Variables', columna: 'valor, event_time (CORRIENTE_MOTOR)', filtro: MEDICIONES_FILTRO }),
    conectado({ seccion: 'Tendencia', campo: 'Vibración (mm/s)', ejemplo: await tendencia('VIBRACION_MOT'), endpoint: MEDICIONES_ENDPOINT, tabla: 'Mediciones / Variables', columna: 'valor, event_time (VIBRACION_MOT)', filtro: MEDICIONES_FILTRO }),
    conectado({ seccion: 'Tendencia', campo: 'Temperatura (°C)', ejemplo: await tendencia('TEMPERATURA_MOT'), endpoint: MEDICIONES_ENDPOINT, tabla: 'Mediciones / Variables', columna: 'valor, event_time (TEMPERATURA_MOT)', filtro: MEDICIONES_FILTRO }),
    conectado({ seccion: 'Tendencia', campo: 'Voltaje (V)', ejemplo: await tendencia('VOLTAJE_MOTOR'), endpoint: MEDICIONES_ENDPOINT, tabla: 'Mediciones / Variables', columna: 'valor, event_time (VOLTAJE_MOTOR)', filtro: MEDICIONES_FILTRO }),

    // ── Still simulated (mockData.ts / donutSimulation.ts) ──
    mock('Cabecera', 'Badge del motor', 'CERO-010 — Motor WEG W22 3CV-4P', 'EquiposCero / Motores / EquipoMotorHistorial', 'EquiposCero.codigo, Motores.nombre, Motores.modelo', 'Motor vigente = EquipoMotorHistorial con fecha_fin NULL.'),
    mock('Info motor', 'Producto', 'Ceranatto', '', '', 'No hay tabla de productos en la BD.'),
    mock('Info motor', 'Línea', 'Línea 3', 'Lineas (vacía) / Areas', 'EquiposCero.linea_id (NULL), Areas.nombre', 'Lineas no tiene filas y linea_id es NULL; el área sí existe.'),
    mock('Dona', 'Unidad: h / días / sem / meses', 'Horas', '', '', 'Solo frontend: conversión de unidades.'),
    mock('Tendencia', 'Producción', '94 – 108', '', '', 'No hay variable de producción en la BD; el dashboard la muestra simulada y lo indica.'),
    mock('Tendencia', 'Línea nominal', 'Nominal: 5,2 A', 'Motores / ConfiguracionVariables (vacía)', 'rpm_nominal, potencia_kw', 'Valores fijos en mockData.ts (mitad del rango normal: 5,2 A, 2,5 mm/s, 60 °C, 220 V). ConfiguracionVariables está vacía.'),
    mock('Mapa', 'Ubicación de equipos', 'Mapa de planta — Fase 2', '', '', 'Placeholder; sin datos de ubicación en la BD.'),
  ];
}

// ── Workbook helpers ────────────────────────────────────────

function styleHeader(sheet: ExcelJS.Worksheet) {
  const header = sheet.getRow(1);
  header.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  header.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F3864' } };
  sheet.views = [{ state: 'frozen', ySplit: 1 }];
  if (sheet.columnCount > 0) {
    sheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: sheet.columnCount } };
  }
}

function cellValue(value: unknown): ExcelJS.CellValue {
  if (value === null || value === undefined) return null;
  if (Buffer.isBuffer(value)) return `0x${value.toString('hex')}`;
  if (value instanceof Date || typeof value === 'number' || typeof value === 'boolean' || typeof value === 'string') {
    return value;
  }
  return JSON.stringify(value);
}

// Bigger tables (Mediciones: one row per minute and variable) do not fit in
// memory as a sheet: only their newest rows are exported
const MAX_FILAS_HOJA = 20_000;
const ORDEN_RECIENTES = ['event_time', 'fecha', 'creado_en'];

async function addTableSheet(workbook: ExcelJS.Workbook, table: string) {
  const name = `dbo.[${table.replace(/]/g, ']]')}]`;
  const total = Number(
    (await new sql.Request().query<{ n: number }>(`SELECT COUNT_BIG(*) AS n FROM ${name}`)).recordset[0].n,
  );
  let query = `SELECT * FROM ${name}`;
  if (total > MAX_FILAS_HOJA) {
    const cols = (
      await new sql.Request()
        .input('table', sql.NVarChar(128), table)
        .query<{ c: string }>("SELECT COLUMN_NAME AS c FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = 'dbo' AND TABLE_NAME = @table")
    ).recordset.map((r) => r.c);
    const orden = ORDEN_RECIENTES.find((c) => cols.includes(c));
    query = `SELECT TOP (${MAX_FILAS_HOJA}) * FROM ${name}${orden ? ` ORDER BY [${orden}] DESC` : ''}`;
  }
  const result = await new sql.Request().query(query);
  const columns = Object.keys(result.recordset.columns);
  const sheet = workbook.addWorksheet(table.slice(0, 31));

  sheet.columns = columns.map((c) => {
    const type = result.recordset.columns[c].type as unknown;
    const isDate = type === sql.DateTime2 || type === sql.DateTime || type === sql.Date || type === sql.DateTimeOffset || type === sql.SmallDateTime;
    return { header: c, key: c, width: Math.min(Math.max(c.length + 2, 14), 50), style: isDate ? { numFmt: 'yyyy-mm-dd hh:mm:ss.000' } : {} };
  });

  for (const row of result.recordset as Record<string, unknown>[]) {
    sheet.addRow(columns.map((c) => (SENSITIVE_COLUMN.test(c) && row[c] !== null ? REDACTED : cellValue(row[c]))));
  }
  styleHeader(sheet);
  return { exportadas: result.recordset.length, total };
}

let pool: sql.ConnectionPool | undefined;

async function main() {
  // Global pool, as in src/main.ts: the helpers use `new sql.Request()`
  pool = await sql.connect({
    server: requireEnv('DB_SERVER'),
    port: Number(process.env.DB_PORT ?? 1433),
    user: requireEnv('DB_USER'),
    password: requireEnv('DB_PASSWORD'),
    database: requireEnv('DB_NAME'),
    options: {
      encrypt: true,
      trustServerCertificate: process.env.DB_TRUST_SERVER_CERTIFICATE !== 'false',
    },
  });

  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'VERTEX db:export';
  workbook.created = new Date();

  const mapeo = workbook.addWorksheet('Mapeo Frontend-BD');
  mapeo.columns = MAPEO_COLUMNS;
  for (const row of await buildMapeo()) {
    const added = mapeo.addRow(row);
    added.alignment = { vertical: 'top', wrapText: true };
    if (row.nota.startsWith(PENDIENTE)) {
      added.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFF3E0' } };
    }
  }
  styleHeader(mapeo);

  const tables = (
    await new sql.Request().query<{ name: string }>(
      "SELECT name FROM sys.tables WHERE schema_id = SCHEMA_ID('dbo') ORDER BY name",
    )
  ).recordset.map((t) => t.name);

  const recortadas: string[] = [];
  for (const table of tables) {
    const { exportadas, total } = await addTableSheet(workbook, table);
    if (exportadas < total) {
      recortadas.push(`${table}: se exportan las ${exportadas} filas más recientes de ${total}.`);
      console.log(`  ${table}: ${exportadas} de ${total} filas (las más recientes)`);
    } else {
      console.log(`  ${table}: ${total} filas`);
    }
  }

  if (recortadas.length) {
    const notas = workbook.addWorksheet('Notas');
    notas.columns = [{ header: 'Tablas recortadas', key: 'nota', width: 100 }];
    for (const nota of recortadas) notas.addRow({ nota });
    styleHeader(notas);
  }

  await workbook.xlsx.writeFile(OUTPUT);
  console.log(`\n${tables.length} tablas + "Mapeo Frontend-BD" → ${OUTPUT}`);
}

main()
  .catch((err: unknown) => {
    console.error('No se pudo generar el Excel:', err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(() => pool?.close());
