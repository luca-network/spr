# Claude Code – Project Guidance for Luca Records SPR

## Quick context

This is the SPR (Sealed Payment Record) monorepo. Key packages:
- `packages/spr` – core library (canonicalize, seal/verify, Merkle, test vectors)
- `packages/spr-sdk` – `SprBook` class, accounting export, tools
- `packages/spr-mcp` – MCP server
- `python/spr` – Python SDK

## Before making changes

1. Read `SPEC.md` and `AGENTS.md` first.
2. Run `npm test` and `python -m unittest discover -s tests` (from `python/`) to confirm baseline.
3. Check `docs/engineering/SPR_EXPORT_GAP_MATRIX.md` for what is and isn't implemented.
4. Review `docs/adr/` for relevant architectural decisions.

## Critical rules

- **Never modify** `packages/spr/index.mjs` or `python/spr/format.py` without also updating the
  test vectors (`packages/spr/vectors/vectors.json`) and running `--vectors`.
- **Never expose** `key.pem` or any private key material in exports, logs, or tests.
- **Never post** a journal entry as POSTED; only DRAFT/NEEDS_REVIEW/VERIFIED_EVIDENCE are valid.
- **Never merge or push** without explicit user approval.
- **Never claim** that a valid SPR seal proves payment settled on the rail.

## Test shortcuts

```bash
npm test                                               # all Node.js tests
node packages/spr/bin/spr-verify.mjs --vectors        # SPR vectors
cd python && python3 -m unittest discover -s tests    # Python tests
```

## Skills available

- `spr-accounting-export` – export accounting packages
- `spr-verification` – verify sealed SPR records
- `accounting-classification` – classify payments using industry templates

## Hooks

Pre-push and pre-edit hooks are configured in `.claude/settings.json`. See `docs/engineering/HOOKS.md`.
