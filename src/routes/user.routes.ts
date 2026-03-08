import { Router } from 'express';
import { authenticate } from '../middleware/authenticate';
import { validate } from '../middleware/validate';
import { updateUserSettingsSchema } from '../lib/schemas';
import { getUserSettings, updateUserSettings } from '../controllers/user.controller';

export const userRouter: Router = Router();

// All user routes require authentication
userRouter.use(authenticate);

userRouter.get('/settings', getUserSettings);
userRouter.patch('/settings', validate(updateUserSettingsSchema), updateUserSettings);
