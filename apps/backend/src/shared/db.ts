import sql from 'mssql';

/** Waits between connection attempts: 2, 4, 8, 16, 32 s, then 60 s each */
const esperaSegundos = (intento: number) => Math.min(2 ** intento, 60);

const dormir = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Opens the global pool (services use `new sql.Request()` on it), retrying
 * until SQL Server accepts the connection: the backend stays up meanwhile
 * and /health reports "sin conexión". A failed sql.connect leaves no global
 * pool behind, so every attempt starts clean.
 */
export async function conectarConReintentos(config: sql.config): Promise<void> {
  for (let intento = 1; ; intento++) {
    try {
      await sql.connect(config);
      console.log(`Conectado a SQL Server: ${config.server} / ${config.database} (intento ${intento})`);
      return;
    } catch (err) {
      const espera = esperaSegundos(intento);
      const motivo = err instanceof Error ? err.message : String(err);
      console.warn(`Intento ${intento}: no se pudo conectar a SQL Server (${motivo}). Nuevo intento en ${espera} s...`);
      await dormir(espera * 1000);
    }
  }
}

export type EstadoBase = 'conectada' | 'sin conexión';

/**
 * Real state of the database: SELECT 1 on the pool, answered within
 * `timeoutMs` (a slow SQL Server counts as no connection).
 */
export async function estadoBase(timeoutMs = 3000): Promise<EstadoBase> {
  let timer: NodeJS.Timeout | undefined;
  try {
    const request = new sql.Request();
    const limite = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        request.cancel();
        reject(new Error('timeout'));
      }, timeoutMs);
    });
    await Promise.race([request.query('SELECT 1 AS ok'), limite]);
    return 'conectada';
  } catch {
    return 'sin conexión';
  } finally {
    clearTimeout(timer);
  }
}
