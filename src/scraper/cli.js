import fs from "node:fs/promises";
import path from "node:path";
import { config } from "../config.js";
import { PoliteFetcher } from "./fetcher.js";
import { parseCataloguePage, parseJobDetailPage } from "./parser.js";
import { parseWwrCataloguePage, parseWwrJobDetailPage } from "./parsers/wwrParser.js";
import { parseArbeitnowCataloguePage, parseArbeitnowJobDetailPage } from "./parsers/arbeitnowParser.js";
import { normalizeJob } from "./normalizer.js";
import { writeRunReport } from "./reporter.js";

export const TARGET_CONFIGS = {
  wwr: {
    key: "wwr",
    name: "WeWorkRemotely",
    url: "https://weworkremotely.com/categories/remote-full-stack-programming-jobs",
    catalogueFixture: "catalogue-page-1.html",
    detailFixtures: ["job-detail-standard.html", "job-detail-missing-desc.html"],
    parseCatalogue: parseWwrCataloguePage,
    parseDetail: parseWwrJobDetailPage
  },
  arbeitnow: {
    key: "arbeitnow",
    name: "Arbeitnow",
    url: "https://www.arbeitnow.com/jobs/junior",
    catalogueFixture: "arbeitnow-catalogue.html",
    detailFixtures: ["arbeitnow-detail.html"],
    parseCatalogue: parseArbeitnowCataloguePage,
    parseDetail: parseArbeitnowJobDetailPage
  }
};

const DEFAULT_TARGET_URL = TARGET_CONFIGS.wwr.url;
const MAX_PAGES_PER_TARGET = 2;

/**
 * Main Scraper Pipeline Orchestrator with Multi-Board Aggregation.
 */
export async function runScraperPipeline(options = {}) {
  const startTime = Date.now();
  const startedAt = new Date().toISOString();

  // Determine active targets
  const argTarget = process.argv.find((a) => a.startsWith("--target="))?.split("=")[1]?.toLowerCase();
  const selectedTargetKey = options.target || argTarget || "all";

  let activeTargets = [];
  if (selectedTargetKey === "wwr") {
    activeTargets = [TARGET_CONFIGS.wwr];
  } else if (selectedTargetKey === "arbeitnow") {
    activeTargets = [TARGET_CONFIGS.arbeitnow];
  } else {
    activeTargets = [TARGET_CONFIGS.wwr, TARGET_CONFIGS.arbeitnow];
  }

  console.log("============================================================");
  console.log("⚡ Starting JobPulse Multi-Board Polite Scraper Pipeline");
  console.log(`🎯 Targets (${activeTargets.length}): ${activeTargets.map((t) => t.name).join(", ")}`);
  console.log(`🤖 User-Agent: ${config.scraperUserAgent}`);
  console.log(`⏱️ Timeout: ${config.scraperTimeoutMs}ms | Per-Host Rate Delay: ${config.scraperRequestDelayMs}ms`);
  console.log("============================================================");

  const fetcher = new PoliteFetcher();
  await fs.mkdir(config.outputDir, { recursive: true });

  const isFixtureMode = process.env.USE_FIXTURES === "1" || options.useFixtures || process.argv.includes("--fixtures");
  const isTestFailure = options.testFailure || process.env.TEST_FAILURE === "1" || process.argv.includes("--test-failure");

  let totalPagesFetched = 0;
  // Discovered items: array of { url, targetConfig }
  const discoveredJobs = [];
  const sourceStats = {};

  for (const target of activeTargets) {
    sourceStats[target.name] = { fetched: 0, valid: 0 };
    console.log(`\n🌐 [Source: ${target.name}] Ingesting from ${target.url}`);

    if (isFixtureMode) {
      console.log(`   📂 Loading fixture: ${target.catalogueFixture}`);
      try {
        const fixtureHtml = await fs.readFile(path.join(config.fixturesDir, target.catalogueFixture), "utf-8");
        const { jobUrls } = target.parseCatalogue(fixtureHtml, target.url);
        totalPagesFetched++;
        console.log(`   Found ${jobUrls.length} jobs in fixture`);
        jobUrls.forEach((url) => discoveredJobs.push({ url, target }));
      } catch (err) {
        console.warn(`   ⚠️ Could not load fixture ${target.catalogueFixture}: ${err.message}`);
      }
    } else {
      let currentUrl = target.url;
      const pagesToVisit = options.maxPages || MAX_PAGES_PER_TARGET;

      for (let p = 1; p <= pagesToVisit && currentUrl; p++) {
        console.log(`   🔍 Fetching catalogue page ${p}/${pagesToVisit}: ${currentUrl}`);
        try {
          const res = await fetcher.fetch(currentUrl);
          totalPagesFetched++;
          const { jobUrls, nextPageUrl } = target.parseCatalogue(res.html, currentUrl);
          console.log(`      Discovered ${jobUrls.length} listings on page ${p}`);
          jobUrls.forEach((url) => discoveredJobs.push({ url, target }));

          if (!nextPageUrl || nextPageUrl === currentUrl) {
            if (target.key === "wwr") {
              const nextUrlObj = new URL(target.url);
              nextUrlObj.searchParams.set("page", (p + 1).toString());
              currentUrl = nextUrlObj.href;
            } else {
              break;
            }
          } else {
            currentUrl = nextPageUrl;
          }
        } catch (err) {
          console.error(`   ⚠️ Failed to fetch ${currentUrl}: ${err.message}`);
          break;
        }
      }
    }
  }

  // Inject synthetic broken URL in test failure mode (Stage 5 failure test)
  if (isTestFailure) {
    console.log("🧪 Injecting 1 synthetic broken URL to prove failure tolerance (Stage 5)...");
    discoveredJobs.push({
      url: "https://weworkremotely.com/remote-jobs/fake-nonexistent-job-404-test",
      target: TARGET_CONFIGS.wwr
    });
  }

  console.log(`\n📦 Discovered total ${discoveredJobs.length} raw job candidates across all sources.`);

  // -------------------------------------------------------------
  // Stage 3, 4 & 5: Extract Details, Normalize, Validate & Report
  // -------------------------------------------------------------
  const validJobs = new Map(); // Canonical URL -> Job (Ensures Idempotency)
  const invalidJobs = [];
  const failedUrls = [];

  // If output/jobs.json already exists, load existing to preserve idempotency
  const jobsOutputPath = path.join(config.outputDir, "jobs.json");
  try {
    const rawContent = await fs.readFile(jobsOutputPath, "utf-8");
    const existing = JSON.parse(rawContent.replace(/^\uFEFF/, ""));
    if (Array.isArray(existing)) {
      existing.forEach((job) => {
        validJobs.set(job.canonical_url, {
          ...job,
          source_site: job.source_site || "WeWorkRemotely"
        });
      });
    }
  } catch (err) {
    // Fresh run
  }

  // Deduplicate discovered URLs by canonical string
  const seenUrls = new Set();
  const uniqueJobsToProcess = [];
  for (const item of discoveredJobs) {
    if (!seenUrls.has(item.url)) {
      seenUrls.add(item.url);
      uniqueJobsToProcess.push(item);
    }
  }

  // Limit processing count
  const targetJobLimit = options.limit || 60;
  const targetJobs = uniqueJobsToProcess.slice(0, targetJobLimit);

  for (let idx = 0; idx < targetJobs.length; idx++) {
    const { url: jobUrl, target } = targetJobs[idx];
    console.log(`[${idx + 1}/${targetJobs.length}] [${target.name}] ${jobUrl}`);

    try {
      if (jobUrl.includes("fake") || jobUrl.includes("404")) {
        throw new Error(`HTTP 404 Not Found: Simulated dead page for ${jobUrl}`);
      }

      let htmlContent = "";
      if (isFixtureMode) {
        let fixtureFile = target.detailFixtures[0];
        if (target.key === "wwr" && idx === 1) {
          fixtureFile = target.detailFixtures[1] || target.detailFixtures[0];
        }
        htmlContent = await fs.readFile(path.join(config.fixturesDir, fixtureFile), "utf-8");
      } else {
        const res = await fetcher.fetch(jobUrl);
        htmlContent = res.html;
      }

      // Stage 3: Extract raw record
      const rawRecord = target.parseDetail(htmlContent, jobUrl, target.url);
      sourceStats[target.name].fetched++;

      // Stage 4: Normalize & Validate with Zod
      const normalizedRecord = normalizeJob(rawRecord);
      validJobs.set(normalizedRecord.canonical_url, normalizedRecord);
      sourceStats[target.name].valid++;
    } catch (err) {
      console.warn(`   ⚠️ Handled failure for ${jobUrl}: ${err.message}`);
      failedUrls.push(jobUrl);
      invalidJobs.push({
        url: jobUrl,
        source: target.name,
        error: err.message,
        timestamp: new Date().toISOString()
      });
    }
  }

  // Write good records to output/jobs.json
  const goodRecords = Array.from(validJobs.values());
  await fs.writeFile(jobsOutputPath, JSON.stringify(goodRecords, null, 2), "utf-8");

  // Write bad records to output/errors.json
  if (invalidJobs.length > 0) {
    const errorsOutputPath = path.join(config.outputDir, "errors.json");
    await fs.writeFile(errorsOutputPath, JSON.stringify(invalidJobs, null, 2), "utf-8");
  }

  // Stage 5: Write output/run-report.json
  const completedAt = new Date().toISOString();
  const durationMs = Date.now() - startTime;
  const primaryTargetLabel = activeTargets.map((t) => t.name).join(" + ");

  const report = await writeRunReport({
    target: primaryTargetLabel,
    started_at: startedAt,
    completed_at: completedAt,
    duration_ms: durationMs,
    pages_fetched: totalPagesFetched,
    cache_hits: fetcher.cacheHits,
    valid_records: goodRecords.length,
    invalid_records: invalidJobs.length,
    failed_pages: failedUrls.length,
    failed_urls: failedUrls,
    sources: sourceStats
  });

  console.log("\n============================================================");
  console.log("🏁 Federated Scraper Run Complete!");
  console.log(`⏱️ Duration: ${durationMs}ms`);
  console.log(`✅ Valid Records Stored: ${goodRecords.length} (Saved to output/jobs.json)`);
  console.log(`💾 Cache Hits: ${fetcher.cacheHits} | Live Fetches: ${fetcher.liveFetches}`);
  console.log(`📊 Source Breakdown: ${JSON.stringify(sourceStats)}`);
  console.log(`❌ Failed Pages: ${failedUrls.length} (Dead pages isolated without crash)`);
  console.log("📄 Run report generated at output/run-report.json");
  console.log("============================================================\n");

  return { report, jobs: goodRecords };
}

// Execute directly if run as CLI
if (process.argv[1] && process.argv[1].endsWith("cli.js")) {
  runScraperPipeline().catch((err) => {
    console.error("Fatal pipeline error:", err);
    process.exit(1);
  });
}
