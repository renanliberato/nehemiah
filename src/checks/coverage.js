import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { execSync } from "node:child_process";

const DEFAULT_TOLERANCE = 5; // percent relative

/**
 * Run the coverage check via ./scripts/quality-gate-tests.
 * @param {import('../types.js').RunOptions} opts
 * @returns {Promise<import('../types.js').CoverageCheckResult>}
 */
export async function checkCoverage(opts) {
  const testsScript = opts.testsScript ?? "./scripts/quality-gate-tests";
  const absCwd = resolve(opts.cwd);
  const absScript = resolve(absCwd, testsScript);
  const baselineFile = opts.baseline ?? resolve(absCwd, ".quality-gate", "coverage-baseline.json");

  // Create temp file for coverage report
  const tmpFile = resolve(absCwd, ".quality-gate", ".coverage-tmp.json");

  // Run tests
  try {
    execSync(`"${absScript}" "${tmpFile}"`, {
      cwd: absCwd,
      timeout: 300_000, // 5 min
      encoding: "utf-8",
    });
  } catch (err) {
    return {
      passed: false,
      current: 0,
      baseline: null,
      baselineFile: existsSync(baselineFile) ? baselineFile : null,
      improved: false,
      message: `Tests failed: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  // Parse coverage report
  if (!existsSync(tmpFile)) {
    return {
      passed: false,
      current: 0,
      baseline: null,
      baselineFile: existsSync(baselineFile) ? baselineFile : null,
      improved: false,
      message: "Test script did not produce a coverage report file",
    };
  }

  let report;
  try {
    report = JSON.parse(readFileSync(tmpFile, "utf-8"));
  } catch {
    return {
      passed: false,
      current: 0,
      baseline: null,
      baselineFile: existsSync(baselineFile) ? baselineFile : null,
      improved: false,
      message: "Coverage report is not valid JSON (expected Istanbul format)",
    };
  }

  const currentPct = report.total?.lines?.pct ?? report.total?.statements?.pct ?? 0;

  // Check against baseline
  if (!existsSync(baselineFile)) {
    // No baseline yet — pass, optionally save it
    if (opts.saveCoverage) {
      writeFileSync(baselineFile, JSON.stringify({ coverage: currentPct }, null, 2));
    }
    return {
      passed: true,
      current: currentPct,
      baseline: null,
      baselineFile: null,
      improved: false,
      message: `Coverage at ${currentPct}% (no baseline to compare)`,
    };
  }

  let baselinePct;
  try {
    const baselineData = JSON.parse(readFileSync(baselineFile, "utf-8"));
    baselinePct = baselineData.coverage;
  } catch {
    // Baseline exists but is corrupt — treat as no baseline
    if (opts.saveCoverage) {
      writeFileSync(baselineFile, JSON.stringify({ coverage: currentPct }, null, 2));
    }
    return {
      passed: true,
      current: currentPct,
      baseline: null,
      baselineFile: baselineFile,
      improved: false,
      message: `Coverage at ${currentPct}% (baseline corrupt, reset)`,
    };
  }

  const tolerance = opts.coverageTolerance ?? DEFAULT_TOLERANCE;
  const threshold = baselinePct * (1 - tolerance / 100);
  const improved = currentPct > baselinePct;
  const passed = currentPct >= threshold;

  // Save baseline if improved and saveCoverage is set
  if (improved && opts.saveCoverage) {
    writeFileSync(baselineFile, JSON.stringify({ coverage: currentPct }, null, 2));
  }

  return {
    passed,
    current: currentPct,
    baseline: baselinePct,
    baselineFile,
    improved,
    message: passed
      ? `Coverage at ${currentPct}% (baseline: ${baselinePct}%)`
      : `Coverage dropped from ${baselinePct}% to ${currentPct}%`,
  };
}
