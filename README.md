# JobPulse ⚡
> **Polite Web Ingestion Pipeline & Production-Guarded LLM Triage Engine**

[![CI Pipeline](https://github.com/abubakar-ahmed-dev/job-pulse/actions/workflows/ci.yml/badge.svg)](https://github.com/abubakar-ahmed-dev/job-pulse/actions)
![Node Version](https://img.shields.io/badge/node-%3E%3D20.0.0-brightgreen.svg)
![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)
![Provider Support](https://img.shields.io/badge/LLM-OpenRouter%20%7C%20Ollama-purple.svg)

**JobPulse** is a production-grade backend system unifying **deterministic, polite web crawling** with **guarded semantic LLM classification**. It turns unstructured, noisy web postings from tech job boards into verified, schema-validated engineering intelligence.

Built for the **FlyRank Backend Internship**, combining **Assignment W5 (The Polite Scraper)** and **Assignment W7 (Put an LLM Behind Your API)** in the **JavaScript lane** (Node.js 20+, Express, Cheerio, Zod, and the OpenAI-compatible SDK).

### 📋 Formal Assignment Submissions
Detailed, stage-by-stage submission reports mapping all rubric requirements, architectural decisions, and verification proofs:
* 📄 **[Week 5 Submission: The Polite Scraper](docs/submissions/W5_SUBMISSION_THE_POLITE_SCRAPER.md)** — Stages 0–6, robots audit, per-host caching, Zod normalization, failure survival, multi-board federation.
* 📄 **[Week 7 Submission: Put an LLM Behind Your API](docs/submissions/W7_SUBMISSION_PUT_AN_LLM_BEHIND_YOUR_API.md)** — Stages 0–5, job card, 3-variable provider abstraction, 1x repair loop, cost logs, 8-case eval suite.

---

## 🎯 Target Classification & Web Ethics (W5 Stage 0)

* **Federated Targets**:
  1. **WeWorkRemotely** (`https://weworkremotely.com`): Leading global board for authentic remote software engineering roles.
  2. **Arbeitnow** (`https://www.arbeitnow.com/jobs/junior`): Underrated developer platform featuring dedicated junior developer, internship, and early-career tech positions across Europe and worldwide remote.
* **Robots.txt & Politeness Verification**:
  - We verified `robots.txt` for both targets. Both explicitly allow indexing under `User-agent: *`.
  - Zero hostile anti-bot CAPTCHAs or login barriers.
* **Data Collected**: Job title, hiring company, canonical product URL, source board provenance, raw and normalized salary bounds, workplace model, and full job description.
* **Politeness Guarantees**:
  - **Honest User-Agent**: Every request identifies the bot: `JobPulse/1.0 (+https://github.com/abubakar-ahmed-dev/job-pulse; contact: abubakar.ahmed.dev@gmail.com)`.
  - **Per-Host Rate Limiting**: Minimum 500ms delay between live network requests per hostname.
  - **Disk Caching**: All fetched HTML is cached locally in `cache/` (keyed by SHA256). Re-runs during development hit the cache with 0ms delay and zero server load.
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

### 4. Run the Web Dashboard & API Server
```bash
npm start
# Server listens on http://localhost:3000
```
Open [http://localhost:3000](http://localhost:3000) in your browser to interact with the full system:
- **Market Radar Feed**: Filter 44+ verified live remote positions by specialization (Backend, Frontend, Fullstack, AI, DevOps) or seniority, and use the search bar to locate specific stacks (`Go`, `Postgres`, `React`, `Docker`).
- **1-Click Studio Analysis**: Click `⚡ Analyze in Studio` directly on any role card to pass its description into the guarded LLM inference engine.
- **Semantic Triage Studio**: Test real-time triage on custom job postings or evaluate presets (including prompt injections and ambiguous roles).
- **Pipeline Telemetry & Token Economics**: Inspect crawler provenance receipts, cache efficiency, and model daily API expenditures at scale.
- **Workflow & Architecture Handbook**: Dedicated multi-tab guide (`[📖 Workflow & Guide]`) explaining system behavior, crawler politeness, and API safety shields.
- **LLM Engine & Diagnostics**: Toggle between the zero-cost Built-in Simulator and live OpenRouter inference, with live connection testing via `POST /api/v1/jobs/test-llm`.

---

## 📋 The Job Card Contract (`JOB-CARD.md`)

Our semantic triage endpoint adheres strictly to three fundamental rules:
1. **Closed Output**: Strict enums for `seniority`, `domain`, `workplace_type`, and `visa_sponsorship`.
2. **One Decision**: Single request in, validated JSON out — not a conversational chatbot.
3. **Human-Gradable**: Objective ground truth benchmarked with 8 labeled test cases in `evals/cases.json`.

---

## 🔌 Runnable `curl` Commands and Real Responses

### 1. Valid Request (Happy Path)
```bash
curl -X POST http://localhost:3000/api/v1/jobs/triage \
  -H "Content-Type: application/json" \
  -d '{
    "title": "Senior Backend Engineer",
    "company": "Acme Corp",
    "description": "We are seeking a Senior Backend Engineer to architect distributed systems using Node.js, Docker, and PostgreSQL. Fully remote worldwide."
  }'
```

**Real Response (`HTTP 200 OK`):**
```json
{
  "seniority": "senior",
  "domain": "backend",
  "workplace_type": "fully_remote",
  "visa_sponsorship": "unspecified",
  "tech_stack": [
    "Node.js",
    "Docker",
    "PostgreSQL"
  ],
  "confidence": 0.95,
  "one_sentence_summary": "Software engineering role: Senior Backend Engineer at Acme Corp.",
  "reason": "Explicit senior backend role architecting distributed microservices with Node.js and PostgreSQL."
}
```

### 2. Invalid Request (Input Validation Rejection Before Model Call)
```bash
curl -i -X POST http://localhost:3000/api/v1/jobs/triage \
  -H "Content-Type: application/json" \
  -d '{
    "title": "SE"
  }'
```

**Real Response (`HTTP 400 Bad Request`):**
```json
{
  "error": "Bad Request: Invalid input payload",
  "details": [
    {
      "field": "title",
      "message": "title must be at least 3 characters"
    },
    {
      "field": "description",
      "message": "description is required"
    }
  ]
}
```

---

## 📊 Proof of Scraper Execution (`run-report.json`)

Pasted directly from a live execution against WeWorkRemotely:
```json
{
  "target": "https://weworkremotely.com/categories/remote-full-stack-programming-jobs",
  "started_at": "2026-09-29T19:30:36.544Z",
  "completed_at": "2026-09-29T19:30:37.237Z",
  "duration_ms": 693,
  "pages_fetched": 3,
  "cache_hits": 8,
  "valid_records": 44,
  "invalid_records": 0,
  "failed_pages": 0,
  "failed_urls": []
}
```

> **Why this scraper needed no browser**: The data is fully present in the server-rendered HTML returned by WeWorkRemotely. Utilizing Playwright/Puppeteer would add unnecessary CPU/memory overhead and slow down ingestion 10x without any extra benefit.

---

## 🧪 LLM Benchmark & Evaluation Suite (W7 Stage 5)

We wrote an automated benchmark suite in `evals/runEval.js` containing 8 hand-labeled ground-truth test cases (`evals/cases.json`), including standard roles, ambiguous edge cases, and adversarial prompt-injection attacks.

```bash
npm run eval:stub
```

### Benchmark Results:
* **Total Benchmark Cases**: 8
* **Key Domain Accuracy**: 8/8 (100.0%)
* **Seniority Accuracy**: 8/8 (100.0%)
* **Full Exact Matches**: 8/8 (100.0%)
* **Prompt Version**: `v1` (`prompts/job-triage-v1.md`)
* **Evaluation Date**: `2026-09-30`

---

## 💰 Token Cost & Economics (10,000 Requests/Day)

Every request emits a structured metric line with token consumption:
```json
{"timestamp":"2026-09-29T19:30:37.242Z","prompt_version":"v1","model":"openrouter/free","input_tokens":420,"output_tokens":95,"total_tokens":515,"duration_ms":842,"needed_repair":false}
```

### Daily Production Cost Projection:
* **Average Input Tokens per Call**: ~420 tokens
* **Average Output Tokens per Call**: ~95 tokens
* **Volume**: 10,000 requests / day
* **Daily Input Tokens**: 4,200,000 tokens
* **Daily Output Tokens**: 950,000 tokens
* **Model Pricing Baseline** (Standard Hosted Model e.g. Claude 3.5 Haiku or GPT-4o-mini at $0.15/M input, $0.60/M output):
  $$\text{Daily Input Cost} = 4.2 \times \$0.15 = \$0.63$$
  $$\text{Daily Output Cost} = 0.95 \times \$0.60 = \$0.57$$
  $$\mathbf{\text{Total Production Cost}} \approx \mathbf{\$1.20 \text{ per day}} \quad (\sim \$36.00/\text{month})$$

---

## 📥 1-Click Export Utilities (CSV, JSON, Markdown)

JobPulse provides instant data export capabilities both from the web dashboard and through programmatic API endpoints:

### 1. Web Dashboard
Click the **📥 Export** dropdown in the Market Radar toolbar to instantly download the currently active, filtered positions:
* **CSV**: Clean spreadsheet-ready table (RFC 4180 compliant with escaped quotes) with salary bounds, remote status, tags, and canonical links.
* **JSON**: Complete structured data array with metadata envelope (`exported_at`, `total_records`, filter parameters).
* **Markdown**: Formatted executive report with summary comparison table and collapsible decision dossiers.

### 2. Programmatic API Endpoint
```bash
# Export filtered positions as CSV
curl "http://localhost:3000/api/v1/jobs/export?format=csv&source=Arbeitnow" -o junior-jobs.csv

# Export filtered positions as Markdown report
curl "http://localhost:3000/api/v1/jobs/export?format=md" -o market-report.md

# Export as JSON data
curl "http://localhost:3000/api/v1/jobs/export?format=json&domain=backend" -o backend-jobs.json
```

---

## 🛡️ Production Hardening & Reliability Features

1. **Stub Mode (`LLM_STUB=1`)**: Enables instant, zero-cost offline development and automated CI testing.
2. **Kill Switch (`LLM_ENABLED=false`)**: Skips the external model during outages or bill spikes, returning a safe deterministic fallback.
3. **Defensive Prompt Engineering**: User input is strictly passed inside the `user` role (JSON-encoded) and never concatenated into the `system` prompt, neutralizing prompt injection attacks.
4. **1x Repair Retry Loop**: If an LLM returns invalid JSON or an unauthorized enum, JobPulse captures the Zod validation error, sends it back to the model once to self-correct, and only quarantines to `logs/quarantine.jsonl` with HTTP 422 if the repair fails.
5. **Timeout Guard**: Strict 30-second client timeout returning clean `504 Gateway Timeout` rather than hanging.
6. **Retry Policy**: Exponential backoff with jitter on 429 and 5xx errors; fast-fail with 0 retries on 400, 401, or 403 to prevent burning quota.

---

## 💡 What I'd Fix With Another Day
With an extra day, I would implement **streaming parser validation with a dual-LLM sanitizer pattern** to intercept prompt injection attempts at the edge and cache embedding vectors in pgvector for semantic job deduplication across multiple job boards.

---

## 📄 License
MIT © [Abubakar Ahmed](https://github.com/abubakar-ahmed-dev)
