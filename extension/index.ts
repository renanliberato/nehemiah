/**
 * quality-gate pi extension
 *
 * Hooks `turn_end` and runs quality-gate checks. If the gate fails, sends a
 * steer message to the agent instructing it to fix the issues. Tracks retry
 * budget via pi.appendEntry() to prevent infinite loops.
 *
 * Install: put this file in .pi/extensions/quality-gate.ts
 * Configure: add qualityGate section to .pi/settings.json
 */

import type { ExtensionAPI, ExtensionContext, TurnEndEvent } from "@mariozechner/pi-coding-agent";

const ENTRY_TYPE = "quality-gate-state";

interface GateState {
  attemptCount: number;
}

const DEFAULT_MAX_RETRIES = 3;

export default function (pi: ExtensionAPI) {
  pi.on("turn_end", async (event: TurnEndEvent, ctx: ExtensionContext) => {
    // 1. Check if quality gate is enabled
    const opts = loadOptions(ctx);
    if (!opts.enabled) return;

    // 2. Skip if turn made no code changes
    if (!didChangeCode(event)) return;

    // 3. Check retry budget
    const state = loadState(ctx);
    if (state.attemptCount >= opts.maxRetries) {
      ctx.ui.notify(
        `quality-gate: max retries (${opts.maxRetries}) reached, passing through`,
        "warn",
      );
      resetState();
      return;
    }

    // 4. Run the quality gate
    try {
      const result = await runGate(ctx.cwd, opts);

      // 5. Parse JSON result
      const gate = JSON.parse(result);

      // 6. All pass → done
      if (gate.passed) {
        ctx.ui.notify("quality-gate: all checks passed ✓", "success");

        // Save improved coverage as new baseline
        if (opts.saveBaseline && gate.checks?.coverage?.improved) {
          await pi.exec("quality-gate", [
            "run",
            "--cwd", ctx.cwd,
            "--save-coverage",
            "--skip-linter",
          ]);
        }

        resetState();
        return;
      }

      // 7. Gate failed — increment retry count and instruct agent
      const attempt = state.attemptCount + 1;
      saveState({ attemptCount: attempt });

      const fixMessage = buildFixMessage(gate, attempt, opts.maxRetries);

      ctx.ui.notify(
        `quality-gate: failed (attempt ${attempt}/${opts.maxRetries}), instructing agent to fix`,
        "error",
      );

      // Send as steer message so agent gets another turn
      pi.sendUserMessage(fixMessage, { deliverAs: "steer" });
    } catch (err) {
      // quality-gate CLI not found or other infrastructure error
      const msg = err instanceof Error ? err.message : String(err);
      ctx.ui.notify(`quality-gate: ${msg}`, "error");
    }
  });

  // --- helpers ---

  function loadState(ctx: ExtensionContext): GateState {
    const entries = ctx.sessionManager.getEntries();
    for (const entry of entries) {
      if (entry.type === "custom" && entry.customType === ENTRY_TYPE) {
        return (entry.data as GateState) ?? { attemptCount: 0 };
      }
    }
    return { attemptCount: 0 };
  }

  function saveState(state: GateState) {
    pi.appendEntry(ENTRY_TYPE, state);
  }

  function resetState() {
    saveState({ attemptCount: 0 });
  }
}

interface QualityGateOptions {
  enabled: boolean;
  maxRetries: number;
  saveBaseline: boolean;
  checkCoverage: boolean;
  checkLinter: boolean;
  coverageTolerance: number;
  baseline: string | undefined;
  testsScript: string;
  linterScript: string;
}

function loadOptions(ctx: ExtensionContext): QualityGateOptions {
  const defaults: QualityGateOptions = {
    enabled: true,
    maxRetries: DEFAULT_MAX_RETRIES,
    saveBaseline: true,
    checkCoverage: true,
    checkLinter: true,
    coverageTolerance: 5,
    baseline: undefined,
    testsScript: "./scripts/quality-gate-tests",
    linterScript: "./scripts/quality-gate-linter",
  };

  // Try to read from .pi/settings.json
  try {
    const fs = require("node:fs");
    const path = require("node:path");
    const settingsPath = path.join(ctx.cwd, ".pi", "settings.json");
    if (fs.existsSync(settingsPath)) {
      const settings = JSON.parse(fs.readFileSync(settingsPath, "utf-8"));
      const qg = settings.qualityGate ?? {};
      if (qg.enabled === false) defaults.enabled = false;
      if (typeof qg.maxRetries === "number") defaults.maxRetries = qg.maxRetries;
      if (qg.saveBaseline === false) defaults.saveBaseline = false;
      if (qg.checkCoverage === false) defaults.checkCoverage = false;
      if (qg.checkLinter === false) defaults.checkLinter = false;
      if (typeof qg.coverageTolerance === "number") defaults.coverageTolerance = qg.coverageTolerance;
      if (qg.baseline) defaults.baseline = qg.baseline;
      if (qg.scripts) {
        if (qg.scripts.tests) defaults.testsScript = qg.scripts.tests;
        if (qg.scripts.linter) defaults.linterScript = qg.scripts.linter;
      }
    }
  } catch {
    // Ignore settings errors
  }

  return defaults;
}

function didChangeCode(event: TurnEndEvent): boolean {
  // Check if this turn used any code-modifying tools
  return (
    event.toolResults?.some(
      (r) => r.toolName === "write" || r.toolName === "edit" || r.toolName === "bash",
    ) ?? false
  );
}

async function runGate(cwd: string, opts: QualityGateOptions): Promise<string> {
  const args: string[] = [
    "run",
    "--cwd", cwd,
    "--json",
    `--coverage-tolerance`, String(opts.coverageTolerance),
  ];

  if (opts.saveBaseline) args.push("--save-coverage");
  if (!opts.checkCoverage) args.push("--skip-coverage");
  if (!opts.checkLinter) args.push("--skip-linter");
  if (opts.baseline) {
    args.push("--baseline", opts.baseline);
  }
  if (opts.testsScript !== "./scripts/quality-gate-tests") {
    args.push("--tests-script", opts.testsScript);
  }
  if (opts.linterScript !== "./scripts/quality-gate-linter") {
    args.push("--linter-script", opts.linterScript);
  }

  const { execSync } = require("node:child_process");
  const result = execSync(`quality-gate ${args.join(" ")}`, {
    cwd,
    encoding: "utf-8",
    timeout: 600_000, // 10 min for tests + linter
  });

  return result.trim();
}

function buildFixMessage(gate: any, attempt: number, maxRetries: number): string {
  const parts: string[] = [];
  parts.push(`── quality-gate: FAILED (attempt ${attempt}/${maxRetries}) ──`);
  parts.push("");

  if (gate.fixInstructions) {
    if (gate.fixInstructions.linter) {
      parts.push("LINTER:");
      parts.push(gate.fixInstructions.linter);
      parts.push("");
    }
    if (gate.fixInstructions.coverage) {
      parts.push("COVERAGE:");
      parts.push(gate.fixInstructions.coverage);
      parts.push("");
    }
  }

  parts.push("Fix these issues. Do NOT respond with explanation — fix the code.");
  parts.push("── end ──");

  return parts.join("\n");
}
