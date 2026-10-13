import { Router } from 'express';
import { login } from './identity.controller';

export const identityRouter = Router();

identityRouter.post('/login', login);
