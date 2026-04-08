import { Router } from 'express';
import { authenticate } from '../middleware/authenticate';
import {
  getAnomalies,
  getForecast,
  getComparison,
  getBudgetRecommendations,
  getSpendingPatterns,
  getHealthScore,
  getWeeklySummary,
} from '../controllers/insights.controller';

export const insightsRouter: Router = Router();

// All insights routes require authentication
insightsRouter.use(authenticate);

insightsRouter.get('/anomalies', getAnomalies);
insightsRouter.get('/forecast', getForecast);
insightsRouter.post('/compare', getComparison);
insightsRouter.get('/budget-recommendations', getBudgetRecommendations);
insightsRouter.get('/patterns', getSpendingPatterns);
insightsRouter.get('/health-score', getHealthScore);
insightsRouter.get('/weekly-summary', getWeeklySummary);
