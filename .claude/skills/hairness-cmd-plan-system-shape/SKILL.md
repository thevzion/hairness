---
name: hairness-cmd-plan-system-shape
description: Draft a target-shape plan using the reshape-system controls.
---

`/hairness-cmd-plan-system-shape`. Surface: intent; chat-first. Machine: `hairness work plan-system-shape`.

Modifiers: `--present <auto|compact|visual|explicit|summary|diagram|...>` default `auto`.

Fixed: `{"controls":{"planKind":"system-shape","promotion":"none"}}`.
Draft: `{schemaVersion:2,protocolVersion:"0.2",summary,inputs:{},controls:{}}`. Set `draft.origin`=`{"kind":"command","commandId":"hairness.work.plan-system-shape"}`. Set `draft.result`=`response`. Run `hairness invoke start --operation hairness/work:plan --draft-json - --json`. Ask one gap or follow `next`. `--auto` is progress only. Inline: complete before render. Worker: fan-in completes.

Keep work aligned. `make-*` returns chat; `save-*` promotes the exact compatible result. Show a dashboard. Effects need a checkpoint; state grants no authority.

No authority implied.
