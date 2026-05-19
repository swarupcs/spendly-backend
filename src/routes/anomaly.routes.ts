import { Router } from 'express';
import { authenticate } from '../middleware/authenticate';
import { getAnomalies, dismissAnomaly } from '../controllers/anomaly.controller';

export const anomalyRouter: Router = Router();

anomalyRouter.use(authenticate);

anomalyRouter.get('/', getAnomalies);
anomalyRouter.patch('/:id/dismiss', dismissAnomaly);
