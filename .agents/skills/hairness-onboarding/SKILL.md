---
name: hairness-onboarding
description: Continue deterministic local onboarding one question at a time.
---

Invoke with `$hairness-onboarding`.
Surface: specialized; use only for its exact purpose.
Route: `hairness onboarding next`.
Build compact InvocationDraft. Set `draft.result`=`default`. Call `hairness invoke start --operation hairness/cockpit:onboarding --draft-json - --json` before questions. `--auto` advances progress only. Ask returned gaps; else follow `preview.next`.

Run `hairness onboarding next --json`. Ask exactly the returned question; never skip the checkpoint or infer trust.

No authority implied.
