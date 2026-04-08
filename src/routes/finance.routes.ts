import { Router } from 'express';
import { authenticate } from '../middleware/authenticate';
import {
  getNetWorth,
  updateNetWorthController,
  getZeroBasedBudget,
  applyZeroBasedBudgetController,
  getTaxSummaryController,
  getTopMerchantsController,
  getToolStats,
  getToolLog,
} from '../controllers/finance.controller';

export const financeRouter: Router = Router();

financeRouter.use(authenticate);

// Net worth
financeRouter.get('/net-worth', getNetWorth);
financeRouter.patch('/net-worth', updateNetWorthController);

// Zero-based budgeting
financeRouter.get('/zero-based-budget', getZeroBasedBudget);
financeRouter.post('/zero-based-budget/apply', applyZeroBasedBudgetController);

// Tax summary (Indian FY)
financeRouter.get('/tax-summary', getTaxSummaryController);

// Merchant analytics
financeRouter.get('/merchants', getTopMerchantsController);

// AI tool audit log
financeRouter.get('/tool-stats', getToolStats);
financeRouter.get('/tool-log', getToolLog);
