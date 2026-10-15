import sql from 'mssql';
import { createApp } from './app';

const PORT = 3000;

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Falta la variable de entorno ${name} (ver apps/backend/.env.example)`);
  }
  return value;
}

async function main() {
  // Fail fast: the login cannot sign tokens without it
  requireEnv('JWT_SECRET');

  // Global pool: services use `new sql.Request()` on it
  await sql.connect({
    server: requireEnv('DB_SERVER'),
    port: Number(process.env.DB_PORT ?? 1433),
    user: requireEnv('DB_USER'),
    password: requireEnv('DB_PASSWORD'),
    database: requireEnv('DB_NAME'),
    // Default 15 s. sp_vx_resumen_estados over all the data takes ~2 s, but
    // the first call after SQL Server restarts (empty cache) can take ~10 s
    requestTimeout: 30_000,
    options: {
      encrypt: true,
      // Local SQL Server uses a self-signed certificate; set to "false"
      // against a server with a trusted certificate
      trustServerCertificate: process.env.DB_TRUST_SERVER_CERTIFICATE !== 'false',
    },
  });
  console.log(`Conectado a SQL Server: ${process.env.DB_SERVER} / ${process.env.DB_NAME}`);

  createApp().listen(PORT, () => {
    console.log(`VERTEX backend escuchando en http://localhost:${PORT}`);
  });
}

main().catch((err: unknown) => {
  console.error('No se pudo iniciar el servidor:', err instanceof Error ? err.message : err);
  process.exit(1);
});
