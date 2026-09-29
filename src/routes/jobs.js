import express from "express";
import fs from "node:fs/promises";
import path from "node:path";
import { config } from "../config.js";
import { TriageRequestSchema } from "../schemas/triageSchema.js";
import { triageJob, LLMTimeoutError, LLMValidationError, LLMUnavailableError } from "../llm/triageService.js";

export const jobsRouter = express.Router();

/**
 * Health & Configuration Check Endpoint
 */
jobsRouter.get("/health", (req, res) => {
  res.json({
    status: "ok",
    service: "JobPulse API",
    llm: {
      provider_url: config.llmBaseUrl,
      model: config.llmModel,
      stub_mode: config.llmStub,
      kill_switch_enabled: config.llmEnabled
    }
  });
});

/**
 * Guarded LLM Triage Endpoint (W7 Stage 1, 3, 4)
 * POST /api/v1/jobs/triage
 */
jobsRouter.post("/triage", async (req, res) => {
  // Stage 1: Validate input before calling model. Reject garbage before spending quota.
  const validation = TriageRequestSchema.safeParse(req.body);
  if (!validation.success) {
    return res.status(400).json({
      error: "Bad Request: Invalid input payload",
      details: validation.error.issues.map((issue) => ({
        field: issue.path.join("."),
        message: issue.message
      }))
    });
  }

  try {
    const { result, metrics } = await triageJob(validation.data);
    res.setHeader("X-LLM-Duration-Ms", String(metrics?.duration_ms ?? 0));
    res.setHeader("X-LLM-Stub", metrics?.is_stub ? "true" : "false");
    return res.status(200).json(result);
  } catch (err) {
    if (err instanceof LLMValidationError) {
      return res.status(422).json({
        error: "Unprocessable Entity: Model output could not be validated against schema after repair",
        message: err.message,
        details: err.details
      });
    }

    if (err instanceof LLMTimeoutError) {
      return res.status(504).json({
        error: "Gateway Timeout: LLM provider failed to respond within time limit",
        message: err.message
      });
    }

    if (err instanceof LLMUnavailableError) {
      return res.status(503).json({
        error: "Service Unavailable: Downstream LLM provider is unavailable",
        message: err.message
      });
    }

    // Default internal error (never leak raw stack traces)
    console.error("[SERVER_ERROR]", err);
    return res.status(500).json({
      error: "Internal Server Error",
      message: "An unexpected error occurred during job triage"
    });
  }
});

/**
 * Pipeline Integration: Batch triage scraped records from output/jobs.json
 * POST /api/v1/jobs/batch-triage
 */
jobsRouter.post("/batch-triage", async (req, res) => {
  const limit = parseInt(req.query.limit || "5", 10);
  const jobsPath = path.join(config.outputDir, "jobs.json");

  try {
    const rawData = await fs.readFile(jobsPath, "utf-8");
    const jobs = JSON.parse(rawData.replace(/^\uFEFF/, ""));
    const toProcess = jobs.slice(0, limit);

    const enriched = [];
    for (const job of toProcess) {
      if (!job.description) continue;
      const { result } = await triageJob({
        title: job.title,
        company: job.company,
        description: job.description
      });
      enriched.push({
        ...job,
        triage: result
      });
    }

    const enrichedPath = path.join(config.outputDir, "jobs-enriched.json");
    await fs.writeFile(enrichedPath, JSON.stringify(enriched, null, 2), "utf-8");

    res.json({
      message: `Successfully enriched ${enriched.length} jobs`,
      enriched_count: enriched.length,
      output_file: "output/jobs-enriched.json",
      sample: enriched[0] || null
    });
  } catch (err) {
    res.status(500).json({ error: "Failed to run batch triage", message: err.message });
  }
});
