import { execSync } from "node:child_process";
import { resolve } from "node:path";

/**
 * Run the linter check via ./scripts/quality-gate-linter.
 * @param {import('../types.js').RunOptions} opts
 * @returns {Promise<import('../types.js').LintCheckResult>}
 */
export async function checkLinter(opts) {
  const absCwd = resolve(opts.cwd);
  const linterScript = opts.linterScript ?? "./scripts/quality-gate-linter";
  const absScript = resolve(absCwd, linterScript);

  let output;
  try {
    output = execSync(`"${absScript}"`, {
      cwd: absCwd,
      timeout: 120_000,
      encoding: "utf-8",
    }).trim();
    return {
      passed: true,
      output,
      message: "No linting warnings or errors",
      errorCount: 0,
    };
  } catch (err) {
    if (err instanceof Error && "stdout" in err) {
      output = String(err.stdout).trim();
    } else {
      output = err instanceof Error ? err.message : String(err);
    }

    const lines = output.split("\n").filter((l) => l.trim().length > 0);
    return {
      passed: false,
      output,
      message: `${lines.length} linting issue(s) found`,
      errorCount: lines.length,
    };
  }
}
