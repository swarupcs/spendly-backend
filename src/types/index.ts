import type { Request } from 'express';
import type { Category, Role } from '../generated/prisma';

// ─── Auth ─────────────────────────────────────────────────────────────────────

export interface JwtPayload {
  sub: number; // userId
  email: string;
  role: Role;
  iat?: number;
  exp?: number;
}

export interface AuthenticatedRequest extends Request {
  user: JwtPayload;
}

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
}

export interface PublicUser {
  id: number;
  name: string;
  email: string;
  role: Role;
  createdAt: Date;
  emailVerified?: boolean;
}

// ─── SSE Streaming ────────────────────────────────────────────────────────────

export type StreamMessage =
  | { type: 'ai'; payload: { text: string } }
  | {
      type: 'toolCall:start';
      payload: { name: string; args: Record<string, unknown> };
    }
  | { type: 'tool'; payload: { name: string; result: Record<string, unknown> } }
  | { type: 'error'; payload: { text: string } };

// ─── API Responses ────────────────────────────────────────────────────────────

export interface ApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
  message?: string;
}

export interface PaginationMeta {
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

export interface PaginatedResponse<T> extends ApiResponse<T[]> {
  pagination: PaginationMeta;
}

// ─── Expenses ─────────────────────────────────────────────────────────────────

export interface ExpenseStats {
  total: number;
  count: number;
  average: number;
  max: number;
  min: number;
  byCategory: Array<{
    category: Category;
    amount: number;
    count: number;
  }>;
}

// ─── Chat ─────────────────────────────────────────────────────────────────────

export interface ChatHistoryEntry {
  id: number;
  threadId: string;
  role: string;
  content: string;
  createdAt: Date;
}
