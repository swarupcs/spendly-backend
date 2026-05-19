import { prisma } from '../config/db';
import type { Category } from '../generated/prisma';
import { invokeLlmWithFallback } from '../agents/llm.factory';
import { PromptTemplate } from '@langchain/core/prompts';
import { JsonOutputParser } from '@langchain/core/output_parsers';

export interface SuggestCategoryInput {
  title: string;
  merchant?: string;
}

export interface SuggestCategoryOutput {
  suggestedCategory: Category;
  confidence: 'HIGH' | 'MEDIUM' | 'LOW';
  source: 'RULE' | 'AI' | 'FALLBACK';
}

const CATEGORY_PROMPT = `
You are a financial AI assistant. Your task is to categorize an expense based on its title and merchant.
The available categories are: DINING, SHOPPING, TRANSPORT, ENTERTAINMENT, UTILITIES, HEALTH, EDUCATION, OTHER.

Return ONLY a valid JSON object with exactly two keys:
- "category": the chosen category from the list above.
- "confidence": "HIGH", "MEDIUM", or "LOW".

Expense Details:
Title: {title}
Merchant: {merchant}
`;

export async function suggestCategoryService(
  userId: number,
  input: SuggestCategoryInput,
): Promise<SuggestCategoryOutput> {
  const { title, merchant } = input;

  // 1. Try to find an existing merchant rule for this user
  if (merchant) {
    // @ts-ignore - MerchantRule is defined in schema but types may not be generated yet
    const rule = await prisma.merchantRule.findFirst({
      where: { userId, merchant },
      orderBy: { hitCount: 'desc' },
    });

    if (rule) {
      return {
        suggestedCategory: rule.category as Category,
        confidence: 'HIGH',
        source: 'RULE',
      };
    }
  }

  // 2. Fallback to AI categorization
  try {
    const prompt = PromptTemplate.fromTemplate(CATEGORY_PROMPT);
    const formattedPrompt = await prompt.format({
      title: title || 'Unknown',
      merchant: merchant || 'Unknown',
    });

    // LangChain LLM invoke typically accepts a string or array of messages
    const response = await invokeLlmWithFallback([
      { role: 'user', content: formattedPrompt }
    ] as any, { userId });
    
    // Parse the JSON block from the response
    const rawText = response.content.toString().trim();
    // Sometimes LLMs wrap JSON in markdown block ```json ... ```
    const jsonStr = rawText.replace(/```json\n?|```/g, '');
    const parser = new JsonOutputParser<{ category: string; confidence: string }>();
    const parsed = await parser.parse(jsonStr);

    const validCategories = [
      'DINING',
      'SHOPPING',
      'TRANSPORT',
      'ENTERTAINMENT',
      'UTILITIES',
      'HEALTH',
      'EDUCATION',
      'OTHER',
    ];

    const category = validCategories.includes(parsed.category)
      ? (parsed.category as Category)
      : 'OTHER';
    const confidence = ['HIGH', 'MEDIUM', 'LOW'].includes(parsed.confidence)
      ? (parsed.confidence as 'HIGH' | 'MEDIUM' | 'LOW')
      : 'LOW';

    return {
      suggestedCategory: category,
      confidence,
      source: 'AI',
    };
  } catch (error) {
    console.error('AI Categorization failed:', error);
    return {
      suggestedCategory: 'OTHER',
      confidence: 'LOW',
      source: 'FALLBACK',
    };
  }
}
