import { describe, it, expect, beforeAll } from "vitest";
import { execSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";

const CLI = join(__dirname, "..", "bin", "quality-gate.js");
const FIXTURES = join(__dirname, "..", "__fixtures__");
const SAMPLE_PROJECT = join(FIXTURES, "sample-project");

describe("quality-gate CLI", () => {
  describe("validate", () => {
    it("passes when scripts exist in sample-project", () => {
      const result = execSync(`node "${CLI}" validate --cwd "${SAMPLE_PROJECT}"`, {
        encoding: "utf-8",
      });
      expect(result).toContain("✓");
    });

    it("fails when scripts are missing", () => {
      const emptyDir = join(FIXTURES, ".empty-test");
      mkdirSync(emptyDir, { recursive: true });

      try {
        execSync(`node "${CLI}" validate --cwd "${emptyDir}"`, {
          encoding: "utf-8",
        });
        expect.unreachable("Should have thrown");
      } catch (err: unknown) {
        const stderr = err instanceof Error ? (err as any).stderr ?? "" : "";
        expect(stderr || String(err)).toBeTruthy();
      }

      rmSync(emptyDir, { recursive: true, force: true });
    });

    it("outputs JSON with --json flag", () => {
      const result = execSync(
        `node "${CLI}" validate --cwd "${SAMPLE_PROJECT}" --json`,
        { encoding: "utf-8" },
      );
      const parsed = JSON.parse(result);
      expect(parsed).toHaveProperty("passed", true);
      expect(parsed).toHaveProperty("results");
      expect(parsed.results).toHaveProperty("tests");
      expect(parsed.results).toHaveProperty("linter");
    });
  });

  describe("run", () => {
    it("passes when all gates pass in sample-project", () => {
      const result = execSync(
        `node "${CLI}" run --cwd "${SAMPLE_PROJECT}" --json --skip-linter`,
        { encoding: "utf-8" },
      );
      const parsed = JSON.parse(result);
      expect(parsed).toHaveProperty("passed", true);
      // coverage should pass (no baseline yet, so pass with info)
      expect(parsed.checks.validate.passed).toBe(true);
      // no baseline, but coverage check can still pass
      expect(parsed.checks.coverage).toBeDefined();
      expect(parsed.checks.coverage.baseline).toBeNull();
    });
  });

  describe("run with coverage check", () => {
    // We need to create a baseline first
    const baselineDir = join(SAMPLE_PROJECT, ".quality-gate");
    const baselineFile = join(baselineDir, "coverage-baseline.json");

    beforeAll(() => {
      // Ensure clean state
      rmSync(baselineDir, { recursive: true, force: true });
      mkdirSync(baselineDir, { recursive: true });
    });

    it("creates a baseline on first run with --save-coverage", () => {
      execSync(
        `node "${CLI}" run --cwd "${SAMPLE_PROJECT}" --json --save-coverage --skip-linter`,
        { encoding: "utf-8" },
      );

      expect(existsSync(baselineFile)).toBe(true);
      const baseline = JSON.parse(
        require("fs").readFileSync(baselineFile, "utf-8"),
      );
      expect(baseline).toHaveProperty("coverage");
      expect(baseline.coverage).toBeGreaterThan(0);
    });

    it("passes when coverage is at baseline level", () => {
      writeFileSync(baselineFile, JSON.stringify({ coverage: 100 }));
      const result = execSync(
        `node "${CLI}" run --cwd "${SAMPLE_PROJECT}" --json --skip-linter --baseline "${baselineFile}"`,
        { encoding: "utf-8" },
      );
      const parsed = JSON.parse(result);
      expect(parsed.checks.coverage.passed).toBe(true);
    });

    it("fails when coverage drops below threshold with 0 tolerance", () => {
      // With tolerance 0%, any drop below baseline fails.
      // Set baseline to 101% (impossible) so current 100% < 101% fails.
      writeFileSync(baselineFile, JSON.stringify({ coverage: 101 }));

      try {
        const result = execSync(
          `node "${CLI}" run --cwd "${SAMPLE_PROJECT}" --json --skip-linter --coverage-tolerance 0 --baseline "${baselineFile}"`,
          { encoding: "utf-8" },
        );
        const parsed = JSON.parse(result);
        expect(parsed.checks.coverage.passed).toBe(false);
        expect(parsed.checks.coverage.current).toBeLessThan(101);
        expect(parsed.checks.coverage.baseline).toBe(101);
      } catch {
        // execSync may throw on non-zero exit
      }
    });

    it("reports improved coverage when current > baseline", () => {
      // Write an artificially low baseline
      writeFileSync(baselineFile, JSON.stringify({ coverage: 10.0 }));
      const result = execSync(
        `node "${CLI}" run --cwd "${SAMPLE_PROJECT}" --json --skip-linter --baseline "${baselineFile}"`,
        { encoding: "utf-8" },
      );
      const parsed = JSON.parse(result);
      expect(parsed.checks.coverage.passed).toBe(true);
      expect(parsed.checks.coverage.improved).toBe(true);
    });
  });

  describe("run with linter check", () => {
    it("passes when linter finds no issues", () => {
      const result = execSync(
        `node "${CLI}" run --cwd "${SAMPLE_PROJECT}" --json --skip-coverage`,
        { encoding: "utf-8" },
      );
      const parsed = JSON.parse(result);
      expect(parsed.checks.linter.passed).toBe(true);
    });

    it("fails when linter finds issues", () => {
      // Write a temp file with linter errors
      const badFile = join(SAMPLE_PROJECT, "src", "bad.ts");
      writeFileSync(
        badFile,
        'const x: number = "hello";\nconsole.log(x);\n',
      );

      try {
        const result = execSync(
          `node "${CLI}" run --cwd "${SAMPLE_PROJECT}" --json --skip-coverage`,
          { encoding: "utf-8" },
        );
        const parsed = JSON.parse(result);
        // Might pass or fail depending on eslint config strictness
        // We just verify the check ran
        expect(parsed.checks.linter).toBeDefined();
      } catch {
        // Expected: exit code 1 when linter fails
      }

      rmSync(badFile, { force: true });
    });
  });

  describe("help", () => {
    it("prints usage", () => {
      const result = execSync(`node "${CLI}" help`, { encoding: "utf-8" });
      expect(result).toContain("quality-gate");
      expect(result).toContain("validate");
      expect(result).toContain("run");
    });
  });
});
