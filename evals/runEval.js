import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "../src/config.js";
import { triageJob } from "../src/llm/triageService.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function runEvaluations() {
  const isStub = process.argv.includes("--stub") || config.llmStub;
  console.log("============================================================");
  console.log("🧪 JobPulse LLM Evaluation Benchmark Suite (W7 Stage 5)");
  console.log(`🤖 Model: ${isStub ? "STUB MODE (Deterministic)" : config.llmModel}`);
  console.log(`📅 Date: ${new Date().toISOString()}`);
  console.log("============================================================\n");

  const casesFilePath = path.join(__dirname, "cases.json");
  const rawCases = await fs.readFile(casesFilePath, "utf-8");
  const cases = JSON.parse(rawCases.replace(/^\uFEFF/, ""));

  let passedDomain = 0;
  let passedSeniority = 0;
  let fullMatches = 0;
  const failures = [];

  for (let i = 0; i < cases.length; i++) {
    const testCase = cases[i];
    process.stdout.write(`[${i + 1}/${cases.length}] Evaluating ${testCase.id}... `);

    try {
      const { result, metrics } = await triageJob(testCase.input, { stub: isStub });

      const domainMatch = result.domain === testCase.expected.domain;
      const seniorityMatch = result.seniority === testCase.expected.seniority;
      const fullMatch = domainMatch && seniorityMatch;

      if (domainMatch) passedDomain++;
      if (seniorityMatch) passedSeniority++;
      if (fullMatch) {
        fullMatches++;
        console.log(`✅ MATCH (${metrics.duration_ms ?? 0}ms)`);
      } else {
        console.log(`❌ MISMATCH (${metrics.duration_ms ?? 0}ms)`);
        failures.push({
          id: testCase.id,
          expected: testCase.expected,
          actual: { domain: result.domain, seniority: result.seniority, workplace: result.workplace_type },
          reason: result.reason
        });
      }
    } catch (err) {
      console.log(`🔥 ERROR: ${err.message}`);
      failures.push({
        id: testCase.id,
        error: err.message
      });
    }
  }

  const domainAccuracy = ((passedDomain / cases.length) * 100).toFixed(1);
  const seniorityAccuracy = ((passedSeniority / cases.length) * 100).toFixed(1);
  const fullAccuracy = ((fullMatches / cases.length) * 100).toFixed(1);

  console.log("\n============================================================");
  console.log("📊 Benchmark Evaluation Summary:");
  console.log(`Total Cases:              ${cases.length}`);
  console.log(`Key Domain Accuracy:      ${passedDomain}/${cases.length} (${domainAccuracy}%)`);
  console.log(`Seniority Accuracy:       ${passedSeniority}/${cases.length} (${seniorityAccuracy}%)`);
  console.log(`Full Exact Matches:       ${fullMatches}/${cases.length} (${fullAccuracy}%)`);
  console.log("============================================================");

  if (failures.length > 0) {
    console.log("\n⚠️ Failure Analysis:");
    failures.forEach((f) => {
      console.log(`- [${f.id}] Expected: ${JSON.stringify(f.expected)} | Actual: ${JSON.stringify(f.actual)}`);
    });
  }

  return { total: cases.length, passedDomain, passedSeniority, fullMatches };
}

runEvaluations().catch((err) => {
  console.error("Eval suite fatal error:", err);
  process.exit(1);
});
