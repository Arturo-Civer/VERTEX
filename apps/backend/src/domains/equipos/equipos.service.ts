import sql from 'mssql';

export interface Equipo {
  codigo: string;
  nombre: string;
  area: string;
}

/** The query could not reach SQL Server (pool closed, socket lost, timeout) */
export class DbUnavailableError extends Error {
  constructor(cause: unknown) {
    super('Sin conexión a la base de datos', { cause });
    this.name = 'DbUnavailableError';
  }
}

// dbo.EquiposCero.codigo is VARCHAR(30)
const MAX_CODIGO_LENGTH = 30;

const CONNECTION_ERROR_CODES = new Set([
  'ENOCONN', // no pool: the startup connection was never made or was closed
  'ESOCKET',
  'ECONNCLOSED',
  'ECONNRESET',
  'ENOTOPEN',
  'ETIMEOUT',
  'ELOGIN',
]);

function isConnectionError(err: unknown): boolean {
  if (err instanceof sql.ConnectionError) return true;
  const code = (err as { code?: unknown } | null)?.code;
  return typeof code === 'string' && CONNECTION_ERROR_CODES.has(code);
}

/**
 * Active equipment with the given code (e.g. CERO-010) and its area name, or
 * null when there is none. Throws DbUnavailableError when SQL Server cannot
 * be reached.
 */
export async function findEquipo(codigo: string): Promise<Equipo | null> {
  // Longer codes cannot exist, and would be truncated by the VARCHAR(30) param
  if (codigo.length > MAX_CODIGO_LENGTH) return null;

  try {
    const result = await new sql.Request()
      .input('codigo', sql.VarChar(MAX_CODIGO_LENGTH), codigo)
      .query<Equipo>(`
        SELECT e.codigo, e.nombre, a.nombre AS area
        FROM dbo.EquiposCero e
        JOIN dbo.Areas a ON a.area_id = e.area_id
        WHERE e.codigo = @codigo AND e.activo = 1
      `);
    return result.recordset[0] ?? null;
  } catch (err) {
    if (isConnectionError(err)) throw new DbUnavailableError(err);
    throw err;
  }
}

export type EstadoMotor = 'ENCENDIDO' | 'APAGADO' | 'EVENTO' | 'MANTENIMIENTO';

export interface CicloResumen {
  inicio: Date;
  ultimo_registro: Date;
  registros_encendido: number;
  registros_encendido_con_evento: number;
  /** registros_encendido_con_evento / registros_encendido × 100 (null: none running) */
  porcentaje: number | null;
  estado_evento: boolean;
  estado_evento_desde: Date | null;
  primera_marca: Date | null;
}

export interface MantenimientoDetectado {
  inicio: Date;
  fin: Date;
  duracion_min: number;
}

export interface ResumenEquipo {
  /** Period end: the latest record of the equipment (null: no records) */
  fecha_referencia: Date | null;
  /** Period start: fecha_referencia - dias, or the first record if later */
  desde: Date | null;
  horas: Record<EstadoMotor, number>;
  /** Segment of the latest record in the period (null: no records) */
  estado_actual: EstadoMotor | null;
  /** Maintenance cycles touching the period, with their event counters */
  ciclos: CicloResumen[];
  mantenimientos: MantenimientoDetectado[];
}

/** RAISERROR text of dbo.sp_vx_resumen_estados for an unknown equipment */
const SP_EQUIPO_NO_ENCONTRADO = 'Equipo no encontrado.';

type Fila = Record<string, unknown>;

/**
 * Runs dbo.sp_vx_resumen_estados (database/procedures), where the state
 * calculation lives, over the last `dias` days of data (null: all of it).
 * Null when the equipment does not exist. Throws DbUnavailableError when SQL
 * Server cannot be reached.
 */
async function ejecutarResumenEstados(
  codigo: string,
  dias: number | null,
  detalle: boolean,
): Promise<sql.IRecordSet<Fila>[] | null> {
  if (codigo.length > MAX_CODIGO_LENGTH) return null;
  try {
    const result = await new sql.Request()
      .input('equipo_codigo', sql.VarChar(MAX_CODIGO_LENGTH), codigo)
      .input('dias', sql.Int, dias)
      .input('detalle', sql.Bit, detalle)
      .execute('dbo.sp_vx_resumen_estados');
    return result.recordsets as sql.IRecordSet<Fila>[];
  } catch (err) {
    if (isConnectionError(err)) throw new DbUnavailableError(err);
    if (err instanceof sql.RequestError && err.message === SP_EQUIPO_NO_ENCONTRADO) return null;
    throw err;
  }
}

const horasDeMinutos = (min: unknown) => Math.round((Number(min) / 60) * 100) / 100;

/**
 * Hours in each state over the last `dias` days of data, from
 * dbo.sp_vx_resumen_estados (minutes converted to hours).
 * Null when the equipment does not exist.
 */
export async function findResumen(codigo: string, dias: number): Promise<ResumenEquipo | null> {
  const recordsets = await ejecutarResumenEstados(codigo, dias, false);
  if (!recordsets) return null;

  const r = recordsets[0][0];
  const ciclos = (recordsets[1] ?? []).map((c) => ({
    inicio: c.inicio as Date,
    ultimo_registro: c.ultimo_registro as Date,
    registros_encendido: Number(c.registros_encendido),
    registros_encendido_con_evento: Number(c.registros_encendido_con_evento),
    porcentaje: c.porcentaje === null ? null : Number(c.porcentaje),
    estado_evento: Boolean(c.estado_evento),
    estado_evento_desde: (c.estado_evento_desde as Date | null) ?? null,
    primera_marca: (c.primera_marca as Date | null) ?? null,
  }));
  const mantenimientos = (recordsets[2] ?? []).map((m) => ({
    inicio: m.inicio as Date,
    fin: m.fin as Date,
    duracion_min: Number(m.duracion_min),
  }));

  return {
    fecha_referencia: (r.hasta as Date | null) ?? null,
    desde: (r.desde as Date | null) ?? null,
    horas: {
      ENCENDIDO: horasDeMinutos(r.min_encendido),
      APAGADO: horasDeMinutos(r.min_apagado),
      EVENTO: horasDeMinutos(r.min_evento),
      MANTENIMIENTO: horasDeMinutos(r.min_mantenimiento),
    },
    estado_actual: (r.estado_actual as EstadoMotor | null) ?? null,
    ciclos,
    mantenimientos,
  };
}

export interface BloqueEstado {
  inicio: Date;
  fin: Date;
  duracion_min: number;
  segmento: EstadoMotor;
  /** Rule that decided the block, e.g. "4b corriente 0 con marca previa" */
  regla: string;
  /** Records of the block with an event mark */
  marcas: number;
}

export interface BloquesEquipo {
  /** Period end: the latest record of the equipment (null: no records) */
  fecha_referencia: Date | null;
  desde: Date | null;
  /** Newest first */
  bloques: BloqueEstado[];
}

/**
 * Consecutive blocks with the same state over the last `dias` days of data
 * (null: all of it), newest first, from dbo.sp_vx_resumen_estados.
 * Null when the equipment does not exist.
 */
export async function findBloques(codigo: string, dias: number | null): Promise<BloquesEquipo | null> {
  const recordsets = await ejecutarResumenEstados(codigo, dias, true);
  if (!recordsets) return null;

  const r = recordsets[0][0];
  const bloques = (recordsets[3] ?? [])
    .map((b) => ({
      inicio: b.inicio as Date,
      fin: b.fin as Date,
      duracion_min: Number(b.minutos),
      segmento: b.segmento as EstadoMotor,
      regla: b.regla as string,
      marcas: Number(b.marcas),
    }))
    .reverse();
  return {
    fecha_referencia: (r.hasta as Date | null) ?? null,
    desde: (r.desde as Date | null) ?? null,
    bloques,
  };
}

/** Variables the trend chart can request (dbo.Variables.codigo) */
export const VARIABLES_TENDENCIA = [
  'CORRIENTE_MOTOR',
  'TEMPERATURA_MOT',
  'VIBRACION_MOT',
  'VOLTAJE_MOTOR',
  'FRECUENCIA_RED',
  'POTENCIA_MOT',
  'RPM_MOTOR',
] as const;
export type VariableTendencia = (typeof VARIABLES_TENDENCIA)[number];

export interface PuntoDiario {
  /** YYYY-MM-DD (UTC) */
  dia: string;
  promedio: number;
  minimo: number;
  maximo: number;
  lecturas: number;
}

export interface MedicionesEquipo {
  variable: VariableTendencia;
  unidad: string;
  /** Latest measurement of the equipment; the day window counts back from it */
  fecha_referencia: Date | null;
  puntos: PuntoDiario[];
}

/**
 * Daily average, minimum and maximum of a variable over the last `dias` days
 * of data (null: all), counting only the minutes with the motor running
 * (ESTADO_MOTOR = 1 at the same event_time): readings with the motor off are
 * near zero and would drag the average down. Null when the equipment does
 * not exist.
 */
export async function findMediciones(
  codigo: string,
  variable: VariableTendencia,
  dias: number | null,
): Promise<MedicionesEquipo | null> {
  if (codigo.length > MAX_CODIGO_LENGTH) return null;

  try {
    const result = await new sql.Request()
      .input('codigo', sql.VarChar(MAX_CODIGO_LENGTH), codigo)
      .input('variable', sql.VarChar(50), variable)
      .input('dias', sql.Int, dias)
      .query(`
        DECLARE @equipo_id UNIQUEIDENTIFIER =
          (SELECT equipo_id FROM dbo.EquiposCero WHERE codigo = @codigo AND activo = 1);
        DECLARE @variable_id UNIQUEIDENTIFIER, @unidad VARCHAR(20);
        SELECT @variable_id = variable_id, @unidad = unidad FROM dbo.Variables WHERE codigo = @variable;
        DECLARE @estado_id UNIQUEIDENTIFIER =
          (SELECT variable_id FROM dbo.Variables WHERE codigo = 'ESTADO_MOTOR');
        DECLARE @hasta DATETIME2(3) =
          (SELECT MAX(event_time) FROM dbo.Mediciones WHERE equipo_id = @equipo_id);

        SELECT @equipo_id AS equipo_id, @unidad AS unidad, @hasta AS fecha_referencia;

        SELECT CONVERT(CHAR(10), CAST(m.event_time AS DATE), 23) AS dia,
               AVG(m.valor) AS promedio, MIN(m.valor) AS minimo, MAX(m.valor) AS maximo,
               COUNT(*) AS lecturas
        FROM dbo.Mediciones m
        JOIN dbo.Mediciones e
          ON e.equipo_id = m.equipo_id AND e.event_time = m.event_time
         AND e.variable_id = @estado_id AND e.valor = 1
        WHERE m.equipo_id = @equipo_id
          AND m.variable_id = @variable_id
          AND (@dias IS NULL OR m.event_time > DATEADD(day, -@dias, @hasta))
        GROUP BY CAST(m.event_time AS DATE)
        ORDER BY dia;
      `);

    const recordsets = result.recordsets as sql.IRecordSet<unknown>[];
    const head = recordsets[0][0] as { equipo_id: string | null; unidad: string | null; fecha_referencia: Date | null };
    if (!head.equipo_id) return null;

    // DECIMAL aggregates arrive as numbers; round for the chart
    const r3 = (v: unknown) => Math.round(Number(v) * 1000) / 1000;
    const puntos = (recordsets[1] as sql.IRecordSet<PuntoDiario>).map((p) => ({
      dia: p.dia,
      promedio: r3(p.promedio),
      minimo: r3(p.minimo),
      maximo: r3(p.maximo),
      lecturas: Number(p.lecturas),
    }));
    return { variable, unidad: head.unidad ?? '', fecha_referencia: head.fecha_referencia, puntos };
  } catch (err) {
    if (isConnectionError(err)) throw new DbUnavailableError(err);
    throw err;
  }
}
