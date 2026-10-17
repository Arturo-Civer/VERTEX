import { API_URL, DEMO_MODE } from '../../shared/api';

/**
 * sessionStorage key holding the session token (backend JWT or demo token).
 * sessionStorage belongs to the browser tab: a reload (F5) keeps the session,
 * but every new tab or window (e.g. the "Iniciar VERTEX" shortcut) asks for
 * the login again.
 */
export const TOKEN_KEY = 'vx_token';

/** Saves the token for this tab (blocked storage: the session lasts until a reload) */
function guardarToken(token: string) {
  try {
    sessionStorage.setItem(TOKEN_KEY, token);
  } catch {
    // storage blocked (private mode)
  }
}

/** Removes every vx_ key of a storage (blocked storage: nothing was saved) */
function borrarClaves(almacen: () => Storage) {
  try {
    const storage = almacen();
    for (const key of Object.keys(storage)) {
      if (key.startsWith('vx_')) storage.removeItem(key);
    }
  } catch {
    // storage blocked
  }
}

/*
 * Demo mode (Netlify presentations): no backend, the credentials come from
 * VITE_DEMO_EMAIL / VITE_DEMO_PASSWORD set in the hosting environment.
 * Vite inlines VITE_* values into the public bundle, so the demo password
 * must be a throwaway one, never a real account's.
 */
const DEMO_SESSION_SECONDS = 8 * 60 * 60;

const GENERIC_ERROR = 'No se pudo iniciar sesión. Intenta de nuevo más tarde.';
const INVALID_CREDENTIALS = 'Credenciales inválidas';

function base64Url(value: object): string {
  return btoa(JSON.stringify(value)).replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
}

/**
 * JWT-shaped demo session token: { demo: true, exp: now + 8h }. It is not
 * really signed (a signing key in the browser would be public anyway), it
 * only lets the app track the session and its expiry; the backend would
 * reject it.
 */
function demoLogin(credential: string, password: string): { token: string } {
  const email = import.meta.env.VITE_DEMO_EMAIL ?? '';
  const demoPassword = import.meta.env.VITE_DEMO_PASSWORD ?? '';
  // Unset demo credentials never match (an empty form must not get in)
  const valid =
    email !== '' &&
    demoPassword !== '' &&
    credential.toLowerCase() === email.trim().toLowerCase() &&
    password === demoPassword;
  if (!valid) throw new Error(INVALID_CREDENTIALS);

  const exp = Math.floor(Date.now() / 1000) + DEMO_SESSION_SECONDS;
  const token = `${base64Url({ alg: 'none', typ: 'JWT' })}.${base64Url({ demo: true, exp })}.demo`;
  guardarToken(token);
  return { token };
}

/**
 * Signs in with an email or username and stores the token under TOKEN_KEY.
 * Demo mode checks the VITE_DEMO_* credentials locally; otherwise it calls
 * POST /api/identity/login. Rejects with the server's message on 400/401
 * and with a generic message otherwise.
 */
export async function login(credential: string, password: string): Promise<{ token: string }> {
  if (DEMO_MODE) return demoLogin(credential, password);

  let res: Response;
  try {
    res = await fetch(`${API_URL}/api/identity/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ credential, password }),
    });
  } catch {
    // Backend down or unreachable
    throw new Error(GENERIC_ERROR);
  }

  const body = (await res.json().catch(() => null)) as { token?: string; error?: string } | null;

  if (res.ok && body?.token) {
    guardarToken(body.token);
    return { token: body.token };
  }

  if ((res.status === 400 || res.status === 401) && body?.error) {
    throw new Error(body.error);
  }
  throw new Error(GENERIC_ERROR);
}

/**
 * Stored token if it has not expired yet (expired or malformed tokens are
 * removed). Only reads the exp claim: the backend still verifies the token.
 */
export function getStoredToken(): string | null {
  // Earlier versions kept the token and the tree route in localStorage, which
  // outlived the tab: nothing is kept there any more
  borrarClaves(() => localStorage);
  let token: string | null = null;
  try {
    token = sessionStorage.getItem(TOKEN_KEY);
  } catch {
    // storage blocked: no saved session
  }
  if (!token) return null;
  try {
    const payload = JSON.parse(atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))) as {
      exp?: number;
    };
    if (payload.exp && payload.exp * 1000 > Date.now()) return token;
  } catch {
    // fall through: unreadable token
  }
  // The session ended: its dashboard state goes too
  logout();
  return null;
}

/**
 * Ends the session: removes the token and every dashboard state saved in the
 * browser (all vx_ keys, e.g. vx_ruta), so the next login starts from scratch.
 */
export function logout() {
  borrarClaves(() => sessionStorage);
  borrarClaves(() => localStorage);
}
