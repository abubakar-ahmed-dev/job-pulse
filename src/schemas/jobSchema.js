import { z } from "zod";

/**
 * Raw scraped job listing schema directly from HTML parsing.
 * Represents untrusted input with provenance receipts.
 */
export const JobRawSchema = z.object({
  title: z.string().min(1, "Title cannot be empty"),
  company: z.string().min(1, "Company cannot be empty"),
  product_url: z.string().url("Product URL must be a valid absolute URL"),
  location_raw: z.string().default("Remote"),
  salary_raw: z.string().nullable().default(null),
  job_type_raw: z.string().nullable().default(null),
  description_raw: z.string().nullable().default(null),
  source_site: z.string().default("WeWorkRemotely"),
  source_page: z.string().url("Source page must be a valid URL"),
  fetched_at: z.string().datetime("Fetched at must be a valid ISO-8601 UTC timestamp")
});

/**
 * Normalized and validated job record.
 * Keeps raw and cleaned values side-by-side for provenance and auditability.
 */
export const JobNormalizedSchema = z.object({
  id: z.string().min(1, "Job ID is required"),
  canonical_url: z.string().url("Canonical URL must be a valid URL"),
  title: z.string().min(1, "Title is required"),
  company: z.string().min(1, "Company is required"),
  source_site: z.string().default("WeWorkRemotely"),
  location: z.string(),
  is_remote: z.boolean(),
  job_type: z.string(),
  salary_min_usd: z.number().nullable(),
  salary_max_usd: z.number().nullable(),
  salary_raw: z.string().nullable(),
  description: z.string().nullable(),
  source_page: z.string().url(),
  fetched_at: z.string().datetime(),
  normalized_at: z.string().datetime()
});

/**
 * Scraper Run Report Schema.
 */
export const RunReportSchema = z.object({
  target: z.string(),
  started_at: z.string().datetime(),
  completed_at: z.string().datetime(),
  duration_ms: z.number().nonnegative(),
  pages_fetched: z.number().nonnegative(),
  cache_hits: z.number().nonnegative(),
  valid_records: z.number().nonnegative(),
  invalid_records: z.number().nonnegative(),
  failed_pages: z.number().nonnegative(),
  failed_urls: z.array(z.string()),
  sources: z.record(z.object({
    fetched: z.number().nonnegative(),
    valid: z.number().nonnegative()
  })).optional()
});
