import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { config } from "../src/config.js";
import { normalizeSalary, normalizeUrl, generateJobId, normalizeJob } from "../src/scraper/normalizer.js";
import { parseCataloguePage, parseJobDetailPage } from "../src/scraper/parser.js";

describe("W5 Scraper Pipeline Test Suite", () => {

  it("1. Price normalization: correctly parses salary ranges and single values", () => {
    const rangeResult = normalizeSalary("$140,000 - $180,000 USD");
    assert.deepEqual(rangeResult, { min: 140000, max: 180000 });

    const singleResult = normalizeSalary("$100,000 or more USD");
    assert.deepEqual(singleResult, { min: 100000, max: null });

    const nullResult = normalizeSalary(null);
    assert.deepEqual(nullResult, { min: null, max: null });

    const nonSalary = normalizeSalary("Full-Time Anywhere");
    assert.deepEqual(nonSalary, { min: null, max: null });
  });

  it("2. Relative to Absolute URL resolution: never concatenates strings", () => {
    const baseUrl = "https://weworkremotely.com/categories/remote-programming-jobs";
    const relativeHref = "/remote-jobs/acme-engineer";
    const absolute = new URL(relativeHref, baseUrl).href;
    assert.equal(absolute, "https://weworkremotely.com/remote-jobs/acme-engineer");

    const normalized = normalizeUrl("https://weworkremotely.com/remote-jobs/acme-engineer?utm_source=twitter&tracker=123");
    assert.equal(normalized, "https://weworkremotely.com/remote-jobs/acme-engineer");
  });

  it("3. Parser handles missing description gracefully with null (never invents text)", async () => {
    const fixturePath = path.join(config.fixturesDir, "job-detail-missing-desc.html");
    const html = await fs.readFile(fixturePath, "utf-8");
    const raw = parseJobDetailPage(html, "https://weworkremotely.com/jobs/stealth-ai", "https://weworkremotely.com/fixtures");

    assert.equal(raw.title, "Stealth AI Researcher");
    assert.equal(raw.company, "Stealth Lab");
    assert.equal(raw.description_raw, null, "Missing description must be null");

    const normalized = normalizeJob(raw);
    assert.equal(normalized.description, null);
    assert.equal(typeof normalized.id, "string");
  });

  it("4. Deduplication: catalogue parser eliminates duplicate job links", async () => {
    const fixturePath = path.join(config.fixturesDir, "catalogue-page-1.html");
    const html = await fs.readFile(fixturePath, "utf-8");
    const { jobUrls } = parseCataloguePage(html, "https://weworkremotely.com");

    const uniqueSet = new Set(jobUrls);
    assert.equal(jobUrls.length, uniqueSet.size, "Discovered URLs must be unique");
  });

  it("5. Malformed fixture survival: parser does not throw on empty/broken HTML", async () => {
    const fixturePath = path.join(config.fixturesDir, "job-detail-malformed.html");
    const html = await fs.readFile(fixturePath, "utf-8");
    const raw = parseJobDetailPage(html, "https://weworkremotely.com/jobs/broken", "https://weworkremotely.com/fixtures");

    assert.ok(raw.title);
    assert.equal(raw.description_raw, null);
  });

  it("6. Arbeitnow Catalogue: correctly extracts junior listings from offline fixture", async () => {
    const fixturePath = path.join(config.fixturesDir, "arbeitnow-catalogue.html");
    const html = await fs.readFile(fixturePath, "utf-8");
    const { jobUrls } = parseCataloguePage(html, "https://www.arbeitnow.com/jobs/junior");

    assert.ok(jobUrls.length > 0, "Should discover job URLs from Arbeitnow catalogue");
    assert.ok(jobUrls.every((url) => url.startsWith("https://www.arbeitnow.com/")), "All URLs should be absolute");
  });

  it("7. Arbeitnow Detail: extracts JSON-LD JobPosting schema and validates with Zod", async () => {
    const fixturePath = path.join(config.fixturesDir, "arbeitnow-detail.html");
    const html = await fs.readFile(fixturePath, "utf-8");
    const raw = parseJobDetailPage(html, "https://www.arbeitnow.com/jobs/companies/haiilo-1/junior-fullstack-engineer-hamburg-410395", "https://www.arbeitnow.com/jobs/junior");

    assert.equal(raw.title, "Junior Fullstack Engineer");
    assert.equal(raw.company, "Haiilo 1");
    assert.equal(raw.source_site, "Arbeitnow");
    assert.ok(raw.description_raw && raw.description_raw.length > 50);

    const normalized = normalizeJob(raw);
    assert.equal(normalized.source_site, "Arbeitnow");
    assert.equal(normalized.title, "Junior Fullstack Engineer");
    assert.equal(typeof normalized.id, "string");
  });
});
