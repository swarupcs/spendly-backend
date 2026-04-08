import { Router } from 'express';
import { authenticate } from '../middleware/authenticate';
import {
  getWelcome,
  sendOnboardingMessage,
} from '../controllers/onboarding.controller';

export const onboardingRouter: Router = Router();

onboardingRouter.use(authenticate);

// GET the welcome message + initial state
onboardingRouter.get('/welcome', getWelcome);

// POST each conversation turn
onboardingRouter.post('/message', sendOnboardingMessage);
