import type { Request, Response } from 'express';
import {
  DbUnavailableError,
  findBloques,
  findEquipo,
  findMediciones,
  findResumen,
  VARIABLES_TENDENCIA,
} from './equipos.service';
import type { VariableTendencia } from './equipos.service';

// Upper bound for ?dias (10 years); larger windows are the same as "todo"
const MAX_DIAS = 3650;
const DIAS_INVALIDOS = `El parámetro dias debe ser un entero entre 1 y ${MAX_DIAS}`;

/** ?dias: null when absent, undefined when invalid */
function parseDias(raw: unknown): number | null | undefined {
  if (raw === undefined) return null;
  if (typeof raw !== 'string' || !/^\d+$/.test(raw)) return undefined;
  const dias = Number(raw);
  return dias >= 1 && dias <= MAX_DIAS ? dias : undefined;
}

/** Sends the query result: 404 when the equipment does not exist, 503 / 500 on errors */
async function responder(res: Response, que: string, consulta: () => Promise<unknown>) {
  try {
    const data = await consulta();
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
    console.error(`Error consultando ${que}:`, err instanceof Error ? err.message : err);
    res.status(500).json({ mensaje: 'Error interno del servidor' });
  }
}

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
 * GET /api/equipos/:codigo/bloques?dias=N → { fecha_referencia, desde, bloques }
 * (dbo.sp_vx_resumen_estados). Without `dias`, all the data of the equipment.
 */
export async function getBloques(req: Request<{ codigo: string }>, res: Response) {
  const codigo = req.params.codigo.trim().toUpperCase();
  const dias = parseDias(req.query.dias);
  if (dias === undefined) {
    res.status(400).json({ mensaje: DIAS_INVALIDOS });
    return;
  }
  await responder(res, 'bloques', () => findBloques(codigo, dias));
}

/**
 * GET /api/equipos/:codigo/resumen?dias=N →
 * { fecha_referencia, desde, horas: { ENCENDIDO, APAGADO, EVENTO, MANTENIMIENTO }, estado_actual,
 *   ciclos, mantenimientos } (dbo.sp_vx_resumen_estados). `dias` is required.
 */
export async function getResumen(req: Request<{ codigo: string }>, res: Response) {
  const codigo = req.params.codigo.trim().toUpperCase();
  const dias = parseDias(req.query.dias);
  if (dias === undefined || dias === null) {
    res.status(400).json({ mensaje: DIAS_INVALIDOS });
    return;
  }
  await responder(res, 'resumen', () => findResumen(codigo, dias));
}

/**
 * GET /api/equipos/:codigo/mediciones?variable=CODIGO&dias=N →
 * { variable, unidad, fecha_referencia, puntos: [{ dia, promedio, minimo, maximo, lecturas }] }.
 * Without `dias`, every day with data.
 */
export async function getMediciones(req: Request<{ codigo: string }>, res: Response) {
  const codigo = req.params.codigo.trim().toUpperCase();
  const variable = typeof req.query.variable === 'string' ? req.query.variable.trim().toUpperCase() : '';
  if (!(VARIABLES_TENDENCIA as readonly string[]).includes(variable)) {
    res.status(400).json({ mensaje: `El parámetro variable debe ser uno de: ${VARIABLES_TENDENCIA.join(', ')}` });
    return;
  }
  const dias = parseDias(req.query.dias);
  if (dias === undefined) {
    res.status(400).json({ mensaje: DIAS_INVALIDOS });
    return;
  }
  await responder(res, 'mediciones', () => findMediciones(codigo, variable as VariableTendencia, dias));
}
