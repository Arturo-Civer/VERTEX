import type { Request, Response } from 'express';
import {
  DbUnavailableError,
  findBloques,
  findEquipo,
  findMediciones,
  findResumen,
  VARIABLES_TENDENCIA,
} from './equipos.service';
import type { Periodo, VariableTendencia } from './equipos.service';

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

const FECHAS_INVALIDAS =
  'Los parámetros desde y hasta deben ser fechas AAAA-MM-DD válidas, juntas, con desde <= hasta y sin dias';

/** AAAA-MM-DD as 00:00 UTC of that day; undefined when not a real date */
function parseFecha(raw: unknown): Date | undefined {
  if (typeof raw !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(raw)) return undefined;
  const fecha = new Date(`${raw}T00:00:00Z`);
  // Rejects dates like 2026-02-30, which Date would roll over
  return !Number.isNaN(fecha.getTime()) && fecha.toISOString().startsWith(raw) ? fecha : undefined;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Period of the query: ?desde=AAAA-MM-DD&hasta=AAAA-MM-DD (UTC days, both
 * included: up to 24:00 of hasta), or ?dias=N (null: all the data). Sends
 * 400 and returns undefined when invalid; with `diasRequerido`, one of the
 * two forms must be present.
 */
function leerPeriodo(req: Request, res: Response, diasRequerido = false): Periodo | undefined {
  const { desde: rawDesde, hasta: rawHasta, dias: rawDias } = req.query;
  if (rawDesde !== undefined || rawHasta !== undefined) {
    const desde = parseFecha(rawDesde);
    const hasta = parseFecha(rawHasta);
    if (!desde || !hasta || desde > hasta || rawDias !== undefined) {
      res.status(400).json({ mensaje: FECHAS_INVALIDAS });
      return undefined;
    }
    return { desde, hasta: new Date(hasta.getTime() + DAY_MS) };
  }
  const dias = parseDias(rawDias);
  if (dias === undefined || (diasRequerido && dias === null)) {
    res.status(400).json({ mensaje: DIAS_INVALIDOS });
    return undefined;
  }
  return { dias };
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
 * GET /api/equipos/:codigo/bloques?dias=N | ?desde=&hasta= →
 * { fecha_referencia, desde, primer_registro, ultimo_registro, horas, estado_actual, bloques }
 * (dbo.sp_vx_resumen_estados): one call feeds the donut and the events table.
 * Without a period, all the data of the equipment.
 */
export async function getBloques(req: Request<{ codigo: string }>, res: Response) {
  const codigo = req.params.codigo.trim().toUpperCase();
  const periodo = leerPeriodo(req, res);
  if (!periodo) return;
  await responder(res, 'bloques', () => findBloques(codigo, periodo));
}

/**
 * GET /api/equipos/:codigo/resumen?dias=N | ?desde=&hasta= →
 * { fecha_referencia, desde, primer_registro, ultimo_registro,
 *   horas: { ENCENDIDO, APAGADO, EVENTO, MANTENIMIENTO }, estado_actual, ciclos, mantenimientos }
 * (dbo.sp_vx_resumen_estados). A period is required.
 */
export async function getResumen(req: Request<{ codigo: string }>, res: Response) {
  const codigo = req.params.codigo.trim().toUpperCase();
  const periodo = leerPeriodo(req, res, true);
  if (!periodo) return;
  await responder(res, 'resumen', () => findResumen(codigo, periodo));
}

/**
 * GET /api/equipos/:codigo/mediciones?variable=CODIGO&dias=N | &desde=&hasta= →
 * { variable, unidad, fecha_referencia, desde, minutos_punto, umbral,
 *   puntos: [{ inicio, dia, promedio, minimo, maximo, lecturas, marcas }] }.
 * The interval of each point grows with the period; without a period, all
 * the data (dbo.sp_vx_tendencia_variable).
 */
export async function getMediciones(req: Request<{ codigo: string }>, res: Response) {
  const codigo = req.params.codigo.trim().toUpperCase();
  const variable = typeof req.query.variable === 'string' ? req.query.variable.trim().toUpperCase() : '';
  if (!(VARIABLES_TENDENCIA as readonly string[]).includes(variable)) {
    res.status(400).json({ mensaje: `El parámetro variable debe ser uno de: ${VARIABLES_TENDENCIA.join(', ')}` });
    return;
  }
  const periodo = leerPeriodo(req, res);
  if (!periodo) return;
  await responder(res, 'mediciones', () => findMediciones(codigo, variable as VariableTendencia, periodo));
}
