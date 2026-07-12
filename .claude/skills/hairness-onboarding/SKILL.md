---
name: hairness-onboarding
description: Continue deterministic local onboarding one question at a time.
---

# hairness-onboarding

Invocation: `/hairness-onboarding`
Deterministic route: `hairness onboarding next --json`
Owner: `hairness/cockpit`
Operation: `hairness/cockpit#onboarding`

Run `hairness onboarding next --json`. Ask exactly the returned question; never skip the checkpoint or infer trust.

A command grants no authority. Respect active constraints and checkpoints. A worker receives only its capsule and returns one typed result to the declared fan-in.
