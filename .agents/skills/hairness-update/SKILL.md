---
name: hairness-update
description: Inspect and safely update source-owned Hairness materials.
---

# hairness-update

Invocation: `$hairness-update`
Deterministic route: `hairness update doctor --json`
Owner: `hairness/distribution`

# Hairness distribution lifecycle

Inspect the tracked lock before proposing an update. Never infer that consumer divergence is safe. `check` may consult the configured source only when the user invokes it; session opening and wake-up stay offline.

An apply requires the exact checkpoint emitted by the immutable plan. Hairness does not create commits, branches, remotes, pull requests, tags, releases, or publishes.

A command grants no authority. Respect active constraints and checkpoints. A worker receives only its capsule and returns one typed result to the declared fan-in.
