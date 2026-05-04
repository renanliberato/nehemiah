#!/usr/bin/env node

import { runGate } from "../src/commands/run.js";
import { runValidate } from "../src/commands/validate.js";
import { formatText } from "../src/format.js";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

async function main() {
  const args = process.argv.slice(2);
  const command = args[0];

  // Parse common flags
  const cwd = resolve(extractFlag(args, "--cwd") ?? process.cwd());
  const jsonOutput = args.includes("--json");

  switch (command) {
    case "validate": {
      const testsScript = extractFlag(args, "--tests-script") ?? "./scripts/quality-gate-tests";
      const linterScript = extractFlag(args, "--linter-script") ?? "./scripts/quality-gate-linter";

      const result = await runValidate({ cwd, testsScript, linterScript });

      if (jsonOutput) {
        process.stdout.write(JSON.stringify(result, null, 2) + "\n");
      } else {
        for (const [name, check] of Object.entries(result.results)) {
          const icon = check.passed ? "\u2713" : "\u2717";
          process.stdout.write(`  ${icon} ${name}: ${check.message}\n`);
        }
      }

      process.exit(result.passed ? 0 : 1);
      break;
    }

    case "run": {
      const skipCoverage = args.includes("--skip-coverage");
      const skipLinter = args.includes("--skip-linter");
      const saveCoverage = args.includes("--save-coverage");
      const coverageToleranceStr = extractFlag(args, "--coverage-tolerance");
      const coverageTolerance = coverageToleranceStr ? parseFloat(coverageToleranceStr) : undefined;
      const baseline = extractFlag(args, "--baseline");
      const testsScript = extractFlag(args, "--tests-script") ?? "./scripts/quality-gate-tests";
      const linterScript = extractFlag(args, "--linter-script") ?? "./scripts/quality-gate-linter";

      // Read settings from .pi/settings.json if it exists
      const settingsPath = resolve(cwd, ".pi", "settings.json");
      let settings = {};
      if (existsSync(settingsPath)) {
        try {
          settings = JSON.parse(readFileSync(settingsPath, "utf-8"));
        } catch {
          // ignore corrupt settings
        }
      }

      const qgSettings = settings?.qualityGate ?? {};

      const opts = {
        cwd,
        skipCoverage: skipCoverage || qgSettings.checkCoverage === false,
        skipLinter: skipLinter || qgSettings.checkLinter === false,
        saveCoverage: saveCoverage || qgSettings.saveBaseline === true,
        coverageTolerance,
        baseline,
        testsScript: qgSettings.scripts?.tests ?? testsScript,
        linterScript: qgSettings.scripts?.linter ?? linterScript,
      };

      const result = await runGate(opts);

      if (jsonOutput || !process.stdout.isTTY) {
        process.stdout.write(JSON.stringify(result, null, 2) + "\n");
      } else {
        process.stdout.write(formatText(result) + "\n");
      }

      process.exit(result.passed ? 0 : 1);
      break;
    }

    case "help":
    case "--help":
    case "-h": {
      printHelp();
      process.exit(0);
    }
    default: {
      // No command given or unknown command — show help
      if (command !== undefined) {
        process.stderr.write(`Unknown command: ${command}\n\n`);
      }
      printHelp();
      process.exit(command === undefined ? 0 : 1);
    }
  }
}

function printHelp() {
  process.stdout.write(`
quality-gate <command> [options]

Commands:
  validate              Check that convention scripts exist and are executable
  run                   Run quality gate checks (coverage + linter)

Options:
  --cwd <path>          Working directory (default: cwd)
  --json                Output as JSON
  --verbose             Show detailed output

Run options:
  --skip-coverage       Skip coverage check
  --skip-linter         Skip linter check
  --save-coverage       Save current coverage as new baseline
  --baseline <path>     Coverage baseline file (default: .quality-gate/coverage-baseline.json)
  --coverage-tolerance  Relative tolerance % (default: 5)

Validate options:
  --tests-script <path> Path to test script (default: ./scripts/quality-gate-tests)
  --linter-script <path> Path to linter script (default: ./scripts/quality-gate-linter)
`);
}

function extractFlag(args, name) {
  const idx = args.indexOf(name);
  if (idx !== -1 && idx + 1 < args.length) {
    return args[idx + 1];
  }
  // Also handle --key=value format
  for (const arg of args) {
    if (arg.startsWith(`${name}=`)) {
      return arg.slice(name.length + 1);
    }
  }
  return undefined;
}

main().catch((err) => {
  process.stderr.write(`Error: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(2);
});
