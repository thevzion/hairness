---
name: hairness-wake-up
description: Show current attention, limits, and the next useful route.
---

Invoke with `/hairness-wake-up`.
Surface: specialized; use only for its exact purpose.
Route: `hairness wake-up`.
Use fresh SessionOpening first. If refresh is needed, build compact InvocationDraft. Set `draft.result`=`default`. Call `hairness invoke start --operation hairness/cockpit:wake-up --draft-json - --json`.

If a fresh SessionOpening is already present, render its three attention signals directly with zero tool calls. If it is missing or the user explicitly requests a refresh, run exactly one `hairness wake-up --json`. Present the highest-priority signal and its deterministic next route.

No authority implied.
