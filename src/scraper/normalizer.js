import crypto from "node:crypto";
import { JobNormalizedSchema } from "../schemas/jobSchema.js";

/**
 * Normalizes salary text into numeric bounds.
 * Keeps original salary_raw side-by-side for auditability.
 */
export function normalizeSalary(salaryRaw) {
  if (!salaryRaw || typeof salaryRaw !== "string") {
    return { min: null, max: null };
  }

  // Find all numeric values with optional commas (e.g., $75,000, 100,000)
  const matches = salaryRaw.match(/(\d[\d,]*)/g);
  if (!matches || matches.length === 0) {
    return { min: null, max: null };
  }

  const numbers = matches
    .map((numStr) => parseInt(numStr.replace(/,/g, ""), 10))
    .filter((n) => !isNaN(n) && n > 1000); // Filter out days, e.g. "25d"

  if (numbers.length === 0) {
    return { min: null, max: null };
  }

  if (numbers.length === 1) {
    return { min: numbers[0], max: null };
  }

  const sorted = [...numbers].sort((a, b) => a - b);
  return {
    min: sorted[0],
    max: sorted[sorted.length - 1]
  };
}

/**
 * Normalizes canonical URL by stripping tracking parameters.
 */
export function normalizeUrl(rawUrl) {
  try {
    const parsed = new URL(rawUrl);
    parsed.search = ""; // Strip query params like utm_source, tracker, etc.
    parsed.hash = "";
    return parsed.href;
  } catch (err) {
    return rawUrl;
  }
}

/**
 * Deterministic ID generator from canonical URL.
 */
export function generateJobId(canonicalUrl) {
  return crypto.createHash("sha256").update(canonicalUrl).digest("hex").slice(0, 16);
}

/**
 * Normalizes a raw job record and validates against JobNormalizedSchema.
 */
export function normalizeJob(rawRecord) {
  const canonicalUrl = normalizeUrl(rawRecord.product_url);
  const { min, max } = normalizeSalary(rawRecord.salary_raw);
  const location = (rawRecord.location_raw || "Remote").trim();
  const isRemote = /remote|anywhere|worldwide|distributed/i.test(location);

  const normalized = {
    id: generateJobId(canonicalUrl),
    canonical_url: canonicalUrl,
    title: rawRecord.title.trim(),
    company: rawRecord.company.trim(),
    source_site: rawRecord.source_site || "WeWorkRemotely",
    location,
    is_remote: isRemote,
    job_type: rawRecord.job_type_raw || "Full-Time",
    salary_min_usd: min,
    salary_max_usd: max,
    salary_raw: rawRecord.salary_raw ? rawRecord.salary_raw.trim() : null,
    description: rawRecord.description_raw ? rawRecord.description_raw.trim() : null,
    source_page: rawRecord.source_page,
    fetched_at: rawRecord.fetched_at,
    normalized_at: new Date().toISOString()
  };

  // Enforce schema validation
  return JobNormalizedSchema.parse(normalized);
}
