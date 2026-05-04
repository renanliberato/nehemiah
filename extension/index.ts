/**
 * quality-gate pi extension
 *
 * Hooks `turn_end` and runs quality-gate checks in the background.
 * Shows UI feedback immediately, so the user sees something happening.
 * When the gate finishes, sends a steer message to the agent if it failed.
 * Tracks retry budget via pi.appendEntry() to prevent infinite loops.
 *
 * Install: put this file in .pi/extensions/quality-gate.ts
 * Configure: add qualityGate section to .pi/settings.json
 */

import type { ExtensionAPI, ExtensionContext, TurnEndEvent } from "@mariozechner/pi-coding-agent";
import { spawn } from "node:child_process";

const ENTRY_TYPE = "quality-gate-state";

interface GateState {
  attemptCount: number;
}

const DEFAULT_MAX_RETRIES = 3;
const STATUS_KEY = "quality-gate";

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

    const attempt = state.attemptCount + 1;

    // 4. Show feedback immediately — don't await the actual gate
    ctx.ui.setStatus(STATUS_KEY, "quality-gate: running tests + linter...");
    ctx.ui.setWidget(STATUS_KEY, [
      "── quality-gate ──",
      `  Attempt ${attempt}/${opts.maxRetries}`,
      "  Running tests + linter in background...",
      "",
    ]);

    // 5. Spawn quality-gate in background, return immediately.
    //    We save state up front so parallel turns don't double-run.
    //    On completion, we parse the result and either reset state (pass)
    //    or send a steer message (fail).
    const args = buildArgs(ctx.cwd, opts);
    const gatePid = spawnGate(pi, ctx.cwd, args, attempt, opts.maxRetries);
    saveState({ attemptCount: attempt });

    // Note: handler returns immediately. The TUI can now render the
    // notification and widget. The spawnGate callback handles the rest.
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
    pi.appendEntry(ENTRY_TYPE, { attemptCount: 0 });
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

function buildArgs(cwd: string, opts: QualityGateOptions): string[] {
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
  return args;
}

function spawnGate(
  pi: ExtensionAPI,
  cwd: string,
  args: string[],
  attempt: number,
  maxRetries: number,
): void {
  const child = spawn("quality-gate", args, {
    cwd,
    stdio: ["ignore", "pipe", "pipe"],
    timeout: 600_000,
  });

  let stdout = "";
  let stderr = "";

  child.stdout.on("data", (chunk: string) => {
    stdout += chunk;
  });

  child.stderr.on("data", (chunk: string) => {
    stderr += chunk;
  });

  child.on("error", (err: Error) => {
    // quality-gate not found, etc.
    pi.sendUserMessage(
      `── quality-gate: infrastructure error ──\n\n` +
        `${err.message}\n\n` +
        `Fix the issue or disable quality-gate in .pi/settings.json.\n` +
        `── end ──`,
      { deliverAs: "steer" },
    );
  });

  child.on("close", (code: number | null) => {
    // If process couldn't be spawned, error handler already fired
    if (code === null) return;
    if (code !== 0) {
      // Command itself failed (non-zero exit). Try to parse JSON from stdout
      // (the gate outputs JSON even on failure).
      let gate: any = null;
      try {
        gate = JSON.parse(stdout.trim());
      } catch {
        // Not valid JSON — infrastructure error (CLI missing, etc.)
        pi.sendUserMessage(
          `── quality-gate: FAILED (attempt ${attempt}/${maxRetries}) ──\n\n` +
            `quality-gate command exited with code ${code}\n` +
            (stderr ? `stderr: ${stderr.trim()}\n` : "") +
            (stdout ? `stdout: ${stdout.trim()}\n` : "") +
            `\nFix these issues. Do NOT respond with explanation — fix the code.\n` +
            `── end ──`,
          { deliverAs: "steer" },
        );
        return;
      }

      // Gate ran but checks failed — build fix instructions
      const fixMessage = buildFixMessage(gate, attempt, maxRetries);
      pi.sendUserMessage(fixMessage, { deliverAs: "steer" });
      return;
    }

    // Exit code 0 — all checks passed
    try {
      const gate = JSON.parse(stdout.trim());
      if (gate.passed) {
        resetState(pi);

        // Save improved coverage as new baseline
        if (gate.checks?.coverage?.improved) {
          const saveArgs = buildArgs(cwd, {
            enabled: true,
            maxRetries,
            saveBaseline: true,
            checkCoverage: true,
            checkLinter: true,
            coverageTolerance: 5,
            baseline: undefined,
            testsScript: "./scripts/quality-gate-tests",
            linterScript: "./scripts/quality-gate-linter",
          });
          // Remove --json so output goes to stderr
          const jsonIdx = saveArgs.indexOf("--json");
          if (jsonIdx >= 0) saveArgs.splice(jsonIdx, 1);
          spawn("quality-gate", [
            "run",
            "--cwd", cwd,
            "--save-coverage",
            "--skip-linter",
          ], { cwd, stdio: "ignore" });
        }
      }
    } catch {
      // Gate passed but JSON parsing failed — ignore, it passed.
    }
  });
}

function resetState(pi: ExtensionAPI) {
  pi.appendEntry(ENTRY_TYPE, { attemptCount: 0 });
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
