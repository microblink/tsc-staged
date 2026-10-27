import { appendFileSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const workspace = process.env.GITHUB_WORKSPACE || process.cwd();
const summaryFile = process.env.GITHUB_STEP_SUMMARY;
const reportPath = resolve(workspace, "coverage", "coverage-summary.json");
const report = JSON.parse(readFileSync(reportPath, "utf8"));
const metrics = ["statements", "branches", "functions", "lines"];

const summary = [
  "## Test coverage",
  "",
  "| Metric | Coverage | Covered |",
  "| --- | ---: | ---: |",
  ...metrics.map((metric) => {
    const result = report.total[metric];
    const label = metric[0].toUpperCase() + metric.slice(1);
    return `| ${label} | ${result.pct}% | ${result.covered} / ${result.total} |`;
  }),
  "",
].join("\n");

if (summaryFile) {
  appendFileSync(summaryFile, summary);
} else {
  process.stdout.write(summary);
}
