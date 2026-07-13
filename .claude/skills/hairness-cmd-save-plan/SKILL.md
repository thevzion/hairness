---
name: hairness-cmd-save-plan
description: Promote the latest compatible work-plan result as an artifact.
---

`/hairness-cmd-save-plan`. Surface: intent; chat-first. Machine: `hairness work save-plan`.

Modifiers: `--present <auto|compact|visual|explicit|summary|diagram|...>` default `auto`.

Fixed: `{"controls":{"promotion":"artifact"}}`.
Draft: `{schemaVersion:2,protocolVersion:"0.2",summary,inputs:{},controls:{}}`. Set `draft.origin`=`{"kind":"command","commandId":"hairness.work.save-plan"}`. Set `draft.result`=`artifact`. Run `hairness invoke start --operation hairness/work:plan --draft-json - --json`. Ask one gap or follow `next`. `--auto` is progress only. Inline: complete before render. Worker: fan-in completes.

Keep work aligned. `make-*` returns chat; `save-*` promotes the exact compatible result. Show a dashboard. Effects need a checkpoint; state grants no authority.

No authority implied.
