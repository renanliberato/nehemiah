import { existsSync, accessSync, constants } from "node:fs";
import { resolve } from "node:path";

/**
 * Validate that the required convention scripts exist and are executable.
 * @param {import('../types.js').ValidateOptions} opts
 * @returns {Promise<{passed: boolean, results: Record<string, import('../types.js').CheckResult>}>}
 */
export async function validateScripts(opts) {
  const testsScript = opts.testsScript ?? "./scripts/quality-gate-tests";
  const linterScript = opts.linterScript ?? "./scripts/quality-gate-linter";

  const scripts = [
    { name: "tests", path: testsScript },
    { name: "linter", path: linterScript },
  ];

  /** @type {Record<string, import('../types.js').CheckResult>} */
  const results = {};
  let allPassed = true;

  for (const { name, path } of scripts) {
    const absPath = resolve(opts.cwd, path);
    if (!existsSync(absPath)) {
      results[name] = { passed: false, message: `Missing: ${path}` };
      allPassed = false;
      continue;
    }

    try {
      accessSync(absPath, constants.X_OK);
      results[name] = { passed: true, message: `Found: ${path}` };
    } catch {
      results[name] = { passed: false, message: `Not executable: ${path}` };
      allPassed = false;
    }
  }

  return { passed: allPassed, results };
}
