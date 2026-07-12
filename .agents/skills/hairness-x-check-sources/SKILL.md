---
name: hairness-x-check-sources
description: Resolve proof gaps using selected sources before broader discovery.
---

Invoke with `$hairness-x-check-sources`.
Surface: intent; chat-first.
Route: `hairness source doctor`.

Fixed: `{"controls":{"persistence":"none"}}`.
Build compact InvocationDraft. Set `draft.result`=`default`. Call `hairness invoke start --operation hairness/sources:doctor --draft-json - --json` before questions. `--auto` advances progress only. Ask returned gaps; else follow `preview.next`.

Use selected local drivers to produce current typed evidence. Source reads are explicit, read-only and bounded to declared operations. Evidence proves current truth; durable artifacts only orient.

No authority implied.
