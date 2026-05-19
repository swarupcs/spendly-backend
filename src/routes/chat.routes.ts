import { Router } from 'express';
import { authenticate } from '../middleware/authenticate';
import { validate } from '../middleware/validate';
import { chatLimiter } from '../middleware/rateLimiter';
import { chatQuerySchema } from '../lib/schemas';
import {
  streamChat,
  getChatHistory,
  deleteChatHistory,
  listThreads,
} from '../controllers/chat.controller';

export const chatRouter: Router = Router();

// All chat routes require a valid Bearer JWT
chatRouter.use(authenticate);

chatRouter.post('/', chatLimiter, validate(chatQuerySchema), streamChat);
chatRouter.get('/threads', listThreads);
chatRouter.get('/history', getChatHistory);
chatRouter.delete('/history', deleteChatHistory);
