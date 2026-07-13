---
name: hairness-cmd-make-plan
description: Draft an enriched typed work plan in chat without artifact promotion.
---

`/hairness-cmd-make-plan`. Surface: intent; chat-first. Machine: `hairness work make-plan`.

Modifiers: `--present <auto|compact|visual|explicit|summary|diagram|...>` default `auto`.

Fixed: `{"controls":{"promotion":"none"}}`.
Draft: `{schemaVersion:2,protocolVersion:"0.2",summary,inputs:{},controls:{}}`. Set `draft.origin`=`{"kind":"command","commandId":"hairness.work.make-plan"}`. Set `draft.result`=`response`. Run `hairness invoke start --operation hairness/work:plan --draft-json - --json`. Ask one gap or follow `next`. `--auto` is progress only. Inline: complete before render. Worker: fan-in completes.

Keep work aligned. `make-*` returns chat; `save-*` promotes the exact compatible result. Show a dashboard. Effects need a checkpoint; state grants no authority.

No authority implied.
