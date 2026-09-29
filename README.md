# JobPulse ⚡
> **Polite Web Ingestion Pipeline & Production-Guarded LLM Triage Engine**

[![CI Pipeline](https://github.com/abubakar-ahmed-dev/job-pulse/actions/workflows/ci.yml/badge.svg)](https://github.com/abubakar-ahmed-dev/job-pulse/actions)
![Node Version](https://img.shields.io/badge/node-%3E%3D20.0.0-brightgreen.svg)
![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)
![Provider Support](https://img.shields.io/badge/LLM-OpenRouter%20%7C%20Ollama-purple.svg)

**JobPulse** is a production-grade backend system combining deterministic, respectful web crawling with guarded semantic LLM classification. It solves a real-world problem: transforming unstructured, messy web job postings into verified, normalized, and categorized engineering market intelligence.

---

## 🎯 Target Classification & Web Ethics (Stage 0)

* **Target Site**: WeWorkRemotely (`https://weworkremotely.com`)
* **Why**: Leading public board for authentic remote software engineering roles with standard semantic server-rendered HTML.
* **Robots.txt Verification**: We requested and verified `https://weworkremotely.com/robots.txt`. It explicitly allows indexing with `User-agent: *` and `Allow: /`, disallowing only private member directories (`/admin/`, `/account/`, `/job-seekers/profile/`).
* **Scope**: Exactly 3 catalogue pages (~60 listings) per scrape run.
* **Data Collected**: Job title, hiring company, canonical product URL, raw and normalized salary bounds (USD), workplace policy, and full job description.
* **Politeness Guarantees**:
  - **Honest User-Agent**: Every request identifies the bot: `JobPulse/1.0 (+https://github.com/abubakar-ahmed-dev/job-pulse)`.
  - **Rate Limiting**: Minimum 500ms delay between live network requests.
  - **Disk Caching**: All fetched HTML is cached locally in `cache/`. Re-runs during development hit the cache with 0ms delay and zero server load.
  - **Sensible Timeouts**: Strict 5-second HTTP timeout per request.
* **Ethics Declaration**:
  > *"I will not reuse this code on another site without checking its rules and terms first."*

---

## 🏗️ System Architecture

```
┌────────────────────────────────────────────────────────────────────────┐
│                               JOBPULSE PIPELINE                        │
└────────────────────────────────────────────────────────────────────────┘

 [ WeWorkRemotely ]
        │
        ▼ (Honest UA, 5s timeout, ≥500ms delay)
 ┌──────────────┐     Hit     ┌──────────────┐
 │ HTTP Fetcher ├────────────►│  Disk Cache  │
 └──────┬───────┘             └──────┬───────┘
        │                            │
        │ Miss                       │
        ▼                            ▼
 ┌──────────────┐             ┌──────────────┐
 │ Cheerio HTML ├────────────►│  Normalizer  │
 │  Extractor   │             │ (Salary,URL) │
 └──────────────┘             └──────┬───────┘
                                     │
                                     ▼
                              ┌──────────────┐
                              │  Zod Schema  │
                              │  Validation  │
                              └──────┬───────┘
                                     │
                    ┌────────────────┴────────────────┐
                    │ Valid                           │ Invalid
                    ▼                                 ▼
             output/jobs.json                 output/errors.json
                    │
                    ▼
     POST /api/v1/jobs/triage (Guarded Express API)
                    │
       ┌────────────┴────────────┐
       ▼                         ▼
 [LLM_STUB=1]              [Live Provider: OpenRouter / Ollama]
 Instant Mock              Timeout: 30s | Backoff Retries: 429/5xx
                                 │
                           Zod Output Guard
                                 │
                   ┌─────────────┴─────────────┐
                   ▼ Schema Pass               ▼ Schema Fail
              200 OK + Cost Log            1x Repair Retry
                                               │
                                     ┌─────────┴─────────┐
                                     ▼ Pass              ▼ Fail
                                 200 OK            422 + Quarantine Log
```

---

## ⚡ Quickstart (Under 2 Minutes)

### 1. Prerequisites
- Node.js 20+ installed (`node -v`)

### 2. Setup
```bash
# Clone the repository
git clone git@github-personal:abubakar-ahmed-dev/job-pulse.git
cd job-pulse

# Install dependencies
npm install

# Setup environment (Stub mode enabled by default)
cp .env.example .env
```

### 3. Run the Scraper (Offline Fixtures or Live)
```bash
# Run with offline fixtures (instant, zero network required):
npm run scrape:fixture

# Run live against WeWorkRemotely (with cache & 500ms delay):
npm run scrape
```

### 4. Run the API Server
```bash
npm start
# Server listens on http://localhost:3000
```

### 5. Test the Guarded Triage Endpoint
```bash
# Test valid request (runs in stub mode by default):
curl -X POST http://localhost:3000/api/v1/jobs/triage \
  -H "Content-Type: application/json" \
  -d '{
    "title": "Senior Backend Engineer",
    "description": "We are seeking a Senior Go/Node engineer to architect distributed streaming pipelines using Kafka, Docker, and PostgreSQL. 100% remote worldwide.",
    "company": "PulseCloud"
  }'

# Test input validation rejection (returns 400 Bad Request naming offending field):
curl -X POST http://localhost:3000/api/v1/jobs/triage \
  -H "Content-Type: application/json" \
  -d '{ "title": "AB" }'
```

### 6. Run the Test Suite & Eval Benchmark
```bash
# Run unit & fixture tests:
npm test

# Run LLM contract eval suite (8 hand-labeled cases):
npm run eval:stub
```

---

## 📋 The Job Card Contract (`JOB-CARD.md`)

Our semantic triage endpoint adheres strictly to three fundamental rules:
1. **Closed Output**: Strict enums for `seniority`, `domain`, `workplace_type`, and `visa_sponsorship`.
2. **One Decision**: Single request in, validated JSON out — not a conversational chatbot.
3. **Human-Gradable**: Objective ground truth benchmarked with 8 labeled test cases in `evals/cases.json`.

---

## 🛡️ Production Hardening & Reliability

* **Stub Mode (`LLM_STUB=1`)**: Enables instant, zero-cost offline development and automated CI testing.
* **Kill Switch (`LLM_ENABLED=false`)**: Skips the external model during outages or bill spikes, returning a safe deterministic fallback.
* **Defensive Prompt Engineering**: User input is strictly passed inside the `user` role (JSON-encoded) and never concatenated into the `system` prompt, neutralizing prompt injection attacks.
* **1x Repair Retry Loop**: If an LLM returns invalid JSON or an unauthorized enum, JobPulse captures the Zod validation error, sends it back to the model once to self-correct, and only quarantines to `logs/quarantine.jsonl` with HTTP 422 if the repair fails.
* **Cost Observability**: Structured stdout log on every request tracking prompt version, model ID, latency, input tokens, output tokens, and repair attempts.

---

## 📄 License
MIT © [Abubakar Ahmed](https://github.com/abubakar-ahmed-dev)
