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

export interface Intervalo {
  inicio: Date;
  fin: Date | null;
  duracion_min: number | null;
  tipo_cierre: string | null;
}

export interface IntervalosEquipo {
  /** Latest interval end of the equipment; the day window counts back from it */
  fecha_referencia: Date | null;
  intervalos: Intervalo[];
}

/**
 * Operating intervals of an active equipment, newest first. With `dias`, only
 * those starting within `dias` days before the reference date (the latest
 * `fin` of the equipment — never the server clock); without it, all of them.
 * Null when the equipment does not exist. Throws DbUnavailableError when SQL
 * Server cannot be reached.
 */
export async function findIntervalos(
  codigo: string,
  dias: number | null,
): Promise<IntervalosEquipo | null> {
  if (codigo.length > MAX_CODIGO_LENGTH) return null;

  try {
    const result = await new sql.Request()
      .input('codigo', sql.VarChar(MAX_CODIGO_LENGTH), codigo)
      .input('dias', sql.Int, dias)
      .query(`
        DECLARE @equipo_id UNIQUEIDENTIFIER =
          (SELECT equipo_id FROM dbo.EquiposCero WHERE codigo = @codigo AND activo = 1);

        -- Only open intervals so far: fall back to the latest start
        DECLARE @fecha_referencia DATETIME2 =
          (SELECT COALESCE(MAX(fin), MAX(inicio))
           FROM dbo.IntervalosFuncionamiento
           WHERE equipo_id = @equipo_id);

        SELECT @equipo_id AS equipo_id, @fecha_referencia AS fecha_referencia;

        SELECT inicio, fin, duracion_min, tipo_cierre
        FROM dbo.IntervalosFuncionamiento
        WHERE equipo_id = @equipo_id
          AND (@dias IS NULL OR inicio >= DATEADD(day, -@dias, @fecha_referencia))
        ORDER BY inicio DESC;
      `);

    const recordsets = result.recordsets as sql.IRecordSet<unknown>[];
    const head = recordsets[0][0] as { equipo_id: string | null; fecha_referencia: Date | null };
    if (!head.equipo_id) return null;

    const intervalos = (recordsets[1] as sql.IRecordSet<Intervalo>).map((i) => ({
      inicio: i.inicio,
      fin: i.fin,
      // DECIMAL columns arrive as numbers; keep null as null
      duracion_min: i.duracion_min === null ? null : Number(i.duracion_min),
      tipo_cierre: i.tipo_cierre,
    }));
    return { fecha_referencia: head.fecha_referencia, intervalos };
  } catch (err) {
    if (isConnectionError(err)) throw new DbUnavailableError(err);
    throw err;
  }
}
