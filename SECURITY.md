# Security Policy

BaseHalf is maintained by Pointa Labs, Inc. We take security seriously and
appreciate responsible disclosure.

## Reporting a vulnerability

**Please do not open a public issue for security problems.**

Report privately through either channel:

- **GitHub:** open a private advisory via *Security → Report a vulnerability*
  on the repository, or
- **Email:** chouarslan@gmail.com with the subject `BaseHalf Security`.

Please include:

- a description of the issue and its impact,
- steps to reproduce (a minimal proof of concept if possible),
- affected version / commit.

## What to expect

- We aim to acknowledge a report within **3 business days**.
- We'll keep you updated as we investigate and fix, and we'll credit you in the
  release notes unless you'd prefer to stay anonymous.

## Scope notes

BaseHalf is **local-first**: the reference implementation stores everything in a
local `.kb/` directory and makes no network calls. The most relevant concerns
are therefore around the integrity of the audit log and the write path (see the
invariants in [CONTRIBUTING.md](CONTRIBUTING.md)) rather than remote attack
surface. Reports about the future hosted/sync layer are equally welcome.

## Supported versions

This is pre-1.0 software; only the latest `main` is supported. Pin a commit if
you need stability.
