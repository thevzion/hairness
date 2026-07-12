---
name: hairness-check-sources
description: Resolve proof gaps using declared sources before broader discovery.
---

# hairness-check-sources

Invocation: `$hairness-check-sources`
Deterministic route: `hairness source doctor --json`
Owner: `hairness/source-controls`

Run `hairness source doctor --json`, identify the proof gap, then use only declared read operations.

A command grants no authority. Respect active constraints and checkpoints. A worker receives only its capsule and returns one typed result to the declared fan-in.
