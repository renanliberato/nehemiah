import { validateScripts } from "../checks/validate.js";
import { checkCoverage } from "../checks/coverage.js";
import { checkLinter } from "../checks/linter.js";

/**
 * `quality-gate run` command handler.
 * @param {import('../types.js').RunOptions} opts
 * @returns {Promise<import('../types.js').QualityGateResult>}
 */
export async function runGate(opts) {
  // 1. Validate scripts exist
  const { passed: scriptsOk, results: scriptResults } = await validateScripts({
    cwd: opts.cwd,
    testsScript: opts.testsScript,
    linterScript: opts.linterScript,
  });

  const checks = {
    validate: { passed: scriptsOk, message: scriptsOk ? "Scripts found" : "Some scripts missing" },
  };

  // If validation fails, add individual script results
  if (!scriptsOk) {
    checks.validate.output = Object.entries(scriptResults)
      .map(([name, r]) => `  ${r.passed ? "\u2713" : "\u2717"} ${name}: ${r.message}`)
      .join("\n");
  }

  const fixParts = [];

  // 2. Linter check
  if (!opts.skipLinter) {
    try {
      const lintResult = await checkLinter(opts);
      checks.linter = lintResult;
    } catch (err) {
      checks.linter = {
        passed: false,
        message: err instanceof Error ? err.message : String(err),
        errorCount: -1,
      };
    }
    if (checks.linter && !checks.linter.passed && checks.linter.output) {
      fixParts.push(`Fix the following linter errors:\n${checks.linter.output}`);
    }
  }

  // 3. Coverage check
  if (!opts.skipCoverage) {
    try {
      const covResult = await checkCoverage(opts);
      checks.coverage = covResult;
    } catch (err) {
      checks.coverage = {
        passed: false,
        current: 0,
        baseline: null,
        baselineFile: null,
        improved: false,
        message: err instanceof Error ? err.message : String(err),
      };
    }
    if (checks.coverage && !checks.coverage.passed && checks.coverage.baseline !== null) {
      fixParts.push(
        `Coverage dropped from ${checks.coverage.baseline}% to ${checks.coverage.current}%. ` +
          `Add or improve tests to restore coverage to at least ${checks.coverage.baseline}%.`,
      );
    }
  }

  const allPassed = Object.values(checks).every((c) => c?.passed !== false);

  const fixInstructions = {};
  if (checks.linter && !checks.linter.passed) {
    fixInstructions.linter = fixParts.find((p) => p.startsWith("Fix the following linter errors:")) ?? "";
  }
  if (checks.coverage && !checks.coverage.passed) {
    fixInstructions.coverage = fixParts.find((p) => p.startsWith("Coverage dropped")) ?? "";
  }

  /** @type {import('../types.js').QualityGateResult} */
  const result = {
    passed: allPassed,
    message: allPassed
      ? "All quality gate checks passed"
      : "Quality gate failed — fix instructions sent",
    checks,
  };

  if (Object.keys(fixInstructions).length > 0) {
    result.fixInstructions = fixInstructions;
  }

  return result;
}
