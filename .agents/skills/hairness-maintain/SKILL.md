---
name: hairness-maintain
description: Check Hairness owners, projections, package boundaries, and documentation impact.
---

# hairness-maintain

Invocation: `$hairness-maintain`
Deterministic route: `hairness maintain check --json`
Owner: `hairness/maintainer`
Operation: `hairness/maintenance#inspect`

Run the requested `hairness maintain` route. Resolve blocking ownership and projection gates before claiming readiness.

A command grants no authority. Respect active constraints and checkpoints. A worker receives only its capsule and returns one typed result to the declared fan-in.
