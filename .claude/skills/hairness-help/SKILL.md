---
name: hairness-help
description: Explain the active human command surface and exact host invocations.
---

Invoke with `/hairness-help`.
Surface: namespace guide.
Route: `hairness help`.
Build compact InvocationDraft. Set `draft.result`=`default`. Call `hairness invoke start --operation hairness/cockpit:help --draft-json - --json` before questions. `--auto` advances progress only. Ask returned gaps; else follow `preview.next`.

Run `hairness help --json`. Explain only commands materialized in this distribution and use the exact provider invocation.

No authority implied.
