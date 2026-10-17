/** Backend base URL (VITE_API_URL, default the local backend) */
export const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000';

/**
 * Netlify presentations: no backend reachable, so the app works with local
 * demo credentials and simulated data only (see auth.service).
 */
export const DEMO_MODE = import.meta.env.VITE_DEMO_MODE === 'true';

/**
 * Failure that may pass by itself: no answer from the backend (network) or
 * 502 / 503 / 504 (no database, or it took too long). useBackend retries
 * these; 400 / 404 / 500 are plain Errors and are never retried.
 */
export class ErrorTemporal extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ErrorTemporal';
  }
}

/** Error for a failed response: ErrorTemporal for 502 / 503 / 504 */
export function errorDeRespuesta(status: number, message: string): Error {
  return status >= 502 && status <= 504 ? new ErrorTemporal(message) : new Error(message);
}
