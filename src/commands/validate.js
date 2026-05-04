import { validateScripts } from "../checks/validate.js";

/**
 * @param {import('../types.js').ValidateOptions} opts
 * @returns {Promise<{passed: boolean, results: Record<string, import('../types.js').CheckResult>}>}
 */
export async function runValidate(opts) {
  return await validateScripts(opts);
}
