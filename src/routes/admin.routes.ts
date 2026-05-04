import { Router } from 'express';
import { authenticate, requireAdmin } from '../middleware/authenticate';
import * as AdminController from '../controllers/admin.controller';

export const adminRouter: Router = Router();

// All routes require authentication and ADMIN role
adminRouter.use(authenticate, requireAdmin);

adminRouter.get('/users', AdminController.getUsers);
adminRouter.get('/users/:id', AdminController.getUserDetails);
adminRouter.get('/settings', AdminController.getGlobalSettings);
adminRouter.post('/settings', AdminController.updateGlobalSettings);
adminRouter.post('/users/:id/settings', AdminController.updateUserSettings);
