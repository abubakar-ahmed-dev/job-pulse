import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, "..");

export const config = {
  port: parseInt(process.env.PORT || "3000", 10),
  nodeEnv: process.env.NODE_ENV || "development",
  
  // LLM Settings
  llmBaseUrl: process.env.LLM_BASE_URL || "https://openrouter.ai/api/v1",
  llmModel: process.env.LLM_MODEL || "openrouter/free",
  llmApiKey: process.env.LLM_API_KEY || "stub-mode",
  llmStub: process.env.LLM_STUB === "1" || process.env.LLM_STUB === "true",
  llmEnabled: process.env.LLM_ENABLED !== "false",
  llmTimeoutMs: parseInt(process.env.LLM_TIMEOUT_MS || "30000", 10),

  // Scraper Settings
  scraperUserAgent: process.env.SCRAPER_USER_AGENT || "JobPulse/1.0 (+https://github.com/abubakar-ahmed-dev/job-pulse; contact: abubakar.ahmed.dev@gmail.com)",
  scraperRequestDelayMs: parseInt(process.env.SCRAPER_REQUEST_DELAY_MS || "500", 10),
  scraperTimeoutMs: parseInt(process.env.SCRAPER_TIMEOUT_MS || "5000", 10),

  // Paths
  rootDir: ROOT_DIR,
  cacheDir: path.join(ROOT_DIR, "cache"),
  outputDir: path.join(ROOT_DIR, "output"),
  logsDir: path.join(ROOT_DIR, "logs"),
  fixturesDir: path.join(ROOT_DIR, "test", "fixtures"),
  promptsDir: path.join(ROOT_DIR, "prompts")
};
