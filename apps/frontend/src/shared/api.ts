/** Backend base URL (VITE_API_URL, default the local backend) */
export const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000';

/**
 * Netlify presentations: no backend reachable, so the app works with local
 * demo credentials and simulated data only (see auth.service).
 */
export const DEMO_MODE = import.meta.env.VITE_DEMO_MODE === 'true';
