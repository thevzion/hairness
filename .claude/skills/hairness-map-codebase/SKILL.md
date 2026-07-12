---
name: hairness-map-codebase
description: Produce a bounded codebase, entrypoint, or system map.
---

# hairness-map-codebase

Invocation: `/hairness-map-codebase`
Deterministic route: `hairness codebase map --json`
Owner: `hairness/codebase`
Operation: `hairness/codebase#map`

Accepted modifiers:
- `--present <auto|compact|visual|explicit|summary|diagram|tree|table|timeline|checklist|matrix|trace>` (default: `auto`)

Run `hairness codebase map <id> --json`. Spawn one native producer only when the returned capsule requests it, then fan in.

A command grants no authority. Respect active constraints and checkpoints. A worker receives only its capsule and returns one typed result to the declared fan-in.
