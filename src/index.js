import express from "express";
import { config } from "./config.js";
import { jobsRouter } from "./routes/jobs.js";

const app = express();

// Standard middleware
app.use(express.json({ limit: "1mb" }));

// Request logger for observability
app.use((req, res, next) => {
  const start = Date.now();
  res.on("finish", () => {
    const duration = Date.now() - start;
    console.log(`[HTTP] ${req.method} ${req.originalUrl} -> ${res.statusCode} (${duration}ms)`);
  });
  next();
});

// Mount Routes
app.use("/api/v1/jobs", jobsRouter);

// Root informational endpoint
app.get("/", (req, res) => {
  res.json({
    name: "JobPulse API",
    version: "1.0.0",
    docs: "See README.md for runnable curls and API specifications",
    endpoints: [
      "GET  /api/v1/jobs/health",
      "POST /api/v1/jobs/triage",
      "POST /api/v1/jobs/batch-triage"
    ]
  });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({ error: "Route not found", path: req.originalUrl });
});

// Start server only when executed directly as main script
const isMainModule = process.argv[1] && (process.argv[1].endsWith("index.js") || process.argv[1].endsWith("index"));
if (process.env.NODE_ENV !== "test" && isMainModule) {
  app.listen(config.port, () => {
    console.log("============================================================");
    console.log(`⚡ JobPulse API Server running at http://localhost:${config.port}`);
    console.log(`🛡️ Stub Mode: ${config.llmStub ? "ENABLED (Zero-cost local testing)" : "DISABLED (Live model calls)"}`);
    console.log(`🔌 LLM Provider: ${config.llmBaseUrl} | Model: ${config.llmModel}`);
    console.log(`🔴 Kill Switch: ${config.llmEnabled ? "OFF (LLM Active)" : "ON (Safe fallback mode)"}`);
    console.log("============================================================");
  });
}

export default app;
