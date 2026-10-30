# Claude Code Hooks – Luca Records SPR

Configured in `.claude/settings.json`. Scripts in `.claude/hooks/`.
Claude Code version at implementation: 2.1.314.

---

## Overview

Hooks are shell scripts that Claude Code executes at lifecycle events. They provide
advisory warnings and limited enforcement for safety-critical operations. They are a
**defence-in-depth measure**, not a substitute for code review and human approval.

**Hooks do not guarantee security or authorization.** CI, tests, review gates, and
human approval remain the authoritative controls.

---

## Configured hooks

### `check-push.sh` – Bash PreToolUse

**Event:** PreToolUse on Bash tool calls  
**Protection:** Blocks `git push`, `git merge`, `npm publish`, `gh pr merge`, `vercel deploy`  
**Exit 2:** Blocked (Claude sees the error message)  
**Exit 0:** Allowed  

Prevents accidental CI-triggering commands. A human must approve before any push.

**Limitations:**
- Pattern-based; cannot intercept all push paths (e.g. a script that calls git internally)
- Does not prevent terminal commands the user runs directly
- Does not block `git commit` (local commits are safe)

**Testing:**
```bash
echo '{"command":"git push origin main"}' | bash .claude/hooks/check-push.sh
# Expected: blocked with exit code 2

echo '{"command":"git status"}' | bash .claude/hooks/check-push.sh
# Expected: allowed with exit code 0
```

---

### `check-key-read.sh` – Read/Edit/Write PreToolUse

**Event:** PreToolUse on Read, Edit, Write  
**Protection:** Warns or blocks operations targeting `key.pem`  
**Exit 2:** Blocks Write/Edit to key.pem  
**Exit 0:** Allows Reads (with warning)  

Prevents accidental export of private key material. The private key must never appear in
export packages, logs, or CI artifacts.

**Limitations:**
- Pattern-based filename check only; cannot inspect file contents for key material in advance
- Advisory for reads; enforced for writes

**Testing:**
```bash
echo '{"tool_name":"Write","file_path":"/books/key.pem"}' | bash .claude/hooks/check-key-read.sh
# Expected: blocked

echo '{"tool_name":"Read","file_path":"/books/records.jsonl"}' | bash .claude/hooks/check-key-read.sh
# Expected: allowed (exit 0)
```

---

### `check-spr-core.sh` – Edit/Write PreToolUse

**Event:** PreToolUse on Edit, Write  
**Protection:** Advisory warning when editing SPR core files  
**Exit 0:** Advisory only (never blocks, because editing core is sometimes legitimate)  

Core files: `packages/spr/index.mjs`, `packages/spr/vectors/vectors.json`, `python/spr/format.py`

Changes to these files change the canonical format and invalidate all existing signatures.
Any such change requires a corresponding spec change and vector regeneration.

**Testing:**
```bash
echo '{"file_path":"packages/spr/index.mjs"}' | bash .claude/hooks/check-spr-core.sh
# Expected: warning printed, exit 0
```

---

### `post-edit-lint.sh` – Edit/Write PostToolUse

**Event:** PostToolUse on Edit, Write  
**Protection:** Runs `node --check` on edited `.mjs` files  
**Exit 1:** Syntax error found  
**Exit 0:** OK  

Catches obvious syntax errors immediately after editing, before tests are run.

**Limitations:**
- Checks syntax only, not runtime behaviour
- Only covers `.mjs` files; does not lint Python or YAML

---

## Platform notes

- Scripts use `bash` and `python3 -c` for JSON parsing (available in WSL/macOS/Linux)
- Hook stdin is the tool's input as a JSON object
- Hooks run in the project root directory
- Windows-native (non-WSL) environments may require adjustments; see Claude Code docs

## What hooks cannot do

- Guarantee that private keys are never exposed (file content checks require reading the file)
- Intercept commands run by the user directly in the terminal
- Block GitHub Actions triggered by remote events
- Replace code review or CI as an enforcement mechanism
