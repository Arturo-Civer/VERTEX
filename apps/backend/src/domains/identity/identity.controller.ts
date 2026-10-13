import type { Request, Response } from 'express';
import { AuthError, loginUser } from './identity.service';

/** POST /api/identity/login  body: { credential, password } → { token } */
export async function login(req: Request, res: Response) {
  const { credential, password } = (req.body ?? {}) as { credential?: unknown; password?: unknown };

  if (typeof credential !== 'string' || !credential.trim() || typeof password !== 'string' || !password) {
    res.status(400).json({ error: 'Ingresa tu usuario o correo y tu contraseña' });
    return;
  }

  try {
    const token = await loginUser(credential.trim(), password);
    res.json({ token });
  } catch (err) {
    if (err instanceof AuthError) {
      res.status(401).json({ error: 'Credenciales inválidas' });
      return;
    }
    console.error('Error en login:', err instanceof Error ? err.message : err);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
}
