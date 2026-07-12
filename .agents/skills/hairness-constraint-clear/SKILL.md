---
name: hairness-constraint-clear
description: Explicitly clear one constraint at its owning scope.
---

# hairness-constraint-clear

Invocation: `$hairness-constraint-clear`
Deterministic route: `hairness constraint clear --json`
Owner: `hairness/constraints`

Constraints inherit from session to segment, frame and operation. A child may only tighten its boundary. Clearing is explicit at the owning scope. Constraints never grant authority; every effect still requires an operation-scoped checkpoint and worker capsule.

A command grants no authority. Respect active constraints and checkpoints. A worker receives only its capsule and returns one typed result to the declared fan-in.
