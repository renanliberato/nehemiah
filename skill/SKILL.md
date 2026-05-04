---
name: quality-gate-setup
description: >
  Bootstrap quality-gate convention scripts (quality-gate-tests and
  quality-gate-linter) for a project. Detects the project's language and
  tooling, then generates appropriate wrapper scripts. Use when setting
  up the quality gate in a new project or when validate reports missing
  scripts.
---

# quality-gate-setup

Helps you create the two convention scripts that the quality-gate CLI
requires: `./scripts/quality-gate-tests` and `./scripts/quality-gate-linter`.

These scripts are thin wrappers — they just invoke the project's existing
test/linter tooling with the right flags for coverage and
warnings-as-errors.

---

## Step 1: Detect project tooling

Run `ls` on manifest files to detect the language and framework:

| Manifest file | Language | Common test runners | Common linters |
|---|---|---|---|
| `package.json` | Node / TypeScript | vitest, jest, mocha, tap | eslint, oxlint, biome |
| `go.mod` | Go | `go test` | golangci-lint, staticcheck |
| `Cargo.toml` | Rust | `cargo test`, cargo-llvm-cov | clippy |
| `pyproject.toml`, `setup.py`, `requirements.txt` | Python | pytest, unittest | ruff, pylint, flake8 |
| `*.csproj` | C# / .NET | dotnet test | dotnet format, roslyn |
| `build.gradle`, `build.gradle.kts` | Java / Kotlin | gradle test | gradle lint, checkstyle |
| `pom.xml` | Java | maven test | maven checkstyle, PMD |
| `Makefile`, `CMakeLists.txt` | C / C++ | ctest, custom | cppcheck, clang-tidy |

---

## Step 2: Create scripts directory

```bash
mkdir -p scripts
chmod +x scripts/* 2>/dev/null || true
```

---

## Step 3: Generate scripts

### Node / TypeScript

If using **vitest**:

```bash
cat > scripts/quality-gate-tests << 'SCRIPT'
#!/usr/bin/env bash
set -euo pipefail
npx vitest run --reporter=verbose --coverage --coverage.reporter=json --outputFile="$1"
SCRIPT

cat > scripts/quality-gate-linter << 'SCRIPT'
#!/usr/bin/env bash
set -euo pipefail
npx eslint . --max-warnings=0
SCRIPT
```

If using **jest**:

```bash
cat > scripts/quality-gate-tests << 'SCRIPT'
#!/usr/bin/env bash
set -euo pipefail
npx jest --coverage --coverageReporters=json-summary --outputFile="$1"
SCRIPT

cat > scripts/quality-gate-linter << 'SCRIPT'
#!/usr/bin/env bash
set -euo pipefail
npx eslint . --max-warnings=0
SCRIPT
```

If using **biome** (lint + test):

```bash
cat > scripts/quality-gate-tests << 'SCRIPT'
#!/usr/bin/env bash
set -euo pipefail
npx vitest run --reporter=verbose --coverage --coverage.reporter=json --outputFile="$1"
SCRIPT

cat > scripts/quality-gate-linter << 'SCRIPT'
#!/usr/bin/env bash
set -euo pipefail
npx biome lint . --error-on-warnings
SCRIPT
```

### Go

```bash
cat > scripts/quality-gate-tests << 'SCRIPT'
#!/usr/bin/env bash
set -euo pipefail
go test -coverprofile=coverage.out ./...
go tool cover -json -o="$1" coverage.out
SCRIPT

cat > scripts/quality-gate-linter << 'SCRIPT'
#!/usr/bin/env bash
set -euo pipefail
golangci-lint run --issues-exit-code=1 --max-issues-per-linter=0 --max-same-issues=0
SCRIPT
```

### Rust

```bash
cat > scripts/quality-gate-tests << 'SCRIPT'
#!/usr/bin/env bash
set -euo pipefail
cargo llvm-cov --json --output-path "$1"
SCRIPT

cat > scripts/quality-gate-linter << 'SCRIPT'
#!/usr/bin/env bash
set -euo pipefail
cargo clippy --all-targets -- -D warnings
SCRIPT
```

### Python

```bash
cat > scripts/quality-gate-tests << 'SCRIPT'
#!/usr/bin/env bash
set -euo pipefail
python -m pytest --cov --cov-report=json --cov-report=term-missing -o "cov_report_path=$1"
# pytest-cov writes to cobertura or json; move to expected path
SCRIPT

cat > scripts/quality-gate-linter << 'SCRIPT'
#!/usr/bin/env bash
set -euo pipefail
ruff check . --exit-zero 2>/dev/null
# Re-run to get actual output with error exit
ruff check . 2>&1 | grep -q "^[^ ]" && exit 1 || exit 0
SCRIPT
```

---

## Step 4: Install quality-gate CLI

Clone the repo:

```bash
git clone https://github.com/renanliberato/nehemiah.git /path/to/quality-gate
```

Choose one installation method:

**Option A — symlink to /usr/local/bin (recommended):**

```bash
sudo /path/to/quality-gate/install.sh
quality-gate validate
```

**Option B — add to PATH:**

```bash
export PATH="$PATH:/path/to/quality-gate/bin"
```

Add the `export` line to your shell profile to persist.

---

## Step 5: Configure pi extension

Install the extension:

```bash
cp /path/to/quality-gate/extension/index.ts .pi/extensions/quality-gate.ts
```

Create or update `.pi/settings.json`:

```json
{
  "qualityGate": {
    "enabled": true,
    "maxRetries": 3,
    "saveBaseline": true
  }
}
```

---

## Step 6: Validate

```bash
quality-gate validate
# Should show: ✓ tests: found, ✓ linter: found
```

---

## Step 7: Create baseline

```bash
quality-gate run --save-coverage --skip-linter
# Creates .quality-gate/coverage-baseline.json
```

---

## Troubleshooting

| Problem | Likely cause | Fix |
|---|---|---|
| `validate` shows scripts missing | Scripts don't exist | Follow Step 3 |
| `validate` shows not executable | Scripts not `chmod +x` | `chmod +x scripts/*` |
| Coverage check fails with "no report" | Test script didn't produce output file | Check the script's coverage reporter config |
| Linter passes but code has warnings | Linter not in strict mode | Add `--max-warnings=0` or equivalent |
| Tests hanging | Timeout too short | Increase timeout in extension's `loadOptions()` |
| Quality gate not running in pi | Extension not loaded | Ensure `.pi/extensions/quality-gate.ts` exists and run `/reload` in pi |
