/**
 * @param {import('./types.js').QualityGateResult} result
 * @returns {string}
 */
export function formatText(result) {
  const lines = [];
  const width = 50;
  lines.push("\u2500".repeat(width));
  lines.push("  quality-gate");

  for (const [name, check] of Object.entries(result.checks)) {
    const icon = check.passed ? "\u2713" : "\u2717";
    const msg = check.message ?? (check.passed ? "passed" : "failed");
    lines.push(`  ${icon} ${name}: ${msg}`);
  }

  lines.push("\u2500".repeat(width));
  lines.push(`  Result: ${result.passed ? "PASSED" : "FAILED"}`);

  // Append fix instructions if present
  if (result.fixInstructions) {
    for (const instr of Object.values(result.fixInstructions)) {
      if (instr) {
        lines.push("");
        lines.push(instr);
      }
    }
  }

  return lines.join("\n");
}
