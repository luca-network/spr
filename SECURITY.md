# Security

## Reporting a problem

Write to hello@luca.network with "Security" in the subject. Please do not open a public issue for a security problem.

We answer within two working days, tell you what we found and when a fix will ship, and credit you in the release notes if you would like that. A fix is released as a new version on npm and PyPI and listed in [`CHANGELOG.md`](CHANGELOG.md).

## Versions we fix

The latest 0.1 release of `@luca-network/spr`, `@luca-network/spr-sdk`, `@luca-network/spr-mcp` and `spr-sdk`.

## What these packages do and do not claim

- A package check without the company's key (`spr-verify <folder>`) shows the package is consistent with the keys it carries. Anyone can make a consistent package with a key of their own. To check whose package it is, pass the company's public key, obtained from the company: `spr-verify <folder> --key <file or key ID>`.
- A local book records what the agent reports. Its checks are against the agent's declared intent and the book's own limits. Neither is confirmation from the payment rail.
- The private key is a file in the book's folder, readable only by its owner where the system allows it. Keep the folder out of source control and out of folders that sync to the cloud.
