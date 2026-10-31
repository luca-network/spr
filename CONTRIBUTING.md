# Contributing to SPR

Thank you for helping. SPR is governed as set out in `GOVERNANCE.md`; this page covers the practical part.

## What to send where

- **A problem or an idea:** open an issue.
- **A change to the format:** write an RFC (`rfcs/0000-template.md`) and open a pull request adding it to `rfcs/`. It is decided by the process in `GOVERNANCE.md`.
- **A fix to the reference code, tests or documentation:** open a pull request. Include tests, and test vectors for anything that changes what a record contains or how it is checked.
- **A security problem:** do not open an issue. Follow `SECURITY.md`.

This repository holds the format and its reference implementation only. Products and services built on SPR, such as accounting, ERP exports or analytics, belong in their own repositories, and are not merged here.

## How changes reach the repository

This repository is published from Luca's maintained source with each release. An accepted pull request is applied by Luca's editor to that source and appears in the next release, with your authorship kept in the commit. Please do not expect a pull request to be merged directly.

## Sign-off

Every commit must carry a sign-off line, which confirms the Developer Certificate of Origin 1.1 (https://developercertificate.org): that you wrote the contribution, or otherwise have the right to submit it under the Apache License 2.0.

```
git commit -s -m "Your message"
```

This adds `Signed-off-by: Your Name <your@email>` to the commit. A pull request without it cannot be accepted.

By contributing you agree that your contribution is licensed under the Apache License 2.0, as the rest of the code is. Contributions to the specification are also covered by the patent commitment in `PATENTS.md` for the parts that become part of SPR.

## Before you open a pull request

- `npm test` passes, and the Python tests in `python/` pass.
- `spr-verify --vectors` passes.
- New behavior is described in `SPEC.md` if it changes the format, and in the changelog.
