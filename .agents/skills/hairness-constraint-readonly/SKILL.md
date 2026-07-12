---
name: hairness-constraint-readonly
description: Make the active scope read-only.
---

# hairness-constraint-readonly

Invocation: `$hairness-constraint-readonly`
Deterministic route: `hairness constraint set readonly --json`
Owner: `hairness/constraints`

Constraints inherit from session to segment, frame and operation. A child may only tighten its boundary. Clearing is explicit at the owning scope. Constraints never grant authority; every effect still requires an operation-scoped checkpoint and worker capsule.

A command grants no authority. Respect active constraints and checkpoints. A worker receives only its capsule and returns one typed result to the declared fan-in.
