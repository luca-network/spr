# ADR 0008: Claude Code Hooks and CI Cost Control

**Status:** Accepted  
**Date:** 2026-10-30  
**Deciders:** Luca Records engineering

---

## Context

The SPR monorepo has a GitHub Actions CI workflow (`.github/workflows/ci.yml`) that runs on every
push and pull request, triggering Node.js and Python tests on three operating systems. This is
appropriate for verified code but should not be triggered by experimental or in-progress AI-assisted
changes.

Two concerns were raised:
1. **Safety**: Accidental `git push` by Claude Code could trigger CI on an untested branch.
2. **Cost**: CI runs on three OSes per push; frequent AI-assisted pushes could exhaust CI minutes.

Additionally, Claude Code sessions working on this repo need guardrails to prevent:
- Editing the SPR core files without understanding the implications
- Writing private key material to export files
- Claiming that Codex code review ran when it was not invoked

---

## Decision

**Four Claude Code hooks are configured in `.claude/settings.json`:**

1. `check-push.sh` (Bash PreToolUse) – blocks `git push`, `git merge`, `npm publish`
2. `check-key-read.sh` (Read/Edit/Write PreToolUse) – warns/blocks operations on `key.pem`
3. `check-spr-core.sh` (Edit/Write PreToolUse) – advisory warning on SPR core file edits
4. `post-edit-lint.sh` (Edit/Write PostToolUse) – runs `node --check` on `.mjs` files

**One planned consolidated push/merge** after all local checks pass and the user gives explicit
approval. No push occurs within a Claude Code session.

**Codex code review** is a paid tool. It will be invoked at most once, after all implementation
is complete. Its invocation is logged. If it is not available or not run, this is documented
explicitly rather than fabricating results.

---

## Alternatives considered

### No hooks; rely on discipline alone

Cheaper to configure but unreliable. A single accidental `git push` by an AI agent could:
- Trigger CI on a branch with partial changes
- Expose work-in-progress to GitHub notification subscribers
- Consume CI minutes

### Block all git commands

Too restrictive; `git status`, `git log`, `git add`, `git commit` are all safe and frequently needed.

### Use pre-commit hooks (`.git/hooks/`) instead of Claude Code hooks

Git hooks apply to all commits by any contributor and would affect human workflow. Claude Code hooks
are session-scoped and do not affect other contributors.

---

## Consequences

**Positive:**
- No accidental CI triggers from Claude Code sessions.
- Explicit one-time Codex review eliminates repeated invocations.
- SPR core safety warnings prevent accidental signature invalidation.
- Syntax errors caught immediately after editing, not at test run time.

**Negative/risks:**
- Hooks are pattern-based; a sufficiently creative command could bypass them.
- `post-edit-lint.sh` only checks `.mjs` syntax; Python and YAML are not linted by hooks.
- Hooks run in the project root; relative path resolution may behave unexpectedly in some shells.

---

## Security and compatibility impact

- Hooks are stored in `.claude/hooks/` and checked into version control; team members can audit them.
- Hook scripts use `python3` for JSON parsing; Python 3 must be available in the shell environment.
- Claude Code version 2.1.314 or later is required for PreToolUse/PostToolUse hook support.
- See `docs/engineering/HOOKS.md` for full documentation of each hook, its limitations, and test procedures.

---

## References

- `.claude/settings.json` – hook configuration
- `.claude/hooks/check-push.sh`, `check-key-read.sh`, `check-spr-core.sh`, `post-edit-lint.sh`
- `docs/engineering/HOOKS.md`
- `AGENTS.md` – AI agent governance for this repo
- `.claude/CLAUDE.md` – project guidance for Claude Code sessions
- ADR 0001 (immutable SPR core)
- ADR 0006 (tenant isolation)
