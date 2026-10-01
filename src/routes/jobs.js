import express from "express";
import fs from "node:fs/promises";
import path from "node:path";
import { config } from "../config.js";
import { TriageRequestSchema } from "../schemas/triageSchema.js";
import { triageJob, testLlmConnection, LLMTimeoutError, LLMValidationError, LLMUnavailableError } from "../llm/triageService.js";

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
 * Diagnostic Endpoint: Test Live LLM Provider Connection
 * POST /api/v1/jobs/test-llm
 */
jobsRouter.post("/test-llm", async (req, res) => {
  const apiKey = req.headers["x-openrouter-key"] || req.body.apiKey;
  const model = req.headers["x-llm-model"] || req.body.model;
  const baseUrl = req.body.baseUrl;

  const result = await testLlmConnection({ apiKey, model, baseUrl });
  if (result.ok) {
    return res.status(200).json(result);
  } else {
    return res.status(result.status || 400).json(result);
  }
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

  const clientKey = req.headers["x-openrouter-key"] || req.body.apiKey;
  const clientModel = req.headers["x-llm-model"] || req.body.model;
  const forceStub = req.headers["x-force-stub"] === "true" ? true : undefined;

  try {
    const { result, metrics } = await triageJob(validation.data, {
      apiKey: clientKey,
      model: clientModel,
      stub: forceStub
    });
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
        source_site: job.source_site || (job.canonical_url.includes("arbeitnow") ? "Arbeitnow" : "WeWorkRemotely"),
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

/**
 * Helper to load current jobs (enriched preferred, fallback to raw)
 */
async function loadStoredJobs() {
  const enrichedPath = path.join(config.outputDir, "jobs-enriched.json");
  const rawPath = path.join(config.outputDir, "jobs.json");

  try {
    const data = await fs.readFile(enrichedPath, "utf-8");
    const jobs = JSON.parse(data.replace(/^\uFEFF/, ""));
    return jobs.map((j) => ({
      ...j,
      source_site: j.source_site || (j.canonical_url.includes("arbeitnow") ? "Arbeitnow" : "WeWorkRemotely")
    }));
  } catch (e) {
    try {
      const data = await fs.readFile(rawPath, "utf-8");
      const jobs = JSON.parse(data.replace(/^\uFEFF/, ""));
      return jobs.map((j) => ({
        ...j,
        source_site: j.source_site || (j.canonical_url.includes("arbeitnow") ? "Arbeitnow" : "WeWorkRemotely")
      }));
    } catch (err) {
      return [];
    }
  }
}

/**
 * Explorer API: Get scraped & enriched job records
 * GET /api/v1/jobs/list
 */
jobsRouter.get("/list", async (req, res) => {
  const jobs = await loadStoredJobs();
  const sourceStats = {};
  jobs.forEach((j) => {
    const s = j.source_site || "WeWorkRemotely";
    sourceStats[s] = (sourceStats[s] || 0) + 1;
  });

  return res.json({
    jobs,
    total: jobs.length,
    sources_summary: sourceStats
  });
});

/**
 * Observability API: Get the latest crawler run report
 * GET /api/v1/jobs/report
 */
jobsRouter.get("/report", async (req, res) => {
  const reportPath = path.join(config.outputDir, "run-report.json");
  try {
    const data = await fs.readFile(reportPath, "utf-8");
    const report = JSON.parse(data.replace(/^\uFEFF/, ""));
    res.json(report);
  } catch (err) {
    res.status(404).json({ error: "No run report available yet", message: err.message });
  }
});

/**
 * Export Utility API: Export positions in CSV, JSON, or Formatted Markdown
 * GET /api/v1/jobs/export?format=csv|json|md&source=all|WeWorkRemotely|Arbeitnow&domain=...&seniority=...
 */
jobsRouter.get("/export", async (req, res) => {
  const format = (req.query.format || "json").toLowerCase();
  const source = req.query.source || "all";
  const domain = req.query.domain || "all";
  const seniority = req.query.seniority || "all";
  const search = (req.query.search || "").toLowerCase().trim();

  const allJobs = await loadStoredJobs();

  // Apply filters
  const filtered = allJobs.filter((job) => {
    if (source !== "all" && job.source_site !== source) return false;
    if (domain !== "all" && job.triage?.domain !== domain) return false;
    if (seniority !== "all" && job.triage?.seniority !== seniority) return false;
    if (search) {
      const matchTitle = job.title.toLowerCase().includes(search);
      const matchCompany = job.company.toLowerCase().includes(search);
      const matchStack = (job.triage?.tech_stack || []).some((t) => t.toLowerCase().includes(search));
      if (!matchTitle && !matchCompany && !matchStack) return false;
    }
    return true;
  });

  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");

  // 1. CSV Format
  if (format === "csv") {
    const headers = [
      "ID",
      "Title",
      "Company",
      "Source",
      "Location",
      "Is Remote",
      "Job Type",
      "Salary Raw",
      "Min Salary USD",
      "Max Salary USD",
      "Domain",
      "Seniority",
      "Tech Stack",
      "Confidence",
      "Summary",
      "Canonical URL"
    ];

    const escapeCsv = (val) => {
      if (val === null || val === undefined) return '""';
      const str = String(val).replace(/"/g, '""').replace(/\r?\n/g, " ");
      return `"${str}"`;
    };

    const rows = filtered.map((j) => [
      escapeCsv(j.id),
      escapeCsv(j.title),
      escapeCsv(j.company),
      escapeCsv(j.source_site || "WeWorkRemotely"),
      escapeCsv(j.location),
      escapeCsv(j.is_remote ? "Yes" : "No"),
      escapeCsv(j.job_type),
      escapeCsv(j.salary_raw || ""),
      escapeCsv(j.salary_min_usd || ""),
      escapeCsv(j.salary_max_usd || ""),
      escapeCsv(j.triage?.domain || ""),
      escapeCsv(j.triage?.seniority || ""),
      escapeCsv((j.triage?.tech_stack || []).join("; ")),
      escapeCsv(j.triage?.confidence ? `${Math.round(j.triage.confidence * 100)}%` : ""),
      escapeCsv(j.triage?.one_sentence_summary || ""),
      escapeCsv(j.canonical_url)
    ].join(","));

    const csvContent = [headers.join(","), ...rows].join("\n");
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="jobpulse-export-${timestamp}.csv"`);
    return res.send(csvContent);
  }

  // 2. Markdown Format
  if (format === "md" || format === "markdown") {
    let md = `# ⚡ JobPulse Market Intelligence Export\n\n`;
    md += `**Exported At**: ${new Date().toISOString()}  \n`;
    md += `**Total Positions**: ${filtered.length}  \n`;
    md += `**Filters Applied**: Source=\`${source}\`, Domain=\`${domain}\`, Seniority=\`${seniority}\`\n\n`;

    md += `## Summary Table\n\n`;
    md += `| Role Title | Company | Source | Seniority | Domain | Remote | Link |\n`;
    md += `| :--- | :--- | :--- | :--- | :--- | :--- | :--- |\n`;

    filtered.forEach((j) => {
      const s = j.triage?.seniority || "-";
      const d = j.triage?.domain || "-";
      const rem = j.is_remote ? "Remote" : "On-site";
      md += `| ${j.title.replace(/\|/g, "/")} | ${j.company.replace(/\|/g, "/")} | ${j.source_site || "WeWorkRemotely"} | ${s} | ${d} | ${rem} | [View Listing](${j.canonical_url}) |\n`;
    });

    md += `\n## Detailed Triage Dossiers\n\n`;
    filtered.forEach((j, idx) => {
      md += `### ${idx + 1}. ${j.title} — ${j.company}\n\n`;
      md += `- **Source**: ${j.source_site || "WeWorkRemotely"}\n`;
      md += `- **Location**: ${j.location}\n`;
      md += `- **Job Type**: ${j.job_type}\n`;
      if (j.salary_raw) md += `- **Salary**: ${j.salary_raw}\n`;
      md += `- **Direct URL**: ${j.canonical_url}\n`;

      if (j.triage) {
        md += `\n> **AI Triage Summary**: ${j.triage.one_sentence_summary}\n> \n`;
        md += `> - **Domain**: \`${j.triage.domain}\` | **Seniority**: \`${j.triage.seniority}\` | **Confidence**: ${Math.round(j.triage.confidence * 100)}%\n`;
        if (j.triage.tech_stack?.length) {
          md += `> - **Tech Stack**: ${j.triage.tech_stack.map((t) => `\`${t}\``).join(", ")}\n`;
        }
      }
      md += `\n---\n\n`;
    });

    res.setHeader("Content-Type", "text/markdown; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="jobpulse-export-${timestamp}.md"`);
    return res.send(md);
  }

  // 3. JSON Format (Default)
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  if (req.query.download === "1" || req.query.download === "true") {
    res.setHeader("Content-Disposition", `attachment; filename="jobpulse-export-${timestamp}.json"`);
  }
  return res.json({
    exported_at: new Date().toISOString(),
    total_records: filtered.length,
    filters_applied: { source, domain, seniority, search },
    jobs: filtered
  });
});
