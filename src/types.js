// Shared types for quality-gate checks (JSDoc for documentation)

/**
 * @typedef {Object} CheckResult
 * @property {boolean} passed
 * @property {string} [output]
 * @property {string} [message]
 */

/**
 * @typedef {CheckResult & {summary?: string, errorCount?: number}} LintCheckResult
 */

/**
 * @typedef {CheckResult & {current: number, baseline: number|null, baselineFile: string|null, improved: boolean}} CoverageCheckResult
 */

/**
 * @typedef {Object} IstanbulReport
 * @property {Object} total
 * @property {{total: number, covered: number, pct: number}} total.lines
 * @property {{total: number, covered: number, pct: number}} total.statements
 * @property {{total: number, covered: number, pct: number}} total.functions
 * @property {{total: number, covered: number, pct: number}} total.branches
 */

/**
 * @typedef {Object} RunOptions
 * @property {string} cwd
 * @property {boolean} [skipCoverage]
 * @property {boolean} [skipLinter]
 * @property {string} [baseline]
 * @property {boolean} [saveCoverage]
 * @property {number} [coverageTolerance]
 * @property {string} [testsScript]
 * @property {string} [linterScript]
 */

/**
 * @typedef {Object} ValidateOptions
 * @property {string} cwd
 * @property {string} [testsScript]
 * @property {string} [linterScript]
 */

/**
 * @typedef {Object} QualityGateResult
 * @property {boolean} passed
 * @property {string} message
 * @property {{validate: CheckResult, linter?: LintCheckResult, coverage?: CoverageCheckResult}} checks
 * @property {{linter?: string, coverage?: string}} [fixInstructions]
 */

export {};
