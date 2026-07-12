---
name: hairness-constraint-no-git
description: Forbid Git mutations in the active scope.
---

# hairness-constraint-no-git

Invocation: `/hairness-constraint-no-git`
Deterministic route: `hairness constraint set no-git --json`
Owner: `hairness/constraints`

Constraints inherit from session to segment, frame and operation. A child may only tighten its boundary. Clearing is explicit at the owning scope. Constraints never grant authority; every effect still requires an operation-scoped checkpoint and worker capsule.

A command grants no authority. Respect active constraints and checkpoints. A worker receives only its capsule and returns one typed result to the declared fan-in.
