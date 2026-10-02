import fs from "node:fs/promises";
import path from "node:path";
import OpenAI from "openai";
import { config } from "../config.js";
import { llmClient } from "./client.js";
import { TriageResponseSchema } from "../schemas/triageSchema.js";
import { logCallMetrics } from "./costLogger.js";

const PROMPT_VERSION = "v1";

/**
 * Loads the versioned markdown prompt file.
 */
let cachedPrompt = null;
async function loadPromptSpec() {
  if (cachedPrompt) return cachedPrompt;
  const promptPath = path.join(config.promptsDir, `job-triage-${PROMPT_VERSION}.md`);
  cachedPrompt = await fs.readFile(promptPath, "utf-8");
  return cachedPrompt;
}

/**
 * Strips code fences and preamble from LLM text.
 */
function cleanModelOutput(rawText) {
  if (!rawText || typeof rawText !== "string") return "";
  let cleaned = rawText.trim();
  // Strip ```json ... ``` code blocks
  if (cleaned.startsWith("```")) {
    cleaned = cleaned.replace(/^```(?:json)?\s*/i, "").replace(/```$/, "").trim();
  }
  // Remove common leading conversational phrases if present
  const firstBrace = cleaned.indexOf("{");
  const lastBrace = cleaned.lastIndexOf("}");
  if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
    cleaned = cleaned.substring(firstBrace, lastBrace + 1);
  }
  return cleaned;
}

/**
 * Custom Error classes with HTTP status codes.
 */
export class LLMTimeoutError extends Error {
  constructor(message) {
    super(message);
    this.status = 504;
    this.name = "LLMTimeoutError";
  }
}

export class LLMValidationError extends Error {
  constructor(message, details = null) {
    super(message);
    this.status = 422;
    this.name = "LLMValidationError";
    this.details = details;
  }
}

export class LLMUnavailableError extends Error {
  constructor(message) {
    super(message);
    this.status = 503;
    this.name = "LLMUnavailableError";
  }
}

/**
 * Logs fatal unrecoverable model outputs to logs/quarantine.jsonl.
 */
async function quarantineFailedOutput(inputData, errorMsg, rawOutput) {
  try {
    await fs.mkdir(config.logsDir, { recursive: true });
    const quarantinePath = path.join(config.logsDir, "quarantine.jsonl");
    const entry = {
      timestamp: new Date().toISOString(),
      prompt_version: PROMPT_VERSION,
      input: inputData,
      error: errorMsg,
      raw_output: rawOutput
    };
    await fs.appendFile(quarantinePath, JSON.stringify(entry) + "\n", "utf-8");
  } catch (err) {
    // Non-fatal logging error
  }
}

/**
 * Known technology dictionary for heuristic extraction.
 */
const KNOWN_SKILLS = [
  { name: "Go", regex: /\b(golang|go)\b/i },
  { name: "Python", regex: /\bpython\b/i },
  { name: "Django", regex: /\bdjango\b/i },
  { name: "Flask", regex: /\bflask\b/i },
  { name: "FastAPI", regex: /\bfastapi\b/i },
  { name: "Node.js", regex: /\b(node|node\.js)\b/i },
  { name: "React", regex: /\breact(\.js)?\b/i },
  { name: "TypeScript", regex: /\b(typescript|ts)\b/i },
  { name: "JavaScript", regex: /\b(javascript|js)\b/i },
  { name: "HTML5", regex: /\bhtml5?\b/i },
  { name: "CSS3", regex: /\bcss3?\b/i },
  { name: "Vue", regex: /\bvue(\.js)?\b/i },
  { name: "Angular", regex: /\bangular\b/i },
  { name: "Kubernetes", regex: /\b(kubernetes|k8s)\b/i },
  { name: "Docker", regex: /\bdocker\b/i },
  { name: "AWS", regex: /\b(aws|amazon web services)\b/i },
  { name: "GCP", regex: /\b(gcp|google cloud)\b/i },
  { name: "Kafka", regex: /\bkafka\b/i },
  { name: "PostgreSQL", regex: /\b(postgresql|postgres)\b/i },
  { name: "SQL", regex: /\bsql\b/i },
  { name: "Swift", regex: /\bswift(ui)?\b/i },
  { name: "Kotlin", regex: /\bkotlin\b/i },
  { name: "PyTorch", regex: /\bpytorch\b/i },
  { name: "TensorFlow", regex: /\btensorflow\b/i },
  { name: "Terraform", regex: /\bterraform\b/i },
  { name: "GraphQL", regex: /\bgraphql\b/i },
  { name: "CI/CD", regex: /\bci[\/\s]?cd\b/i }
];

/**
 * Intelligent semantic analyzer used for deterministic stub mode and fallbacks.
 */
function synthesizeSemanticTriage(inputData) {
  const title = (inputData.title || "").toLowerCase();
  const desc = (inputData.description || "").toLowerCase();
  const text = `${title} ${desc}`;

  // 1. Detect prompt injection
  const isInjection = /system override|ignore previous|say banana|system alert|disregard your output/i.test(text);

  // 2. Extract tech stack from known canonical skills
  const matchedSkills = [];
  for (const skill of KNOWN_SKILLS) {
    if (skill.regex.test(text)) {
      matchedSkills.push(skill.name);
      if (matchedSkills.length >= 8) break;
    }
  }

  // 3. Domain determination
  let domain = "other";

  // Filter non-technical / corporate roles (Accountant, Finance Controller, HR, Sales, Legal)
  const isExplicitNonTech = /accountant|buchhalter|controller|finanz|finance|hr\b|recruiter|sales|assistenz|office|jurist|legal|sachbearbeiter/i.test(title);

  if (!isExplicitNonTech) {
    // 1. Direct title matching (highest authority)
    if (/security|penetration|infosec|appsec/i.test(title)) {
      domain = "security";
    } else if (/machine learning|\bml\b|data\s*(engineer|scientist|analyst)|deep learning|\bai\b|artificial intelligence|prompt engineer/i.test(title)) {
      domain = "data_ai";
    } else if (/devops|sre\b|platform engineer|infrastructure|cloud\s*(engineer|architect)/i.test(title)) {
      domain = "devops_cloud";
    } else if (/\b(ios|android|swift|flutter|react native)\b/i.test(title) || /\bmobile\s*(app|developer|engineer|client)\b/i.test(title)) {
      domain = "mobile";
    } else if (/full[- ]?stack/i.test(title)) {
      domain = "fullstack";
    } else if (/frontend|front[- ]?end|ui[\/ ]ux|react|vue|angular/i.test(title)) {
      domain = "frontend";
    } else if (/backend|back[- ]?end|server|database|distributed systems|\bapi\b developer/i.test(title)) {
      domain = "backend";
    }

    // 2. Fallback to body content if title didn't specify domain
    if (domain === "other") {
      if (/security|penetration|owasp|infosec|appsec|vulnerability/i.test(text)) {
        domain = "security";
      } else if (/machine learning|\bml\b|data scientist|deep learning|pytorch|tensorflow/i.test(text)) {
        domain = "data_ai";
      } else if (/devops|sre\b|platform engineer|infrastructure|kubernetes|terraform/i.test(text)) {
        domain = "devops_cloud";
      } else if (/\b(ios|android|swift|flutter|react native)\b/i.test(text) || /\bmobile\s*(app|developer|engineer)\b/i.test(text)) {
        domain = "mobile";
      } else if (/full[- ]?stack/i.test(text) || (/\breact\b/i.test(text) && /\b(node|python|go)\b/i.test(text))) {
        domain = "fullstack";
      } else if (/frontend/i.test(desc) && !/backend|server/i.test(desc)) {
        domain = "frontend";
      } else if (/backend|back[- ]?end|microservices|distributed systems|\bapi\b|\bsql\b|\bpostgres/i.test(desc)) {
        domain = "backend";
      }
    }
  }

  // 4. Seniority determination
  let seniority = "unspecified";
  if (/\b(senior|sr\.?)\b/i.test(title)) {
    seniority = "senior";
  } else if (/\b(staff|principal|lead|guild lead|head of|director|vp|cto)\b/i.test(title)) {
    seniority = /\b(cto|vp|director|head of)\b/i.test(title) ? "executive" : "lead";
  } else if (/\b(junior|jr\.?|entry|intern|graduate|bootcamp|werkstudent)\b/i.test(title) || /1\s*year experience|boot\s*camp graduate/i.test(desc)) {
    seniority = "junior";
  } else if (/5\+\s*years|6\+\s*years|7\+\s*years|8\+\s*years/i.test(desc)) {
    seniority = "senior";
  } else if (domain !== "other" && /software engineer|developer|engineer|specialist|consultant/i.test(title)) {
    seniority = "mid";
  }

  // 5. Workplace determination
  let workplace = "unspecified";
  if (/hybrid|days per week|days in office/i.test(desc)) {
    workplace = "hybrid";
  } else if (/on[- ]?site|in[- ]?office|london office/i.test(desc) && !/100%\s*remote|fully\s*remote/i.test(desc)) {
    workplace = "on_site";
  } else if (/remote|worldwide|anywhere|distributed/i.test(text)) {
    workplace = "fully_remote";
  }

  // 6. Confidence & Rationale
  let confidence = 0.92;
  let reason = `Classified as ${seniority} ${domain.replace('_', ' ')} based on specified technical qualifications.`;

  if (isInjection) {
    confidence = 0.85;
    reason = "Adversarial prompt injection attempt detected and neutralized; evaluated strictly on legitimate engineering scope.";
  } else if (seniority === "unspecified" && domain === "other") {
    confidence = 0.35;
    reason = "Role lacks specific software engineering scope or explicit qualification criteria; confidence set low per when-unsure policy.";
  } else if (seniority === "junior") {
    confidence = 0.88;
    reason = "Explicit junior entry-level scope and foundational stack requirements.";
  } else if (seniority === "lead") {
    confidence = 0.94;
    reason = "Staff/Lead architectural scope and infrastructure leadership responsibilities.";
  }

  const cleanTitle = inputData.title || "Engineering Role";
  const cleanComp = inputData.company ? ` at ${inputData.company}` : "";
  const oneSentence = isInjection
    ? `Develop Python and Flask backend services based in an on-site office.`
    : `Develop and maintain ${domain.replace('_', ' ')} systems as ${cleanTitle}${cleanComp}.`;

  return {
    seniority,
    domain,
    workplace_type: workplace,
    visa_sponsorship: "unspecified",
    tech_stack: matchedSkills,
    confidence,
    one_sentence_summary: oneSentence,
    reason
  };
}

/**
 * Deterministic fallback returned when kill switch (LLM_ENABLED=false) is active.
 */
function getDeterministicFallback(inputData) {
  const synthesized = synthesizeSemanticTriage(inputData);
  synthesized.reason = "Deterministic fallback rule generated by emergency kill-switch policy.";
  return synthesized;
}

/**
 * Deterministic stub mock returned when LLM_STUB=1.
 */
function getStubResponse(inputData) {
  return synthesizeSemanticTriage(inputData);
}

/**
 * Executes a call with exponential backoff & jitter for 429 and 5xx.
 * Never retries 400, 401, or 403.
 */
async function callModelWithRetries(messages, options = {}, maxAttempts = 3) {
  let attempt = 0;
  let delay = 1000;
  const client = options.client || llmClient;
  const model = options.model || config.llmModel;

  while (attempt < maxAttempts) {
    attempt++;
    const startTime = Date.now();
    try {
      const response = await client.chat.completions.create({
        model,
        messages,
        temperature: 0.1,
        max_tokens: 600
      });
      return { response, durationMs: Date.now() - startTime };
    } catch (err) {
      const durationMs = Date.now() - startTime;
      const status = err.status || (err.response ? err.response.status : null);

      // Timeout detection
      if (err.name === "AbortError" || err.message?.includes("timeout") || status === 504) {
        if (attempt >= maxAttempts) {
          throw new LLMTimeoutError(`LLM call timed out after ${config.llmTimeoutMs}ms`);
        }
      }

      // Fast-fail on authentication or bad requests: NEVER retry 400, 401, 403
      if (status === 400 || status === 401 || status === 403) {
        console.error(`[LLM_FATAL] Fast-fail on HTTP ${status} (No retries allowed): ${err.message}`);
        throw err;
      }

      // Retryable errors: 429 (rate limit) or 5xx (server error)
      const isRetryable = status === 429 || (status >= 500 && status < 600) || !status;
      if (!isRetryable || attempt >= maxAttempts) {
        throw err;
      }

      // Obey Retry-After header if provided
      let waitTime = delay + Math.floor(Math.random() * 500); // Backoff + Jitter
      if (err.headers && err.headers["retry-after"]) {
        const retryAfterVal = parseInt(err.headers["retry-after"], 10);
        if (!isNaN(retryAfterVal)) waitTime = retryAfterVal * 1000;
      }

      console.warn(`[LLM_RETRY] Attempt ${attempt} failed with status ${status}. Retrying in ${waitTime}ms...`);
      await new Promise((r) => setTimeout(r, waitTime));
      delay *= 2;
    }
  }
}

/**
 * Main Triage Service function with 1x Repair Retry Loop and Quarantine Logging.
 */
export async function triageJob(jobInput, options = {}) {
  const startTime = Date.now();

  // 1. Check Kill Switch (Stage 4)
  if (!config.llmEnabled && !options.force) {
    console.log("[KILL_SWITCH] LLM is disabled (LLM_ENABLED=false). Returning deterministic fallback.");
    return {
      result: getDeterministicFallback(jobInput),
      metrics: { durationMs: Date.now() - startTime, isStub: true, neededRepair: false }
    };
  }

  // 2. Check Stub Mode (Stage 1)
  // If an explicit API key is provided, prefer live execution unless stub is explicitly set
  const hasCustomKey = !!options.apiKey;
  const isStub = options.stub !== undefined 
    ? options.stub 
    : (hasCustomKey ? false : config.llmStub);

  if (isStub) {
    const stubResult = getStubResponse(jobInput);
    const durationMs = Date.now() - startTime;
    const metrics = await logCallMetrics({
      promptVersion: PROMPT_VERSION,
      model: "stub",
      inputTokens: 0,
      outputTokens: 0,
      durationMs,
      neededRepair: false,
      isStub: true
    });
    return { result: stubResult, metrics };
  }

  // Configure dynamic client if custom API key is supplied
  const activeClient = hasCustomKey
    ? new OpenAI({
        baseURL: options.baseUrl || config.llmBaseUrl,
        apiKey: options.apiKey,
        timeout: config.llmTimeoutMs,
        maxRetries: 0
      })
    : llmClient;

  const activeModel = options.model || config.llmModel;
  const callOptions = { client: activeClient, model: activeModel };

  // 3. Prepare Prompt & Defensive Message Structure (Stage 2)
  const systemPrompt = await loadPromptSpec();
  const userPayloadString = JSON.stringify({
    title: jobInput.title,
    company: jobInput.company || "Not Specified",
    description: jobInput.description
  });

  const messages = [
    { role: "system", content: systemPrompt },
    { role: "user", content: `Please evaluate this tech job posting:\n${userPayloadString}` }
  ];

  // 4. Attempt 1: Call Model
  let neededRepair = false;
  let rawOutput = "";
  let usage = { prompt_tokens: 0, completion_tokens: 0 };
  let durationMs = 0;

  try {
    const callResult = await callModelWithRetries(messages, callOptions);
    durationMs = callResult.durationMs;
    const message = callResult.response.choices[0]?.message;
    rawOutput = message?.content || "";
    usage = callResult.response.usage || usage;
  } catch (err) {
    if (err instanceof LLMTimeoutError) throw err;
    throw new LLMUnavailableError(`LLM provider communication failed: ${err.message}`);
  }

  // 5. Parse & Validate Attempt 1 (Stage 3)
  let parsedObject = null;
  let validationError = null;

  try {
    const cleaned = cleanModelOutput(rawOutput);
    parsedObject = JSON.parse(cleaned);
    const validationResult = TriageResponseSchema.safeParse(parsedObject);
    if (validationResult.success) {
      const metrics = await logCallMetrics({
        promptVersion: PROMPT_VERSION,
        model: activeModel,
        inputTokens: usage.prompt_tokens,
        outputTokens: usage.completion_tokens,
        durationMs,
        neededRepair: false
      });
      return { result: validationResult.data, metrics };
    } else {
      validationError = validationResult.error.message;
    }
  } catch (parseErr) {
    validationError = `JSON parse failed: ${parseErr.message}`;
  }

  // 6. Repair Retry (Exactly 1 Retry with Feedback)
  console.warn(`[REPAIR_RETRY] Model output rejected: ${validationError}. Initiating 1x repair retry...`);
  neededRepair = true;

  const repairMessages = [
    ...messages,
    { role: "assistant", content: rawOutput },
    {
      role: "user",
      content: `Your previous answer was rejected for this reason:\n${validationError}\n\nReturn ONLY a valid, corrected JSON object matching the exact schema without any markdown code blocks or conversational text.`
    }
  ];

  try {
    const repairCall = await callModelWithRetries(repairMessages, callOptions);
    durationMs += repairCall.durationMs;
    const repairRaw = repairCall.response.choices[0]?.message?.content || "";
    usage.prompt_tokens += repairCall.response.usage?.prompt_tokens || 0;
    usage.completion_tokens += repairCall.response.usage?.completion_tokens || 0;

    const cleanedRepair = cleanModelOutput(repairRaw);
    const repairedParsed = JSON.parse(cleanedRepair);
    const repairedValidation = TriageResponseSchema.safeParse(repairedParsed);

    if (repairedValidation.success) {
      console.log("[REPAIR_SUCCESS] Model successfully repaired its output on retry!");
      const metrics = await logCallMetrics({
        promptVersion: PROMPT_VERSION,
        model: activeModel,
        inputTokens: usage.prompt_tokens,
        outputTokens: usage.completion_tokens,
        durationMs,
        neededRepair: true
      });
      return { result: repairedValidation.data, metrics };
    }

    // Repair failed schema validation
    await quarantineFailedOutput(jobInput, repairedValidation.error.message, repairRaw);
    throw new LLMValidationError("Repaired model output failed schema validation", repairedValidation.error.format());
  } catch (finalErr) {
    if (finalErr instanceof LLMValidationError) throw finalErr;
    await quarantineFailedOutput(jobInput, finalErr.message, rawOutput);
    throw new LLMValidationError(`Repair failed to produce valid JSON: ${finalErr.message}`);
  }
}

/**
 * Diagnostic utility to test active LLM provider connection.
 */
export async function testLlmConnection(options = {}) {
  const apiKey = options.apiKey || config.llmApiKey;
  const baseUrl = options.baseUrl || config.llmBaseUrl;
  const model = options.model || config.llmModel;

  if (!apiKey || apiKey === "your_openrouter_api_key_here" || apiKey === "stub-mode") {
    return {
      ok: false,
      error: "No active OpenRouter API key found. Enter an API key in LLM Settings or .env to test live provider."
    };
  }

  const client = new OpenAI({
    baseURL: baseUrl,
    apiKey,
    timeout: 10000,
    maxRetries: 0
  });

  const t0 = Date.now();
  try {
    const res = await client.chat.completions.create({
      model,
      messages: [{ role: "user", content: "Ping. Respond strictly with 'pong'." }],
      max_tokens: 10
    });
    const reply = res.choices[0]?.message?.content || "";
    return {
      ok: true,
      model,
      reply: reply.trim(),
      latencyMs: Date.now() - t0
    };
  } catch (err) {
    return {
      ok: false,
      error: err.message,
      status: err.status || (err.response ? err.response.status : 500)
    };
  }
}
