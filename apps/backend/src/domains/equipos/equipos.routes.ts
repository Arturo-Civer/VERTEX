import { Router } from 'express';
import { getEquipo } from './equipos.controller';

export const equiposRouter = Router();

equiposRouter.get('/:codigo', getEquipo);
