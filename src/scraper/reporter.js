import fs from "node:fs/promises";
import path from "node:path";
import { config } from "../config.js";
import { RunReportSchema } from "../schemas/jobSchema.js";

/**
 * Creates and writes output/run-report.json.
 */
export async function writeRunReport(reportData) {
  await fs.mkdir(config.outputDir, { recursive: true });
  const validatedReport = RunReportSchema.parse(reportData);
  const reportPath = path.join(config.outputDir, "run-report.json");

  await fs.writeFile(reportPath, JSON.stringify(validatedReport, null, 2), "utf-8");
  return validatedReport;
}
