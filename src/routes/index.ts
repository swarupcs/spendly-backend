import { Router } from 'express';
import { authRouter } from './auth.routes';
import { expenseRouter } from './expense.routes';
import { chatRouter } from './chat.routes';
import { userRouter } from './user.routes';
import { budgetRouter } from './budget.routes';
import { recurringRouter } from './recurring.routes';
import { goalRouter } from './goal.routes';
import { currencyRouter } from './currency.routes';

export const apiRouter: Router = Router();

apiRouter.use('/auth', authRouter);
apiRouter.use('/expenses', expenseRouter);
apiRouter.use('/chat', chatRouter);
apiRouter.use('/user', userRouter);
apiRouter.use('/budgets', budgetRouter);
apiRouter.use('/recurring', recurringRouter);
apiRouter.use('/goals', goalRouter);
apiRouter.use('/currency', currencyRouter);
