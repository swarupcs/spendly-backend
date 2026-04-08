import { prisma } from '../config/db';
import { invokeLlmWithFallback } from '../agents/llm.factory';

// ─── Onboarding state machine ─────────────────────────────────────────────────

export type OnboardingStep =
  | 'WELCOME'
  | 'INCOME'
  | 'TOP_CATEGORIES'
  | 'SET_BUDGETS'
  | 'SET_GOALS'
  | 'RECURRING'
  | 'COMPLETE';

export interface OnboardingState {
  step: OnboardingStep;
  monthlyIncome?: number;
  topCategories?: string[];
  suggestedBudgets?: Array<{ category: string; amount: number }>;
  confirmedBudgets?: Array<{ category: string; amount: number }>;
  goals?: Array<{ name: string; type: string; targetAmount: number }>;
  recurring?: Array<{ title: string; amount: number; frequency: string }>;
}

export interface OnboardingMessage {
  role: 'assistant' | 'user';
  content: string;
}

export interface OnboardingResponse {
  message: string;
  nextStep: OnboardingStep;
  state: OnboardingState;
  actions?: Array<{
    type: 'SET_INCOME' | 'SET_BUDGETS' | 'SET_GOALS' | 'COMPLETE';
    payload: Record<string, unknown>;
  }>;
  isComplete: boolean;
}

// ─── Step prompts ─────────────────────────────────────────────────────────────

const STEP_PROMPTS: Record<OnboardingStep, string> = {
  WELCOME: `You are helping a new user set up Spendly, their personal finance app.
Welcome them warmly and ask for their monthly take-home income (after tax).
Be friendly, keep it to 2-3 sentences. Don't use bullet points.`,

  INCOME: `The user has provided their monthly income.
Extract the income amount in INR (convert if needed: 1 lakh = 100000, 1k = 1000).
Then ask which 3-4 spending categories they spend the most on from: DINING, SHOPPING, TRANSPORT, ENTERTAINMENT, UTILITIES, HEALTH, EDUCATION, OTHER.
Give examples to help them choose. Keep it conversational.`,

  TOP_CATEGORIES: `Based on the user's top spending categories, suggest monthly budget amounts.
Use ~15% of income for DINING, ~12% for SHOPPING, ~10% for TRANSPORT, ~10% for UTILITIES, ~8% for ENTERTAINMENT, ~8% for HEALTH, ~5% for EDUCATION.
Present the suggestions as a friendly summary (not a table) and ask if they want to adjust any amounts or accept all.`,

  SET_BUDGETS: `The user has confirmed or adjusted their budgets.
Now ask if they have any savings goals — like an emergency fund, vacation fund, or a big purchase they're saving for.
Ask for the goal name and target amount. Keep it light and motivating.`,

  SET_GOALS: `The user has shared their savings goals. Acknowledge them encouragingly.
Now ask if they have any recurring monthly expenses — like rent, Netflix, gym membership, or loan EMIs.
These are expenses that happen every month automatically.`,

  RECURRING: `The user has shared their recurring expenses.
Summarize everything set up so far (budgets, goals, recurring) in a brief friendly message.
Then congratulate them and say they're all set to start tracking expenses!`,

  COMPLETE: `The onboarding is complete. Tell the user they can start by saying something like "I spent 200 on lunch" or asking "how am I doing this month?".`,
};

// ─── Process onboarding message ───────────────────────────────────────────────

export async function processOnboardingMessage(
  userId: number,
  userMessage: string,
  currentState: OnboardingState,
  history: OnboardingMessage[],
): Promise<OnboardingResponse> {
  const step = currentState.step;

  // Build extraction prompt based on current step
  const systemPrompt = `You are a friendly onboarding assistant for a personal finance app called Spendly.
${STEP_PROMPTS[step]}

IMPORTANT: Respond ONLY with a valid JSON object (no markdown, no explanation):
{
  "message": "your response to the user",
  "extractedData": {
    "income": number or null,
    "categories": string[] or null,
    "budgets": [{category: string, amount: number}] or null,
    "goals": [{name: string, type: "SAVINGS", targetAmount: number}] or null,
    "recurring": [{title: string, amount: number, frequency: "MONTHLY"}] or null,
    "confirmed": boolean
  },
  "nextStep": "${getNextStep(step)}"
}`;

  const messages = [
    ...history.map((h) => ({
      role: h.role as 'assistant' | 'user',
      content: h.content,
    })),
    { role: 'user' as const, content: userMessage },
  ];

  let parsed: {
    message: string;
    extractedData: {
      income?: number | null;
      categories?: string[] | null;
      budgets?: Array<{ category: string; amount: number }> | null;
      goals?: Array<{
        name: string;
        type: string;
        targetAmount: number;
      }> | null;
      recurring?: Array<{
        title: string;
        amount: number;
        frequency: string;
      }> | null;
      confirmed?: boolean;
    };
    nextStep: OnboardingStep;
  };

  try {
    const response = await invokeLlmWithFallback([
      { role: 'system' as const, content: systemPrompt },
      ...messages,
    ]);
    const content =
      typeof response.content === 'string'
        ? response.content
        : JSON.stringify(response.content);
    const clean = content
      .replace(/```json\s*/g, '')
      .replace(/```\s*/g, '')
      .trim();
    parsed = JSON.parse(clean);
  } catch {
    return {
      message: "I didn't quite catch that. Could you try again?",
      nextStep: step,
      state: currentState,
      isComplete: false,
    };
  }

  // Build next state
  const nextState: OnboardingState = { ...currentState };
  const actions: OnboardingResponse['actions'] = [];

  if (parsed.extractedData.income && !nextState.monthlyIncome) {
    nextState.monthlyIncome = parsed.extractedData.income;
    actions.push({
      type: 'SET_INCOME',
      payload: { monthlyIncome: parsed.extractedData.income },
    });
  }

  if (parsed.extractedData.categories) {
    nextState.topCategories = parsed.extractedData.categories;
  }

  if (parsed.extractedData.budgets) {
    nextState.suggestedBudgets = parsed.extractedData.budgets;
    if (parsed.extractedData.confirmed) {
      nextState.confirmedBudgets = parsed.extractedData.budgets;
      actions.push({
        type: 'SET_BUDGETS',
        payload: { budgets: parsed.extractedData.budgets },
      });
    }
  }

  if (parsed.extractedData.goals) {
    nextState.goals = parsed.extractedData.goals;
    actions.push({
      type: 'SET_GOALS',
      payload: { goals: parsed.extractedData.goals },
    });
  }

  if (parsed.extractedData.recurring) {
    nextState.recurring = parsed.extractedData.recurring;
  }

  const nextStep: OnboardingStep = parsed.nextStep ?? getNextStep(step);
  nextState.step = nextStep;

  const isComplete = nextStep === 'COMPLETE';

  if (isComplete) {
    actions.push({ type: 'COMPLETE', payload: {} });
    // Mark onboarding complete in DB
    await prisma.userSettings.upsert({
      where: { userId },
      create: { userId, onboardingCompleted: true },
      update: { onboardingCompleted: true },
    });
  }

  return {
    message: parsed.message,
    nextStep,
    state: nextState,
    actions,
    isComplete,
  };
}

function getNextStep(current: OnboardingStep): OnboardingStep {
  const flow: OnboardingStep[] = [
    'WELCOME',
    'INCOME',
    'TOP_CATEGORIES',
    'SET_BUDGETS',
    'SET_GOALS',
    'RECURRING',
    'COMPLETE',
  ];
  const idx = flow.indexOf(current);
  return idx >= 0 && idx < flow.length - 1 ? flow[idx + 1] : 'COMPLETE';
}

// ─── Get initial onboarding message ──────────────────────────────────────────

export async function getOnboardingWelcome(): Promise<string> {
  try {
    const response = await invokeLlmWithFallback([
      {
        role: 'system' as const,
        content:
          STEP_PROMPTS.WELCOME +
          '\nRespond ONLY with the welcome message text, no JSON.',
      },
      { role: 'user' as const, content: 'Start onboarding' },
    ]);
    return typeof response.content === 'string'
      ? response.content
      : "Welcome to Spendly! 🎉 I'm here to help you set up your financial tracking. Let's start — what's your monthly take-home income?";
  } catch {
    return "Welcome to Spendly! 🎉 I'm here to help you set up your financial tracking. Let's start — what's your monthly take-home income?";
  }
}

// ─── Apply onboarding actions to DB ──────────────────────────────────────────

export async function applyOnboardingActions(
  userId: number,
  actions: NonNullable<OnboardingResponse['actions']>,
): Promise<void> {
  for (const action of actions) {
    try {
      if (action.type === 'SET_INCOME') {
        const income = action.payload['monthlyIncome'] as number;
        await prisma.userSettings.upsert({
          where: { userId },
          create: { userId },
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          update: { monthlyIncome: income } as any,
        });
      }

      if (action.type === 'SET_BUDGETS') {
        const budgets = action.payload['budgets'] as Array<{
          category: string;
          amount: number;
        }>;
        for (const b of budgets) {
          await prisma.budget.upsert({
            where: {
              userId_category: {
                userId,
                category: b.category as import('../generated/prisma').Category,
              },
            },
            create: {
              userId,
              category: b.category as import('../generated/prisma').Category,
              amount: b.amount,
            },
            update: { amount: b.amount },
          });
        }
      }

      if (action.type === 'SET_GOALS') {
        const goals = action.payload['goals'] as Array<{
          name: string;
          type: string;
          targetAmount: number;
        }>;
        for (const g of goals) {
          await prisma.financialGoal.create({
            data: {
              userId,
              name: g.name,
              type: g.type as import('../generated/prisma').GoalType,
              targetAmount: g.targetAmount,
            },
          });
        }
      }

      if (action.type === 'COMPLETE') {
        await prisma.userSettings.upsert({
          where: { userId },
          create: { userId, onboardingCompleted: true },
          update: { onboardingCompleted: true },
        });
      }
    } catch (err) {
      console.error(`Onboarding action ${action.type} failed:`, err);
    }
  }
}
