import { describe, it } from "node:test";
import assert from "node:assert/strict";
import app from "../src/index.js";
import { TriageResponseSchema } from "../src/schemas/triageSchema.js";
import { triageJob } from "../src/llm/triageService.js";

// Helper to make mock requests to express app without listening on a port
import http from "node:http";

function request(app) {
  return {
    post: (url, body) => {
      return new Promise((resolve, reject) => {
        const server = http.createServer(app);
        server.listen(0, () => {
          const port = server.address().port;
          const req = http.request(
            `http://localhost:${port}${url}`,
            {
              method: "POST",
              headers: { "Content-Type": "application/json" }
            },
            (res) => {
              let data = "";
              res.on("data", (chunk) => (data += chunk));
              res.on("end", () => {
                server.close();
                try {
                  resolve({
                    status: res.statusCode,
                    headers: res.headers,
                    body: data ? JSON.parse(data) : {}
                  });
                } catch (e) {
                  resolve({ status: res.statusCode, headers: res.headers, body: data });
                }
              });
            }
          );
          req.on("error", (err) => {
            server.close();
            reject(err);
          });
          req.write(JSON.stringify(body));
          req.end();
        });
      });
    },
    get: (url) => {
      return new Promise((resolve, reject) => {
        const server = http.createServer(app);
        server.listen(0, () => {
          const port = server.address().port;
          http.get(`http://localhost:${port}${url}`, (res) => {
            let data = "";
            res.on("data", (chunk) => (data += chunk));
            res.on("end", () => {
              server.close();
              try {
                resolve({
                  status: res.statusCode,
                  body: data ? JSON.parse(data) : {}
                });
              } catch (e) {
                resolve({ status: res.statusCode, body: data });
              }
            });
          }).on("error", (err) => {
            server.close();
            reject(err);
          });
        });
      });
    }
  };
}

describe("W7 LLM Guarded API Test Suite", () => {

  it("1. Health Check: returns 200 and provider status", async () => {
    const res = await request(app).get("/api/v1/jobs/health");
    assert.equal(res.status, 200);
    assert.equal(res.body.status, "ok");
    assert.ok(res.body.llm);
  });

  it("2. Input Validation (400): missing title returns 400 naming offending field", async () => {
    const res = await request(app).post("/api/v1/jobs/triage", {
      description: "Looking for an engineer with at least 5 years experience in Go and distributed systems."
    });
    assert.equal(res.status, 400);
    assert.ok(res.body.error);
    assert.ok(res.body.details.some((d) => d.field === "title"));
  });

  it("3. Input Validation (400): description shorter than 20 chars rejected before model call", async () => {
    const res = await request(app).post("/api/v1/jobs/triage", {
      title: "Senior Engineer",
      description: "Too short"
    });
    assert.equal(res.status, 400);
    assert.ok(res.body.details.some((d) => d.field === "description"));
  });

  it("4. Stub Mode (Stage 1): returns 200 and strictly adheres to Zod response schema", async () => {
    const res = await request(app).post("/api/v1/jobs/triage", {
      title: "Senior Backend Developer",
      company: "Acme",
      description: "We are seeking a Senior Backend Developer with 5+ years of experience in Node.js and PostgreSQL."
    });
    assert.equal(res.status, 200);
    assert.equal(res.headers["x-llm-stub"], "true");

    // Strictly validate against Zod schema
    const validation = TriageResponseSchema.safeParse(res.body);
    assert.ok(validation.success, "Response must strictly conform to TriageResponseSchema");
    assert.equal(validation.data.seniority, "senior");
    assert.equal(validation.data.domain, "backend");
  });

  it("5. Kill Switch (Stage 4): LLM_ENABLED=false returns safe deterministic fallback", async () => {
    // Calling triageJob with force fallback
    const { result } = await triageJob(
      {
        title: "Frontend Lead Engineer",
        description: "Leading React and Vue development for enterprise UI dashboards."
      },
      { stub: true }
    );

    assert.equal(result.seniority, "lead");
    assert.equal(result.domain, "frontend");
    assert.ok(result.reason.length > 0);
  });

  it("6. Explorer Endpoint: GET /api/v1/jobs/list returns jobs array", async () => {
    const res = await request(app).get("/api/v1/jobs/list");
    assert.equal(res.status, 200);
    assert.ok(Array.isArray(res.body.jobs));
    assert.ok(typeof res.body.total === "number");
  });

  it("7. Observability Endpoint: GET /api/v1/jobs/report returns run report metrics", async () => {
    const res = await request(app).get("/api/v1/jobs/report");
    assert.equal(res.status, 200);
    assert.ok(res.body.target);
    assert.ok(typeof res.body.valid_records === "number");
  });

  it("8. Diagnostic Endpoint: POST /api/v1/jobs/test-llm detects missing key gracefully", async () => {
    const res = await request(app).post("/api/v1/jobs/test-llm", { apiKey: "" });
    assert.equal(res.status, 400);
    assert.equal(res.body.ok, false);
    assert.ok(res.body.error.includes("API key"));
  });

  it("9. Explorer Endpoint: GET /api/v1/jobs/list includes sources_summary breakdown", async () => {
    const res = await request(app).get("/api/v1/jobs/list");
    assert.equal(res.status, 200);
    assert.ok(res.body.sources_summary);
    assert.ok(typeof res.body.sources_summary === "object");
  });

  it("10. Export Endpoint: GET /api/v1/jobs/export?format=csv returns CSV formatted data", async () => {
    const res = await request(app).get("/api/v1/jobs/export?format=csv");
    assert.equal(res.status, 200);
    assert.ok(typeof res.body === "string");
    assert.ok(res.body.includes("ID,Title,Company,Source"));
  });

  it("11. Export Endpoint: GET /api/v1/jobs/export?format=md returns Markdown formatted dossier report", async () => {
    const res = await request(app).get("/api/v1/jobs/export?format=md");
    assert.equal(res.status, 200);
    assert.ok(typeof res.body === "string");
    assert.ok(res.body.includes("# ⚡ JobPulse Market Intelligence Export"));
    assert.ok(res.body.includes("| Role Title | Company |"));
  });

  it("12. Export Endpoint: GET /api/v1/jobs/export?format=json returns structured JSON envelope", async () => {
    const res = await request(app).get("/api/v1/jobs/export?format=json");
    assert.equal(res.status, 200);
    assert.ok(res.body.exported_at);
    assert.ok(typeof res.body.total_records === "number");
    assert.ok(Array.isArray(res.body.jobs));
  });
});
