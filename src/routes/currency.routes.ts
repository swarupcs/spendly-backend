import { Router } from 'express';
import { authenticate } from '../middleware/authenticate';
import { getRates } from '../controllers/currency.controller';

export const currencyRouter: Router = Router();

currencyRouter.use(authenticate);
currencyRouter.get('/rates', getRates);
