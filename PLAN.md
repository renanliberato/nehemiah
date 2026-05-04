# quality-gate: Plan

A pi extension + CLI + skill trio that enforces **hard requirements** at the end of every agent turn:

1. **Test coverage must not regress** from a stored baseline
2. **Linter must pass with zero warnings** (warnings-as-errors)

If either check fails, the extension **tells the agent to fix it** — the agent iterates until the gate passes or the retry budget is exhausted.

---

## Core Loop

```
User sends prompt
  → Agent works (multiple turns)
  → Turn ends
  → turn_end fires
  → Extension runs quality-gate checks
  → If PASS:
      → Notify success, save new coverage baseline (if improved)
      → Allow next user prompt
  → If FAIL:
      → Send steer message to agent with specific failure details
      → Agent gets another turn to fix
      → On next turn_end, re-check
      → If retry budget exhausted → notify user, let it through
```

This is a **self-healing loop**: the agent cannot escape the gate by just responding — it must actually fix the issues.

---

## 1. CLI Tool: `quality-gate`

Language: **TypeScript**, distributed as npm package `@renanliberato/quality-gate`. Single binary entry point via `bin/quality-gate`.

### Commands

#### `quality-gate validate`

Check that the required convention scripts exist and are executable.

```
quality-gate validate [--cwd <path>]
```

- Exit 0 = all scripts found
- Exit 1 = one or more missing
- Exit 2 = validation error

#### `quality-gate run`

Run all checks and output JSON for the extension to consume.

```
quality-gate run [options]
  --cwd <path>                  Working directory (default: cwd)
  --skip-coverage               Skip coverage check
  --skip-linter                 Skip linter check
  --baseline <path>             Coverage baseline file (default: .quality-gate/coverage-baseline.json)
  --json                        JSON output (default: auto when piped, or explicit)
```

**Exit codes:**
- `0` — all checks pass
- `1` — one or more checks fail
- `2` — setup error (scripts missing, can't run)

**JSON output (always):**
```json
{
  "passed": false,
  "message": "Coverage dropped from 85.0% to 72.3%",
  "checks": {
    "validate": { "passed": true },
    "linter": {
      "passed": false,
      "output": "src/app.ts:12:5 - error: 'x' is never reassigned. Use 'const' instead.\nsrc/app.ts:45:3 - error: Unused variable 'temp'.",
      "summary": "2 warnings found"
    },
    "coverage": {
      "passed": false,
      "current": 72.3,
      "baseline": 85.0,
      "baselineFile": ".quality-gate/coverage-baseline.json",
      "improved": false
    }
  },
  "fixInstructions": {
    "linter": "Fix the following linter errors:\n- src/app.ts:12: 'x' is never reassigned. Use 'const' instead.\n- src/app.ts:45: Unused variable 'temp'.",
    "coverage": "Coverage dropped from 85.0% to 72.3%. Add or improve tests to restore coverage to at least 85.0%."
  }
}
```

The `fixInstructions` field is designed for the extension to forward directly to the agent as corrective instructions.

### Check logic

#### Coverage check

1. Run `./scripts/quality-gate-tests <tmpfile>` — the script must:
   - Run all tests
   - Output an Istanbul-format JSON coverage report to the given path
   - Exit 0 if tests pass, non-zero if tests fail
2. If tests fail → **FAIL** (test failures are always gate failures)
3. Parse `<tmpfile>` for `total.lines.pct` (or `total.statements.pct` as fallback)
4. Load baseline from `--baseline` path
5. If baseline exists:
   - Current >= 95% of baseline → **PASS** (allow small measurement noise, e.g., 85.0 → 84.5 flags but 85.0 → 84.9 doesn't)
   - Current < 95% of baseline → **FAIL**
   - Current > baseline → set `improved: true`
6. If no baseline yet → **PASS** (first run, nothing to regress against)
7. If `--save-coverage` flag is set and pass, write current report as new baseline

The 95% tolerance avoids thrashing on measurement noise while still catching real regressions. Configurable via `--coverage-tolerance <pct>`.

#### Linter check

1. Run `./scripts/quality-gate-linter` — the script must:
   - Run the linter with warnings-as-errors configuration
   - Exit 0 on zero warnings/errors
   - Exit non-zero otherwise
2. Exit 0 → **PASS**
3. Exit non-zero → **FAIL**, capture stdout/stderr for fix instructions

---

## 2. Pi Extension: `.pi/extensions/quality-gate.ts`

This is the heart of the system. It hooks `turn_end` and implements the self-healing loop.

### Event hook

```typescript
import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";

export default function (pi: ExtensionAPI) {
  pi.on("turn_end", async (event, ctx) => {
    // 1. Skip if quality gate is disabled
    if (!isEnabled(ctx)) return;

    // 2. Skip if this turn didn't involve code changes
    if (!didChangeCode(event, ctx)) return;

    // 3. Check retry budget
    const attempts = getAttemptCount(ctx);
    if (attempts >= getMaxRetries(ctx)) {
      ctx.ui.notify("quality-gate: max retries reached, skipping", "warn");
      return;
    }

    // 4. Run the quality gate
    const result = await pi.exec("quality-gate", [
      "run", "--cwd", ctx.cwd, "--json",
      ...(getBaselinePath(ctx) ? ["--baseline", getBaselinePath(ctx)] : []),
    ]);

    const gate = JSON.parse(result.stdout);

    // 5. If pass → done
    if (gate.passed) {
      ctx.ui.notify("quality-gate: all checks passed ✓", "success");
      // Optionally save improved coverage as new baseline
      if (gate.checks.coverage?.improved) {
        await pi.exec("quality-gate", ["run", "--cwd", ctx.cwd, "--save-coverage"]);
      }
      clearAttemptCount(ctx);
      return;
    }

    // 6. If fail → instruct agent to fix
    incrementAttemptCount(ctx);

    const fixMessage = buildFixMessage(gate, attempts + 1, getMaxRetries(ctx));

    // Send as steer message — agent will get another turn to fix
    pi.sendUserMessage(fixMessage, { deliverAs: "steer" });
  });
}
```

### Retry budget tracking

Uses `pi.appendEntry()` to persist retry count across turns within the same user prompt:

```typescript
const ENTRY_TYPE = "quality-gate-attempts";

function getAttemptCount(ctx: ExtensionContext): number {
  for (const entry of ctx.sessionManager.getEntries()) {
    if (entry.type === "custom" && entry.customType === ENTRY_TYPE) {
      return entry.data?.count ?? 0;
    }
  }
  return 0;
}

function incrementAttemptCount(ctx: ExtensionContext) {
  const current = getAttemptCount(ctx);
  pi.appendEntry(ENTRY_TYPE, { count: current + 1 });
}

function clearAttemptCount(ctx: ExtensionContext) {
  pi.appendEntry(ENTRY_TYPE, { count: 0 });
}
```

Max retries defaults to **3**, configurable in `.pi/settings.json`:
```json
{
  "qualityGate": {
    "enabled": true,
    "maxRetries": 3,
    "coverageTolerance": 5,
    "coverageBaseline": ".quality-gate/coverage-baseline.json",
    "scripts": {
      "tests": "./scripts/quality-gate-tests",
      "linter": "./scripts/quality-gate-linter"
    }
  }
}
```

### Fix message to the agent

The message sent to the agent looks like:

```
── quality-gate: FAILED (attempt 1/3) ──

LINTER:
src/app.ts:12:5 - error: 'x' is never reassigned. Use 'const' instead.
src/app.ts:45:3 - error: Unused variable 'temp'.

COVERAGE:
Coverage dropped from 85.0% to 72.3%.

Fix these issues. Do NOT respond with explanation — fix the code.
── end ──
```

Sharp, actionable, no chit-chat. The agent gets it as a steer message and will work on it in the next turn.

### Code-change detection heuristic

Skip the gate if the turn made no code-affecting tool calls:

```typescript
function didChangeCode(event, ctx): boolean {
  // event.toolResults contains all tool calls from this turn
  return event.toolResults?.some(r =>
    ["write", "edit", "bash"].includes(r.toolName)
  ) ?? false;
}
```

This avoids running tests/linters on turns where the agent only read files or responded to the user.

### First-time baseline creation

On the first pass where coverage check has no baseline:
- Gate passes (nothing to regress against yet)
- Extension auto-saves current coverage as `.quality-gate/coverage-baseline.json`
- Notifies: "quality-gate: baseline created at 85.0% ✓"

---

## 3. Convention Script Contract

### `./scripts/quality-gate-tests [report-path]`

Runs the project's test suite with coverage.

**Contract:**
- If `report-path` argument provided, write Istanbul-format JSON coverage report to that file
- If no argument, print report to stdout
- Exit 0 = tests pass (coverage data is still read)
- Exit non-zero = tests failed (gate fails regardless of coverage)
- Report format:
  ```json
  {
    "total": {
      "lines": { "total": 100, "covered": 85, "pct": 85.00 },
      "statements": { "total": 120, "covered": 100, "pct": 83.33 },
      "functions": { "total": 30, "covered": 25, "pct": 83.33 },
      "branches": { "total": 40, "covered": 30, "pct": 75.00 }
    }
  }
  ```

### `./scripts/quality-gate-linter`

Runs the linter with warnings as errors.

**Contract:**
- Exit 0 = no warnings or errors
- Exit non-zero = warnings or errors exist
- Output goes to stdout/stderr (captured by CLI for fix instructions)

---

## 4. SKILL: `quality-gate-setup`

Location: `.agents/skills/quality-gate-setup/SKILL.md`

Helps a developer bootstrap the two convention scripts (`quality-gate-tests`, `quality-gate-linter`) for their specific project language and tooling.

### SKILL workflow

1. **Detect** project language / framework by scanning for manifest files
2. **Detect** test framework (vitest, go test, cargo test, pytest, etc.)
3. **Detect** linter (eslint, golangci-lint, clippy, ruff, etc.)
4. **Generate** the two scripts with correct tooling commands
5. **Install** the quality-gate CLI via npm/pip/homebrew
6. **Configure** `.pi/extensions/quality-gate.ts` and `.pi/settings.json`

### Generated script examples per stack

**Node/TypeScript (vitest + eslint):**
```bash
#!/usr/bin/env bash
# scripts/quality-gate-tests
set -euo pipefail
npx vitest run --coverage --reporter=json --outputFile="$1"
```

```bash
#!/usr/bin/env bash
# scripts/quality-gate-linter
set -euo pipefail
npx eslint . --max-warnings=0
```

**Node/TypeScript (jest + eslint):**
```bash
#!/usr/bin/env bash
# scripts/quality-gate-tests
set -euo pipefail
npx jest --coverage --coverageReporters=json-summary --outputFile="$1"
```

```bash
#!/usr/bin/env bash
# scripts/quality-gate-linter
set -euo pipefail
npx eslint . --max-warnings=0
```

**Go:**
```bash
#!/usr/bin/env bash
# scripts/quality-gate-tests
set -euo pipefail
go test -coverprofile=coverage.out ./...
go tool cover -json -o="$1" coverage.out
```

```bash
#!/usr/bin/env bash
# scripts/quality-gate-linter
set -euo pipefail
golangci-lint run --issues-exit-code=1
```

**Rust:**
```bash
#!/usr/bin/env bash
# scripts/quality-gate-tests
set -euo pipefail
cargo llvm-cov --json --output-path "$1"
```

```bash
#!/usr/bin/env bash
# scripts/quality-gate-linter
set -euo pipefail
cargo clippy -- -D warnings
```

**Python (pytest + ruff):**
```bash
#!/usr/bin/env bash
# scripts/quality-gate-tests
set -euo pipefail
pytest --cov --cov-report=json-summary --cov-report= "$1"
```

```bash
#!/usr/bin/env bash
# scripts/quality-gate-linter
set -euo pipefail
ruff check . --exit-zero
# Actually fail on warnings:
ruff check . | grep -q "error" && exit 1 || exit 0
```

---

## 5. Directory Structure

```
quality-gate/
├── README.md                    # Quick start + philosophy
├── package.json                 # npm package (@renanliberato/quality-gate)
├── tsconfig.json
├── bin/
│   ├── quality-gate             # CLI entry (#!/usr/bin/env node)
│   └── quality-gate.js          # Compiled output
├── src/
│   ├── index.ts                 # CLI runner
│   ├── commands/
│   │   ├── run.ts               # "run" command
│   │   └── validate.ts          # "validate" command
│   ├── checks/
│   │   ├── coverage.ts          # Coverage check logic
│   │   └── linter.ts            # Linter check logic
│   └── format.ts                # Output formatting
├── extension/
│   └── index.ts                 # Pi extension: hooks turn_end, self-healing loop
├── skill/
│   └── SKILL.md                 # SKILL: bootstrap convention scripts per language
└── PLAN.md                      # This file
```

---

## 6. Implementation Order

| Step | What | Why first |
|------|------|-----------|
| 1 | `quality-gate run --json` with coverage + linter checks | Core detection logic — everything depends on this |
| 2 | `quality-gate validate` | Validates environment before running |
| 3 | Pi extension: hook `turn_end`, run gate, self-healing loop | The main mechanism |
| 4 | Retry budget (maxAttempts, appendEntry tracking) | Prevents infinite loops |
| 5 | Code-change detection heuristic | Avoids false positives on read-only turns |
| 6 | Auto-baseline creation on first pass | Zero-config first run |
| 7 | SKILL.md with per-language script templates | Onboarding for new projects |
| 8 | README and documentation | Usability |

---

## 7. Edge Cases & Trade-offs

| Concern | Solution |
|---------|----------|
| **Infinite loop** | Hard cap of `maxRetries` (default 3). Extension tracks count via `pi.appendEntry`. After budget exhausted, gate lets the next attempt pass and notifies user. |
| **Agent talks instead of fixing** | The steer message says "Do NOT respond with explanation — fix the code." If the agent still talks, the gate re-fires on the next turn_end (agent wasted a turn). Budget still counts down. |
| **No coverage baseline** | First run auto-creates baseline and passes. No regression possible until baseline exists. |
| **Coverage noise (85.0 → 84.9)** | Configurable tolerance (default 5% relative, i.e., 95% of baseline). 85.0 baseline → 80.75 would fail. |
| **Tests take too long** | The gate runs synchronously in `turn_end`. If tests are slow, the agent's fix loop also slows. Mitigation: project-specific scripts should use fast subset testing if possible. |
| **Linter has no "max-warnings=0" flag** | SKILL documents how to wrap it (e.g., `grep` for errors in output). |
| **Agent generates broken code in first place** | That's the point — the gate catches it and forces a fix loop. |
| **Concurrent agent tool calls** | `turn_end` fires once all parallel tools for that turn finish. Gate runs once. |
| **Gate itself is broken (scripts missing)** | Extension detects this via `quality-gate validate` and notifies user to run the SKILL, but doesn't block. |
| **User wants to skip gate for a prompt** | Inline escape: if user's prompt contains `--no-gate` or `[skip quality gate]`, extension skips. Also in settings as `qualityGate.enabled: false`. |
| **Coverage improved** | Extension optionally saves new baseline so coverage ratchets up over time, never down. |
| **First run after baseline created** | Extension runs gate, coverage matches baseline → pass. Agent can't accidentally erode baseline. |
