---
name: hairness-cmd-save-recap
description: Promote the latest compatible recap result as a SegmentDigest artifact.
---

`$hairness-cmd-save-recap`. Surface: intent; chat-first. Machine: `hairness work save-recap`.

Modifiers: `--present <auto|compact|visual|explicit|summary|diagram|...>` default `auto`.

Fixed: `{"controls":{"promotion":"artifact"}}`.
Draft: `{schemaVersion:2,protocolVersion:"0.2",summary,inputs:{},controls:{}}`. Set `draft.origin`=`{"kind":"command","commandId":"hairness.work.save-recap"}`. Set `draft.result`=`artifact`. Run `hairness invoke start --operation hairness/work:recap --draft-json - --json`. Ask one gap or follow `next`. `--auto` is progress only. Inline: complete before render. Worker: fan-in completes.

Keep work aligned. `make-*` returns chat; `save-*` promotes the exact compatible result. Show a dashboard. Effects need a checkpoint; state grants no authority.

No authority implied.
