---
name: hairness-map-codebase
description: Produce or refresh one bounded codebase digest.
---

# hairness-map-codebase

Invocation: `$hairness-map-codebase`
Deterministic route: `hairness codebase map --json`
Owner: `hairness/codebase`

Run `hairness codebase map <id> --json`. Spawn one native producer only when the returned capsule requests it, then fan in.

A command grants no authority. Respect active constraints and checkpoints. A worker receives only its capsule and returns one typed result to the declared fan-in.
