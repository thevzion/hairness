---
name: hairness-cmd-check-sources
description: Resolve proof gaps using selected sources before broader discovery.
---

`$hairness-cmd-check-sources`. Surface: intent; chat-first. Machine: `hairness source doctor`.

Fixed: `{"controls":{"promotion":"none"}}`.
Draft: `{schemaVersion:2,protocolVersion:"0.2",summary,inputs:{},controls:{}}`. Set `draft.origin`=`{"kind":"command","commandId":"hairness.sources.check"}`. Set `draft.result`=`default`. Run `hairness invoke start --operation hairness/sources:doctor --draft-json - --json`. Ask one gap or follow `next`. `--auto` is progress only. Inline: complete before render. Worker: fan-in completes.

Use selected local drivers to produce current typed evidence. Source reads are explicit, read-only and bounded to declared operations. Evidence proves current truth; durable artifacts only orient.

No authority implied.
