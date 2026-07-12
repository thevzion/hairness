---
name: hairness-discuss
description: Discuss one bounded frame without effects.
---

# hairness-discuss

Invocation: `/hairness-discuss`
Deterministic route: `hairness work discuss --json`
Owner: `hairness/work-controls`
Operation: `hairness/work#discuss`

Accepted modifiers:
- `--present <auto|compact|visual|explicit|summary|diagram|tree|table|timeline|checklist|matrix|trace>` (default: `auto`)

# Work Controls

Use the persistent work graph only to keep mission, segment, frame, boundaries and accepted artifacts aligned. `discuss` stays read-only. `recap` and `plan` may prepare one bounded producer. `act` and `execute` require an explicit current checkpoint and never infer authority from the work graph.

A command grants no authority. Respect active constraints and checkpoints. A worker receives only its capsule and returns one typed result to the declared fan-in.
