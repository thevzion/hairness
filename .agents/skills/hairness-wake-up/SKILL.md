---
name: hairness-wake-up
description: Show current attention, limits, and the next useful route.
---

Invoke with `$hairness-wake-up`.

Use the fresh SessionOpening path below first. When a refresh is required, infer a compact InvocationDraft and call `hairness invoke start --operation hairness/cockpit:wake-up --draft-json - --json`.

If a fresh SessionOpening is already present, render its three attention signals directly with zero tool calls. If it is missing or the user explicitly requests a refresh, run exactly one `hairness wake-up --json`. Present the highest-priority signal and its deterministic next route.

No authority is implied. Keep checkpoints and worker capsules exact.
