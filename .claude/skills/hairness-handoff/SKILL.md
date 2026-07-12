---
name: hairness-handoff
description: Produce a compact durable handoff without storing a transcript.
---

# hairness-handoff

Invocation: `/hairness-handoff`
Deterministic route: `hairness session digest --json`
Owner: `hairness/session-intelligence`
Operation: `hairness/session#handoff`

Create a compact session digest from explicit input. Confirm that volatile transcript input is opted in before reading it.

A command grants no authority. Respect active constraints and checkpoints. A worker receives only its capsule and returns one typed result to the declared fan-in.
