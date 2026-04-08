import { Router } from 'express';
import { authenticate } from '../middleware/authenticate';
import {
  parseReceipt,
  parseBulkText,
  importCsv,
  confirmCsvImport,
} from '../controllers/import.controller';

export const importRouter: Router = Router();

// All import routes require authentication
importRouter.use(authenticate);

// Receipt image parsing (supports base64 image)
importRouter.post('/receipt', parseReceipt);

// Bulk text parsing ("spent 200 on food, 500 on uber")
importRouter.post('/bulk-text', parseBulkText);

// CSV bank statement import
importRouter.post('/csv', importCsv);

// Confirm and save CSV-parsed rows
importRouter.post('/csv/confirm', confirmCsvImport);
