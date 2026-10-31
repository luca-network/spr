# How SPR is governed

SPR, the Sealed Payment Record, is an open format for the record of a payment made by an AI agent. Anyone can implement it, with or without the reference code: the code is under the Apache License 2.0 (`LICENSE`), and Luca's patent commitment is in `PATENTS.md`. This page says who decides what goes into the format, how anyone can propose a change, and where the format is meant to end up.

## Who maintains SPR now

While SPR is a draft, Luca maintains it, through an editor who represents Luca. The editor keeps the specification (`SPEC.md`), the test vectors and the reference library and checkers in this repository. The editor follows the process below for every change, including changes Luca proposes.

## What this repository covers

- **In scope:** the record format, how records are sealed and checked, the package format, the test vectors, and the reference library, SDKs, checker and MCP server that implement them.
- **Out of scope:** products and services built on SPR, by Luca or anyone else, such as accounting, posting to an ERP, or analytics. They can use SPR freely, but they are not part of the format and are not decided here.

## How a change is made

1. **Raise it.** Open an issue describing the problem or the idea. Anyone can, and no one needs to be a Luca customer.
2. **Write it up.** For a change to the format, write a short proposal (an RFC) using `rfcs/0000-template.md` and open a pull request adding it to `rfcs/`. Typo fixes and clarifications that change no behavior can go straight to a pull request.
3. **Public comment.** An RFC is open for comment for at least 30 days. A clarification is open for at least 7 days.
4. **Decision.** The editor accepts, asks for changes, or declines, and write the reasons in the RFC. Every RFC and its decision stays in the repository.
5. **Release.** An accepted change is released with test vectors that show it. A change that would make an existing record fail its check goes only into a new draft version, and records sealed under an earlier draft stay valid and checkable.

Security problems are not raised in public: follow `SECURITY.md`.

## Principles

- The same process applies to everyone, Luca included.
- No implementation, Luca's included, gets a feature of the format that others cannot implement from the specification.
- Records already sealed keep checking. A draft's identifiers never change meaning.
- An implementation may call itself SPR-compatible when it passes every test vector of the draft it names.

## Where SPR is going

Luca intends to offer SPR to a recognized standards body, XBRL, as a recordkeeping profile for machine payments.

- When a recognized standards body agrees to maintain SPR, Luca will transfer the editorship and this repository's specification to it, together with the patent commitment.
- Luca will start that transfer no later than when three independent implementations, from organizations other than Luca, pass the test vectors of the same draft.
- Until then, a working group of implementers, payment rails, ERP and accounting software makers and auditors may be formed to advise on each draft. Its notes will be public.

## Contributions

Contributions are welcome under the terms in `CONTRIBUTING.md`, which include a sign-off confirming you have the right to submit them under the Apache License 2.0.

## Contact

hello@luca.network
