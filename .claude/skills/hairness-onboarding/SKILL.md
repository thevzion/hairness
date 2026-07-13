---
name: hairness-onboarding
description: Continue deterministic local onboarding one question at a time.
---

`/hairness-onboarding`. Surface: specialized; use only for its exact purpose. Machine: `hairness onboarding next`.
Draft: `{schemaVersion:2,protocolVersion:"0.2",summary,inputs:{},controls:{}}`. Set `draft.origin`=`{"kind":"command","commandId":"hairness.onboarding"}`. Set `draft.result`=`default`. Run `hairness invoke start --operation hairness/cockpit:onboarding --draft-json - --json`. Ask one gap or follow `next`. `--auto` is progress only. Inline: complete before render. Worker: fan-in completes.

Run `hairness onboarding next --json`. Ask exactly the returned question; never skip the checkpoint or infer trust.

No authority implied.
