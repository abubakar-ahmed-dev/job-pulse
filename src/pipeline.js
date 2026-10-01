import fs from "node:fs/promises";
import path from "node:path";
import { config } from "./config.js";
import { runScraperPipeline } from "./scraper/cli.js";
import { triageJob } from "./llm/triageService.js";

/**
 * End-to-End Orchestrator: Links W5 Scraper with W7 LLM Triage Service.
 */
export async function runFullPipeline(options = {}) {
  console.log("\n============================================================");
  console.log("🚀 Running JobPulse Unified End-to-End Pipeline");
  console.log("============================================================");

  // Step 1: Run Polite Scraper (W5)
  console.log("\n[STEP 1/2] Executing Polite Web Ingestion Pipeline...");
  const useFixtures = process.argv.includes("--fixtures") || options.useFixtures;
  const scrapeResult = await runScraperPipeline({
    useFixtures,
    limit: options.limit || 5
  });

  const jobs = scrapeResult.jobs.slice(0, options.limit || 5);
  console.log(`\n[STEP 2/2] Triaging ${jobs.length} jobs through Guarded LLM Intelligence Layer (W7)...`);

  const isStubMode = options.stub !== undefined ? options.stub : (config.llmStub || config.llmApiKey === "stub-mode" || process.argv.includes("--stub") || useFixtures);

  const enrichedJobs = [];
  for (let i = 0; i < jobs.length; i++) {
    const job = jobs[i];
    console.log(` -> Triaging [${i + 1}/${jobs.length}]: ${job.title} (${job.company})`);
    
    const { result, metrics } = await triageJob({
      title: job.title,
      company: job.company,
      description: job.description || "Software engineering role."
    }, { stub: isStubMode });

    enrichedJobs.push({
      ...job,
      triage: result,
      triage_metrics: {
        duration_ms: metrics.durationMs,
        is_stub: metrics.isStub,
        prompt_version: "v1"
      }
    });
  }

  // Save enriched records
  const enrichedPath = path.join(config.outputDir, "jobs-enriched.json");
  await fs.writeFile(enrichedPath, JSON.stringify(enrichedJobs, null, 2), "utf-8");

  console.log("\n============================================================");
  console.log("🎉 Unified Pipeline Finished Successfully!");
  console.log(`📊 Scraped & Validated Jobs: ${jobs.length}`);
  console.log(`🧠 Triaged with LLM Contract: ${enrichedJobs.length}`);
  console.log(`📁 Enriched Output Saved to: ${enrichedPath}`);
  console.log("============================================================\n");

  return enrichedJobs;
}

if (process.argv[1] && process.argv[1].endsWith("pipeline.js")) {
  runFullPipeline().catch((err) => {
    console.error("Pipeline failure:", err);
    process.exit(1);
  });
}
