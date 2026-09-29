import fs from "node:fs/promises";
import path from "node:path";
import { config } from "../config.js";

/**
 * Structured Cost & Latency Logger (W7 Stage 4).
 * Emits JSON-lines to stdout and optionally logs/llm-calls.jsonl.
 */
export async function logCallMetrics(metrics) {
  const logEntry = {
    timestamp: new Date().toISOString(),
    prompt_version: metrics.promptVersion || "v1",
    model: metrics.model || config.llmModel,
    input_tokens: metrics.inputTokens ?? 0,
    output_tokens: metrics.outputTokens ?? 0,
    total_tokens: (metrics.inputTokens ?? 0) + (metrics.outputTokens ?? 0),
    duration_ms: metrics.durationMs,
    needed_repair: Boolean(metrics.neededRepair),
    is_stub: Boolean(metrics.isStub)
  };

  // 12-Factor App principle: write structured JSON log to stdout
  console.log(`[LLM_METRICS] ${JSON.stringify(logEntry)}`);

  // Also persist to logs directory for auditing
  try {
    await fs.mkdir(config.logsDir, { recursive: true });
    const logFilePath = path.join(config.logsDir, "llm-calls.jsonl");
    await fs.appendFile(logFilePath, JSON.stringify(logEntry) + "\n", "utf-8");
  } catch (err) {
    // Non-fatal logging error
  }

  return logEntry;
}
