---
name: hairness-map-entrypoint
description: Map one runtime or product entrypoint in a codebase.
---

# hairness-map-entrypoint

Invocation: `$hairness-map-entrypoint`
Deterministic route: `hairness codebase entrypoint --json`
Owner: `hairness/codebase`

Run `hairness codebase entrypoint <id> <entrypoint> --json`. Keep discovery bounded to the declared codebase and entrypoint.

A command grants no authority. Respect active constraints and checkpoints. A worker receives only its capsule and returns one typed result to the declared fan-in.
