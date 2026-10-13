import type { Request, Response } from 'express';
import { DbUnavailableError, findEquipo } from './equipos.service';

/** GET /api/equipos/:codigo → { encontrado, codigo, nombre, area } */
export async function getEquipo(req: Request<{ codigo: string }>, res: Response) {
  const codigo = req.params.codigo.trim().toUpperCase();

  try {
    const equipo = await findEquipo(codigo);
    if (!equipo) {
      res.status(404).json({ encontrado: false, mensaje: 'Equipo no encontrado' });
      return;
    }
    res.json({ encontrado: true, ...equipo });
  } catch (err) {
    if (err instanceof DbUnavailableError) {
      res.status(503).json({ encontrado: false, mensaje: err.message });
      return;
    }
    console.error('Error consultando equipo:', err instanceof Error ? err.message : err);
    res.status(500).json({ encontrado: false, mensaje: 'Error interno del servidor' });
  }
}
