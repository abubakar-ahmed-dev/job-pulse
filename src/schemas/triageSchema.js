import { z } from "zod";

/**
 * Closed Enums for strict, non-hallucinatory LLM output.
 */
export const SeniorityEnum = z.enum([
  "junior",
  "mid",
  "senior",
  "lead",
  "executive",
  "unspecified"
]);

export const EngineeringDomainEnum = z.enum([
  "backend",
  "frontend",
  "fullstack",
  "devops_cloud",
  "data_ai",
  "mobile",
  "security",
  "other"
]);

export const WorkplaceTypeEnum = z.enum([
  "fully_remote",
  "hybrid",
  "on_site",
  "timezone_restricted",
  "unspecified"
]);

export const VisaSponsorshipEnum = z.enum([
  "offered",
  "not_offered",
  "unspecified"
]);

/**
 * Triage API Request Schema.
 * Validates input strictly before calling the model (400 if malformed).
 */
export const TriageRequestSchema = z.object({
  title: z
    .string({ required_error: "title is required" })
    .min(3, "title must be at least 3 characters")
    .max(200, "title cannot exceed 200 characters"),
  description: z
    .string({ required_error: "description is required" })
    .min(20, "description must be at least 20 characters")
    .max(15000, "description exceeds maximum allowed length of 15000 characters"),
  company: z
    .string()
    .max(100, "company name cannot exceed 100 characters")
    .optional()
});

/**
 * Triage API Response Schema.
 * Enforces the JOB-CARD contract on all model responses.
 */
export const TriageResponseSchema = z.object({
  seniority: SeniorityEnum,
  domain: EngineeringDomainEnum,
  workplace_type: WorkplaceTypeEnum,
  visa_sponsorship: VisaSponsorshipEnum,
  tech_stack: z.array(z.string().min(1)).max(8).default([]),
  confidence: z.number().min(0.0).max(1.0),
  one_sentence_summary: z.string().min(10).max(300),
  reason: z.string().min(10).max(400)
});
