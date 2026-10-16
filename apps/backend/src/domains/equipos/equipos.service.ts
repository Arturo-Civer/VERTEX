import sql from 'mssql';

export interface Equipo {
  codigo: string;
  nombre: string;
  area: string;
}

/**
 * The query could not be answered by SQL Server: no connection (pool closed,
 * socket lost) or out of requestTimeout. Both answer 503 with the message.
 */
export class DbUnavailableError extends Error {
  constructor(cause: unknown, message = 'Sin conexión a la base de datos') {
    super(message, { cause });
    this.name = 'DbUnavailableError';
  }
}

const DB_TIMEOUT = 'La base de datos tardó demasiado en responder';

// dbo.EquiposCero.codigo is VARCHAR(30)
const MAX_CODIGO_LENGTH = 30;

const CONNECTION_ERROR_CODES = new Set([
  'ENOCONN', // no pool: the startup connection was never made or was closed
  'ESOCKET',
  'ECONNCLOSED',
  'ECONNRESET',
  'ENOTOPEN',
  'ETIMEOUT', // as a ConnectionError: the connection itself timed out
  'ELOGIN',
]);

function isConnectionError(err: unknown): boolean {
  if (err instanceof sql.ConnectionError) return true;
  const code = (err as { code?: unknown } | null)?.code;
  return typeof code === 'string' && CONNECTION_ERROR_CODES.has(code);
}

/** DbUnavailableError for a database failure; null for any other error */
function errorDeBase(err: unknown): DbUnavailableError | null {
  // A query that ran out of requestTimeout: connected, but SQL Server is slow
  if (err instanceof sql.RequestError && err.code === 'ETIMEOUT') return new DbUnavailableError(err, DB_TIMEOUT);
  if (isConnectionError(err)) return new DbUnavailableError(err);
  return null;
}

/**
 * Active equipment with the given code (e.g. CERO-010) and its area name, or
 * null when there is none. Throws DbUnavailableError when SQL Server cannot
 * be reached or does not answer in time.
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
    const errorBase = errorDeBase(err);
    if (errorBase) throw errorBase;
    throw err;
  }
}

/**
 * Period of a query: the last `dias` days up to the latest record (null: all
 * the data), or a date range [desde, hasta). The stored procedures clip it
 * to the records of the equipment.
 */
export type Periodo = { dias: number | null } | { desde: Date; hasta: Date };

/** Inputs @dias / @desde / @hasta of the stored procedures */
function conPeriodo(request: sql.Request, periodo: Periodo): sql.Request {
  const rango = 'desde' in periodo;
  return request
    .input('dias', sql.Int, rango ? null : periodo.dias)
    .input('desde', sql.DateTime2(3), rango ? periodo.desde : null)
    .input('hasta', sql.DateTime2(3), rango ? periodo.hasta : null);
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
  /** Period start, clipped to the first record */
  desde: Date | null;
  /** First and latest record of the equipment: the range a period can take */
  primer_registro: Date | null;
  ultimo_registro: Date | null;
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
 * calculation lives, over a period.
 * Null when the equipment does not exist. Throws DbUnavailableError when SQL
 * Server cannot be reached or does not answer in time.
 */
async function ejecutarResumenEstados(
  codigo: string,
  periodo: Periodo,
  detalle: boolean,
): Promise<sql.IRecordSet<Fila>[] | null> {
  if (codigo.length > MAX_CODIGO_LENGTH) return null;
  try {
    const result = await conPeriodo(new sql.Request(), periodo)
      .input('equipo_codigo', sql.VarChar(MAX_CODIGO_LENGTH), codigo)
      .input('detalle', sql.Bit, detalle)
      .execute('dbo.sp_vx_resumen_estados');
    return result.recordsets as sql.IRecordSet<Fila>[];
  } catch (err) {
    const errorBase = errorDeBase(err);
    if (errorBase) throw errorBase;
    if (err instanceof sql.RequestError && err.message === SP_EQUIPO_NO_ENCONTRADO) return null;
    throw err;
  }
}

const horasDeMinutos = (min: unknown) => Math.round((Number(min) / 60) * 100) / 100;

/**
 * Hours in each state over a period, from
 * dbo.sp_vx_resumen_estados (minutes converted to hours).
 * Null when the equipment does not exist.
 */
export async function findResumen(codigo: string, periodo: Periodo): Promise<ResumenEquipo | null> {
  const recordsets = await ejecutarResumenEstados(codigo, periodo, false);
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

  return { ...cabeceraResumen(r), ciclos, mantenimientos };
}

/** First result of dbo.sp_vx_resumen_estados: period, record range, hours and current state */
function cabeceraResumen(r: Fila) {
  return {
    fecha_referencia: (r.hasta as Date | null) ?? null,
    desde: (r.desde as Date | null) ?? null,
    primer_registro: (r.primer_registro as Date | null) ?? null,
    ultimo_registro: (r.ultimo_registro as Date | null) ?? null,
    horas: {
      ENCENDIDO: horasDeMinutos(r.min_encendido),
      APAGADO: horasDeMinutos(r.min_apagado),
      EVENTO: horasDeMinutos(r.min_evento),
      MANTENIMIENTO: horasDeMinutos(r.min_mantenimiento),
    } satisfies Record<EstadoMotor, number>,
    estado_actual: (r.estado_actual as EstadoMotor | null) ?? null,
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
  primer_registro: Date | null;
  ultimo_registro: Date | null;
  /** Hours per state of the period: the donut, from the same call as the blocks */
  horas: Record<EstadoMotor, number>;
  estado_actual: EstadoMotor | null;
  /** Newest first */
  bloques: BloqueEstado[];
}

/**
 * Consecutive blocks with the same state over a period, newest first, plus
 * the hours per state of the same execution of dbo.sp_vx_resumen_estados:
 * the donut and the events table come from a single database query.
 * Null when the equipment does not exist.
 */
export async function findBloques(codigo: string, periodo: Periodo): Promise<BloquesEquipo | null> {
  const recordsets = await ejecutarResumenEstados(codigo, periodo, true);
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
  return { ...cabeceraResumen(r), bloques };
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

/** One point of the trend: an interval of minutos_punto minutes */
export interface PuntoTendencia {
  /** Interval start (UTC) */
  inicio: Date;
  /** YYYY-MM-DD (UTC) of inicio */
  dia: string;
  promedio: number;
  minimo: number;
  maximo: number;
  lecturas: number;
  /** Readings out of the variable's threshold (0 when it is disabled) */
  marcas: number;
}

export interface MedicionesEquipo {
  variable: VariableTendencia;
  unidad: string;
  /** Period end, clipped to the latest record (null: no records) */
  fecha_referencia: Date | null;
  /** Period start, clipped to the first record */
  desde: Date | null;
  /** Point size chosen by the stored procedure from the period length: 15, 60, 240 or 1440 */
  minutos_punto: number;
  /** Threshold of the variable (ConfiguracionVariables); null: not configured */
  umbral: { min: number | null; max: number | null; habilitado: boolean } | null;
  puntos: PuntoTendencia[];
}

/**
 * Average, minimum and maximum of a variable per interval over a period, with the
 * motor running only. The query lives in
 * dbo.sp_vx_tendencia_variable (database/procedures), which uses the same
 * "running" rule as dbo.sp_vx_resumen_estados. Null when the equipment does
 * not exist.
 */
export async function findMediciones(
  codigo: string,
  variable: VariableTendencia,
  periodo: Periodo,
): Promise<MedicionesEquipo | null> {
  if (codigo.length > MAX_CODIGO_LENGTH) return null;

  try {
    const result = await conPeriodo(new sql.Request(), periodo)
      .input('equipo_codigo', sql.VarChar(MAX_CODIGO_LENGTH), codigo)
      .input('variable_codigo', sql.VarChar(50), variable)
      .execute('dbo.sp_vx_tendencia_variable');

    const recordsets = result.recordsets as sql.IRecordSet<Fila>[];
    const head = recordsets[0][0];

    // DECIMAL aggregates arrive as numbers; round for the chart
    const r3 = (v: unknown) => Math.round(Number(v) * 1000) / 1000;
    const puntos = (recordsets[1] ?? []).map((p) => ({
      inicio: p.inicio as Date,
      dia: p.dia as string,
      promedio: r3(p.promedio),
      minimo: r3(p.minimo),
      maximo: r3(p.maximo),
      lecturas: Number(p.lecturas),
      marcas: Number(p.marcas),
    }));
    const num = (v: unknown) => (v === null || v === undefined ? null : Number(v));
    return {
      variable,
      unidad: (head.unidad as string | null) ?? '',
      fecha_referencia: (head.fecha_referencia as Date | null) ?? null,
      desde: (head.desde as Date | null) ?? null,
      minutos_punto: Number(head.minutos_punto),
      umbral:
        head.umbral_habilitado === null
          ? null
          : { min: num(head.umbral_min), max: num(head.umbral_max), habilitado: Boolean(head.umbral_habilitado) },
      puntos,
    };
  } catch (err) {
    const errorBase = errorDeBase(err);
    if (errorBase) throw errorBase;
    if (err instanceof sql.RequestError && err.message === SP_EQUIPO_NO_ENCONTRADO) return null;
    throw err;
  }
}
