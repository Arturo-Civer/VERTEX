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
