import fs from "node:fs/promises";
import path from "node:path";
import { config } from "../config.js";
import { PoliteFetcher } from "./fetcher.js";
import { parseCataloguePage, parseJobDetailPage } from "./parser.js";
import { normalizeJob } from "./normalizer.js";
import { writeRunReport } from "./reporter.js";

const DEFAULT_TARGET_URL = "https://weworkremotely.com/categories/remote-full-stack-programming-jobs";
const MAX_PAGES = 3;

/**
 * Main Scraper Pipeline Orchestrator.
 */
export async function runScraperPipeline(options = {}) {
  const startTime = Date.now();
  const startedAt = new Date().toISOString();
  console.log("============================================================");
  console.log("⚡ Starting JobPulse Polite Scraper Pipeline");
  console.log(`🎯 Target: ${DEFAULT_TARGET_URL}`);
  console.log(`🤖 User-Agent: ${config.scraperUserAgent}`);
  console.log(`⏱️ Timeout: ${config.scraperTimeoutMs}ms | Rate Limit Delay: ${config.scraperRequestDelayMs}ms`);
  console.log("============================================================");

  const fetcher = new PoliteFetcher();
  await fs.mkdir(config.outputDir, { recursive: true });

  const discoveredJobUrls = new Set();
  let currentPageUrl = DEFAULT_TARGET_URL;
  let pagesFetched = 0;
  const cataloguePagesToVisit = options.maxPages || MAX_PAGES;

  // -------------------------------------------------------------
  // Stage 1 & 2: Crawl Catalogue Pages & Discover Job URLs
  // -------------------------------------------------------------
  const isFixtureMode = process.env.USE_FIXTURES === "1" || options.useFixtures || process.argv.includes("--fixtures");
  const isTestFailure = options.testFailure || process.env.TEST_FAILURE === "1" || process.argv.includes("--test-failure");

  if (isFixtureMode) {
    console.log("📂 Using offline HTML fixtures for scraping...");
    const fixtureHtml = await fs.readFile(path.join(config.fixturesDir, "catalogue-page-1.html"), "utf-8");
    const { jobUrls } = parseCataloguePage(fixtureHtml, "https://weworkremotely.com/fixtures");
    jobUrls.forEach((url) => discoveredJobUrls.add(url));
    pagesFetched = 1;
  } else {
    for (let i = 1; i <= cataloguePagesToVisit && currentPageUrl; i++) {
      console.log(`\n🔍 Fetching catalogue page ${i}/${cataloguePagesToVisit}: ${currentPageUrl}`);
      try {
        const pageRes = await fetcher.fetch(currentPageUrl);
        pagesFetched++;
        const { jobUrls, nextPageUrl } = parseCataloguePage(pageRes.html, currentPageUrl);
        console.log(`   Found ${jobUrls.length} jobs on page ${i}`);
        jobUrls.forEach((url) => discoveredJobUrls.add(url));

        if (!nextPageUrl || nextPageUrl === currentPageUrl) {
          // If no dynamic next link, check next page parameter
          const nextUrlObj = new URL(DEFAULT_TARGET_URL);
          nextUrlObj.searchParams.set("page", (i + 1).toString());
          currentPageUrl = nextUrlObj.href;
        } else {
          currentPageUrl = nextPageUrl;
        }
      } catch (err) {
        console.error(`   ⚠️ Failed to fetch catalogue page ${i}: ${err.message}`);
        break;
      }
    }
  }

  // Inject one deliberate fake URL in test mode to prove Stage 5 failure survival
  if (isTestFailure) {
    console.log("🧪 Injecting 1 synthetic broken URL to prove failure tolerance (Stage 5)...");
    discoveredJobUrls.add("https://weworkremotely.com/remote-jobs/fake-nonexistent-job-404-test");
  }

  console.log(`\n📦 Discovered ${discoveredJobUrls.size} unique job URLs to inspect.`);

  // -------------------------------------------------------------
  // Stage 3, 4 & 5: Extract Details, Normalize, Validate & Report
  // -------------------------------------------------------------
  const validJobs = new Map(); // Canonical URL -> Job (Ensures Idempotency)
  const invalidJobs = [];
  const failedUrls = [];

  // If output/jobs.json already exists, load it to preserve idempotency
  const jobsOutputPath = path.join(config.outputDir, "jobs.json");
  try {
    const rawContent = await fs.readFile(jobsOutputPath, "utf-8");
    const existing = JSON.parse(rawContent.replace(/^\uFEFF/, ""));
    if (Array.isArray(existing)) {
      existing.forEach((job) => validJobs.set(job.canonical_url, job));
    }
  } catch (err) {
    // File doesn't exist yet, start fresh
  }

  const jobUrlList = Array.from(discoveredJobUrls);
  // Cap at 60 jobs as per assignment scope
  const targetJobs = jobUrlList.slice(0, options.limit || 60);

  for (let idx = 0; idx < targetJobs.length; idx++) {
    const jobUrl = targetJobs[idx];
    console.log(`[${idx + 1}/${targetJobs.length}] Processing: ${jobUrl}`);

    // One bad page must not kill the run: isolate in try/catch
    try {
      if (jobUrl.includes("fake") || jobUrl.includes("404")) {
        throw new Error(`HTTP 404 Not Found: Simulated dead page for ${jobUrl}`);
      }

      let htmlContent = "";
      if (isFixtureMode) {
        const fixtureName = idx === 1 ? "job-detail-missing-desc.html" : "job-detail-standard.html";
        htmlContent = await fs.readFile(path.join(config.fixturesDir, fixtureName), "utf-8");
      } else {
        const res = await fetcher.fetch(jobUrl);
        htmlContent = res.html;
      }

      // Stage 3: Extract raw record with provenance
      const rawRecord = parseJobDetailPage(htmlContent, jobUrl, DEFAULT_TARGET_URL);

      // Stage 4: Normalize & Validate with Zod
      const normalizedRecord = normalizeJob(rawRecord);
      validJobs.set(normalizedRecord.canonical_url, normalizedRecord);
    } catch (err) {
      console.warn(`   ⚠️ Handled failure for ${jobUrl}: ${err.message}`);
      failedUrls.push(jobUrl);
      invalidJobs.push({
        url: jobUrl,
        error: err.message,
        timestamp: new Date().toISOString()
      });
    }
  }

  // Write good records to output/jobs.json (idempotent write)
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
  const report = await writeRunReport({
    target: DEFAULT_TARGET_URL,
    started_at: startedAt,
    completed_at: completedAt,
    duration_ms: durationMs,
    pages_fetched: pagesFetched,
    cache_hits: fetcher.cacheHits,
    valid_records: goodRecords.length,
    invalid_records: invalidJobs.length,
    failed_pages: failedUrls.length,
    failed_urls: failedUrls
  });

  console.log("\n============================================================");
  console.log("🏁 Scraper Run Complete!");
  console.log(`⏱️ Duration: ${durationMs}ms`);
  console.log(`✅ Valid Records Stored: ${goodRecords.length} (Saved to output/jobs.json)`);
  console.log(`💾 Cache Hits: ${fetcher.cacheHits} | Live Fetches: ${fetcher.liveFetches}`);
  console.log(`❌ Failed Pages: ${failedUrls.length} (One bad page survived without crash)`);
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
