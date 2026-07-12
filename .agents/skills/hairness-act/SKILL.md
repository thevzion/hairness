---
name: hairness-act
description: Act on one accepted frame through an explicit checkpoint.
---

# hairness-act

Invocation: `$hairness-act`
Deterministic route: `hairness work act --json`
Owner: `hairness/work-controls`
Operation: `hairness/work#act`

# Work Controls

Use the persistent work graph only to keep mission, segment, frame, boundaries and accepted artifacts aligned. `discuss` stays read-only. `recap` and `plan` may prepare one bounded producer. `act` and `execute` require an explicit current checkpoint and never infer authority from the work graph.

A command grants no authority. Respect active constraints and checkpoints. A worker receives only its capsule and returns one typed result to the declared fan-in.
