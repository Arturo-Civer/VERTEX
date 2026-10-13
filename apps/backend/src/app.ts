import cors from 'cors';
import express from 'express';
import { identityRouter } from './domains/identity/identity.routes';

/** Express app: JSON bodies, CORS, health check and the domain routes */
export function createApp() {
  const app = express();

  // Comma-separated list of allowed origins; defaults to the Vite dev server
  const origins = (process.env.CORS_ORIGIN ?? 'http://localhost:5173')
    .split(',')
    .map((o) => o.trim());

  app.use(cors({ origin: origins }));
  app.use(express.json({ limit: '100kb' }));

  app.get('/health', (_req, res) => {
    res.json({ status: 'ok' });
  });

  app.use('/api/identity', identityRouter);

  return app;
}
