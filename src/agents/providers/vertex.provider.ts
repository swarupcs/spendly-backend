import { ChatVertexAI } from '@langchain/google-vertexai';
import { env } from '../../config/env';
import type { ToolCapableLlm } from '../llm.factory';

/**
 * GCP Vertex AI provider.
 *
 * Compatible with: @langchain/google-vertexai@0.1.8 + @langchain/core@0.3.x
 *
 * Supported models (set via VERTEX_MODEL):
 *   gemini-2.0-flash-001
 *   gemini-1.5-pro-002
 *   gemini-1.5-flash-002
 *   gemini-1.0-pro
 *
 * Required .env variables:
 *   LLM_PROVIDER=vertex
 *   VERTEX_PROJECT=your-gcp-project-id
 *   VERTEX_LOCATION=us-central1          (optional, default: us-central1)
 *   VERTEX_MODEL=gemini-2.0-flash-001    (optional, default: gemini-2.0-flash-001)
 *
 * Authentication — choose one:
 *   A) Application Default Credentials (recommended):
 *        Local dev  → gcloud auth application-default login
 *        Cloud Run / GKE → picked up from the attached service account automatically
 *   B) Service account key file:
 *        GOOGLE_APPLICATION_CREDENTIALS=/absolute/path/to/key.json
 *
 * Install (use this exact version to match your @langchain/core@0.3.x):
 *   pnpm add @langchain/google-vertexai@0.1.8
 *   # or: npm install @langchain/google-vertexai@0.1.8
 */
export function createVertexLlm(): ToolCapableLlm {
  if (!env.VERTEX_PROJECT) {
    throw new Error(
      'VERTEX_PROJECT is not set. ' +
        'Add your GCP project ID via VERTEX_PROJECT in .env.',
    );
  }

  return new ChatVertexAI({
    model: env.VERTEX_MODEL,
    // `location` is a direct field on GoogleConnectionParams
    location: env.VERTEX_LOCATION,
    // `project` is NOT a top-level field — pass it inside authOptions.projectId
    // (maps to GoogleAuthOptions from google-auth-library)
    authOptions: {
      projectId: env.VERTEX_PROJECT,
      // If GOOGLE_APPLICATION_CREDENTIALS env var is set, google-auth-library
      // picks it up automatically — no need to reference it here.
    },
    temperature: 0.2,
    maxRetries: 2,
  }) as unknown as ToolCapableLlm;
}
