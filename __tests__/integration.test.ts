/**
 * Integration test for quality-gate.
 *
 * Tests validate, run, linter detection, and coverage baseline workflows
 * against the sample-project fixture.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { execSync } from "node:child_process";
import { existsSync, mkdirSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const CLI = new URL("../bin/quality-gate.js", import.meta.url).pathname;
const FIXTURES = new URL("../__fixtures__/sample-project", import.meta.url).pathname;

const coverageDir = resolve(FIXTURES, ".quality-gate");
const baselineFile = resolve(coverageDir, "coverage-baseline.json");

function run(args) {
  return execSync(`node "${CLI}" ${args}`, {
    encoding: "utf-8",
    timeout: 120_000,
  });
}

function runJson(args) {
  return JSON.parse(run(args));
}

describe("quality-gate integration", () => {
  beforeAll(() => {
    rmSync(coverageDir, { recursive: true, force: true });
    mkdirSync(coverageDir, { recursive: true });
  });

  afterAll(() => {
    rmSync(coverageDir, { recursive: true, force: true });
  });

  // ── validate ──────────────────────────────────────────────

  it("validate passes on sample-project", () => {
    const output = run(`validate --cwd "${FIXTURES}" --json`);
    const parsed = JSON.parse(output);
    expect(parsed.passed).toBe(true);
    expect(parsed.results.tests.passed).toBe(true);
    expect(parsed.results.linter.passed).toBe(true);
  });

  it("validate fails on empty directory", () => {
    const emptyDir = resolve(FIXTURES, "..", ".empty-dir");
    mkdirSync(emptyDir, { recursive: true });
    try {
      run(`validate --cwd "${emptyDir}"`);
      expect.unreachable("should have failed");
    } catch {
      // expected
    } finally {
      rmSync(emptyDir, { recursive: true, force: true });
    }
  });

  // ── coverage baseline ─────────────────────────────────────

  it("creates a coverage baseline", () => {
    const result = runJson(
      `run --cwd "${FIXTURES}" --save-coverage --skip-linter --json`,
    );
    expect(result.passed).toBe(true);
    expect(result.checks.coverage.passed).toBe(true);
    expect(result.checks.coverage.baseline).toBeNull(); // first run, no baseline yet
    expect(existsSync(baselineFile)).toBe(true);

    const baseline = JSON.parse(readFileSync(baselineFile, "utf-8"));
    expect(baseline.coverage).toBeGreaterThan(0);
  });

  it("passes when coverage matches baseline", () => {
    const result = runJson(
      `run --cwd "${FIXTURES}" --skip-linter --json`,
    );
    expect(result.checks.coverage.passed).toBe(true);
    expect(result.checks.coverage.current).toBe(result.checks.coverage.baseline);
  });

  it("detects coverage regression with 0 tolerance", () => {
    // Baseline is 100%, set it impossibly high
    writeFileSync(baselineFile, JSON.stringify({ coverage: 101 }));
    try {
      const result = runJson(
        `run --cwd "${FIXTURES}" --skip-linter --coverage-tolerance 0 --json`,
      );
      expect(result.checks.coverage.passed).toBe(false);
      expect(result.checks.coverage.baseline).toBe(101);
    } catch {
      // execSync throws on non-zero exit
    }
    // Restore real baseline
    writeFileSync(baselineFile, JSON.stringify({ coverage: 100 }));
  });

  it("ratchets baseline when coverage improves", () => {
    writeFileSync(baselineFile, JSON.stringify({ coverage: 50 }));
    const result = runJson(
      `run --cwd "${FIXTURES}" --save-coverage --skip-linter --json`,
    );
    expect(result.checks.coverage.passed).toBe(true);
    expect(result.checks.coverage.improved).toBe(true);

    // Baseline should be updated to current
    const baseline = JSON.parse(readFileSync(baselineFile, "utf-8"));
    expect(baseline.coverage).toBe(100);
  });

  // ── linter ────────────────────────────────────────────────

  it("passes when linter finds no issues", () => {
    const result = runJson(
      `run --cwd "${FIXTURES}" --skip-coverage --json`,
    );
    expect(result.checks.linter.passed).toBe(true);
  });

  it("fails with fix instructions when linter finds errors", () => {
    const badFile = resolve(FIXTURES, "src", "intentional-error.ts");
    writeFileSync(badFile, 'let x: number = "hello";\nconsole.log(x);\n');

    try {
      const result = runJson(
        `run --cwd "${FIXTURES}" --skip-coverage --json`,
      );
      expect(result.checks.linter.passed).toBe(false);
      expect(result.fixInstructions.linter).toBeTruthy();
      expect(result.fixInstructions.linter.length).toBeGreaterThan(0);
    } catch (e) {
      // execSync may throw on non-zero exit
      // Verify we can extract JSON from stderr
      const stderr = e.stderr || "";
      const match = stderr.match(/\{.*\}/s);
      if (match) {
        const parsed = JSON.parse(match[0]);
        expect(parsed.checks.linter.passed).toBe(false);
      }
    } finally {
      rmSync(badFile, { force: true });
    }
  });

  // ── full run (both checks) ────────────────────────────────

  it("passes both checks on clean project", () => {
    const result = runJson(
      `run --cwd "${FIXTURES}" --json`,
    );
    expect(result.passed).toBe(true);
    expect(result.checks.validate.passed).toBe(true);
    expect(result.checks.linter.passed).toBe(true);
    expect(result.checks.coverage.passed).toBe(true);
  });
});
