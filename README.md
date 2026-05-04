# quality-gate

A pi extension + CLI + skill trio that enforces **hard requirements** at the end of every agent turn:

1. **Test coverage must not regress** from a stored baseline
2. **Linter must pass with zero warnings** (warnings-as-errors)

If either check fails, the extension **tells the agent to fix it** — the agent iterates until the gate passes or the retry budget is exhausted.

## How it works

```
User sends prompt
  → Agent works (multiple turns)
  → Turn ends → extension runs quality-gate checks
  → If PASS: ✓ notify, save improved baseline
  → If FAIL: → send steer message to agent with specific errors
              → agent fixes → re-check → up to 3 attempts
```

## Quick start

### 1. Install

Clone the repo:

```bash
git clone https://github.com/renanliberato/nehemiah.git /path/to/quality-gate
```

Choose one installation method:

**Option A — symlink to /usr/local/bin (recommended):**

```bash
sudo ./nehemiah/install.sh
# or manually:
sudo ln -s /path/to/quality-gate/bin/quality-gate /usr/local/bin/quality-gate
```

**Option B — add to PATH:**

```bash
export PATH="$PATH:/path/to/quality-gate/bin"
```

Add the `export` line to your `~/.zshrc` or `~/.bashrc` to persist.

### 2. Create convention scripts

```bash
mkdir -p scripts
```

Create `scripts/quality-gate-tests` — a thin wrapper that runs tests with coverage:

```bash
cat > scripts/quality-gate-tests << 'SCRIPT'
#!/usr/bin/env bash
set -euo pipefail
# Example for vitest; adjust for your test runner
npx vitest run --coverage --coverage.reporter=json-summary --coverage.reporter=text
if [ -f coverage/coverage-summary.json ] && [ -n "${1:-}" ]; then
  cp coverage/coverage-summary.json "$1"
fi
SCRIPT
chmod +x scripts/quality-gate-tests
```

Create `scripts/quality-gate-linter` — a thin wrapper that runs the linter with warnings as errors:

```bash
cat > scripts/quality-gate-linter << 'SCRIPT'
#!/usr/bin/env bash
set -euo pipefail
# Example for eslint; adjust for your linter
npx eslint . --max-warnings=0
SCRIPT
chmod +x scripts/quality-gate-linter
```

See the [SKILL](./skill/SKILL.md) for templates for other languages (Go, Rust, Python, etc.).

### 3. Validate

```bash
quality-gate validate
# ✓ tests: found
# ✓ linter: found
```

### 4. Create coverage baseline

```bash
quality-gate run --save-coverage --skip-linter
# Creates .quality-gate/coverage-baseline.json
```

### 5. Install the pi extension

Copy the extension to your project:

```bash
mkdir -p .pi/extensions
cp /path/to/quality-gate/extension/index.ts .pi/extensions/quality-gate.ts
```

Configure in `.pi/settings.json`:

```json
{
  "qualityGate": {
    "enabled": true,
    "maxRetries": 3,
    "saveBaseline": true
  }
}
```

Now every time the agent finishes a turn that changes code, the quality gate runs automatically. If it fails, the agent gets a steer message telling it exactly what to fix.

### 6. Manual usage

```bash
# Run both checks
quality-gate run

# JSON output for scripting
quality-gate run --json

# Run only linter
quality-gate run --skip-coverage

# Run only coverage
quality-gate run --skip-linter

# With custom tolerance (default 5%)
quality-gate run --coverage-tolerance 2

# Validate scripts exist
quality-gate validate
```

## CLI reference

```
quality-gate <command> [options]

Commands:
  validate              Check that convention scripts exist and are executable
  run                   Run quality gate checks (coverage + linter)

Options:
  --cwd <path>          Working directory (default: cwd)
  --json                Output as JSON

Run options:
  --skip-coverage       Skip coverage check
  --skip-linter         Skip linter check
  --save-coverage       Save current coverage as new baseline
  --baseline <path>     Coverage baseline file
  --coverage-tolerance  Relative tolerance % (default: 5)
```

## Extension behavior

The pi extension (`extension/index.ts`) hooks `turn_end` and:

1. **Skips if no code changes**: turns with only `read`/response calls are ignored
2. **Runs quality-gate**: invokes the CLI with project settings
3. **On pass**: notifies success, optionally saves improved coverage baseline
4. **On fail**: sends a steer message with specific linter errors and coverage delta, increments retry count
5. **Retry budget**: max 3 attempts (configurable), tracked via `pi.appendEntry()`

## Convention script contract

### `./scripts/quality-gate-tests [report-path]`

- Runs the project's test suite with coverage
- If `report-path` is provided, writes Istanbul `json-summary` format coverage report to that path
- Exit 0 = tests pass, Exit non-zero = tests failed

### `./scripts/quality-gate-linter`

- Runs the linter with warnings-as-errors
- Exit 0 = no warnings, Exit non-zero = warnings/errors found

## Development

```bash
npm install
npm test          # Run unit + integration tests
```

## License

MIT
