---
name: hairness-wake-up
description: Show current attention, limits, and the next useful route.
---

# hairness-wake-up

Invocation: `/hairness-wake-up`
Deterministic route: `hairness wake-up --json`
Owner: `hairness/cockpit`

If a fresh SessionOpening is already present, render its three attention signals directly with zero tool calls. If it is missing or the user explicitly requests a refresh, run exactly one `hairness wake-up --json`. Present the highest-priority signal and its deterministic next route.

A command grants no authority. Respect active constraints and checkpoints. A worker receives only its capsule and returns one typed result to the declared fan-in.
