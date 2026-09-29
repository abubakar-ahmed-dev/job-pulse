import OpenAI from "openai";
import { config } from "../config.js";

/**
 * Universal OpenAI-Compatible Client.
 * Works seamlessly with OpenRouter (hosted) or Ollama (local) via environment variables.
 * 
 * Production Hardening (W7 Stage 4):
 * - Explicit 30-second timeout (overriding the official 10-minute SDK default).
 * - maxRetries: 0 (disables hidden SDK retry loops so our custom exponential 
 *   backoff policy handles 429/5xx explicitly without burning quota).
 */
export const llmClient = new OpenAI({
  baseURL: config.llmBaseUrl,
  apiKey: config.llmApiKey || "stub-mode",
  timeout: config.llmTimeoutMs,
  maxRetries: 0
});
