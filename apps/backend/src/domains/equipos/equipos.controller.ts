import type { Request, Response } from 'express';
import { DbUnavailableError, findEquipo, findIntervalos } from './equipos.service';

// Upper bound for ?dias (10 years); larger windows are the same as "todo"
const MAX_DIAS = 3650;

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

/**
 * GET /api/equipos/:codigo/intervalos?dias=N → { fecha_referencia, intervalos }.
 * Without `dias`, every interval of the equipment.
 */
export async function getIntervalos(req: Request<{ codigo: string }>, res: Response) {
  const codigo = req.params.codigo.trim().toUpperCase();

  const rawDias = req.query.dias;
  const dias = rawDias === undefined ? null : Number(rawDias);
  if (dias !== null && (typeof rawDias !== 'string' || !/^\d+$/.test(rawDias) || dias < 1 || dias > MAX_DIAS)) {
    res.status(400).json({ mensaje: `El parámetro dias debe ser un entero entre 1 y ${MAX_DIAS}` });
    return;
  }

  try {
    const data = await findIntervalos(codigo, dias);
    if (!data) {
      res.status(404).json({ mensaje: 'Equipo no encontrado' });
      return;
    }
    res.json(data);
  } catch (err) {
    if (err instanceof DbUnavailableError) {
      res.status(503).json({ mensaje: err.message });
      return;
    }
    console.error('Error consultando intervalos:', err instanceof Error ? err.message : err);
    res.status(500).json({ mensaje: 'Error interno del servidor' });
  }
}
