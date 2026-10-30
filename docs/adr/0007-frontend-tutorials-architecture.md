# ADR 0007: Frontend and Tutorials Architecture

**Status:** Accepted  
**Date:** 2026-10-30  
**Deciders:** Luca Records engineering

---

## Context

The promptbook for this feature included a "Luca Tutorials" phase. The question was whether to:

1. Build a dedicated tutorial frontend (web app, React, etc.)
2. Publish tutorial content as Markdown documentation only

An audit of the repository found no existing frontend. This is an SDK-only monorepo:
- `packages/spr` – core library
- `packages/spr-sdk` – SprBook and accounting export
- `packages/spr-mcp` – MCP server
- `python/spr` – Python SDK

No `packages/web`, `apps/`, or frontend tooling (Vite, Next.js, webpack) exists.

---

## Decision

**Tutorial content is published as Markdown in `docs/tutorials/`. No frontend is created.**

The promptbook stated: *"do not create a separate frontend if the existing frontend is unavailable."*
Building a fictional frontend application in an SDK-only repo would:
- Add unjustified build complexity (bundler, framework, dev server)
- Create dead code that no current user can run
- Misrepresent the repository's scope

Tutorial content covers 14 curriculum topics plus a README and capability provenance document.
It is complete, navigable, and usable by developers reading the docs.

---

## Future options

If a tutorial frontend is needed:
- A static site generator (Docusaurus, VitePress) could consume the Markdown tutorials directly.
- A web playground (CodeSandbox, StackBlitz) could be linked from the tutorials.
- An interactive notebook (Observable, Jupyter) could embed runnable examples.

Any of these would be additions to the docs, not changes to the SDK packages.

---

## Consequences

**Positive:**
- No new build dependencies or tooling configuration.
- Tutorial content is version-controlled alongside the code it documents.
- Works immediately with any Markdown renderer (GitHub, VS Code, static site generators).

**Negative/risks:**
- No interactive code execution in the tutorials themselves.
- Links to live examples require external hosting.

---

## References

- `docs/tutorials/` – 16 Markdown tutorial files
- `docs/tutorials/CAPABILITY_PROVENANCE.md` – what local SPR can and cannot claim
- `README.md` – "Local SPR vs hosted Luca" capability matrix
- ADR 0003 (settlement evidence trust model)
