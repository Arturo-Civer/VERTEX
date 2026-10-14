import { Router } from 'express';
import { getBloques, getEquipo, getMediciones, getResumen } from './equipos.controller';

export const equiposRouter = Router();

equiposRouter.get('/:codigo', getEquipo);
equiposRouter.get('/:codigo/bloques', getBloques);
equiposRouter.get('/:codigo/resumen', getResumen);
equiposRouter.get('/:codigo/mediciones', getMediciones);
