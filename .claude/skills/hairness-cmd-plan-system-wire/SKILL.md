---
name: hairness-cmd-plan-system-wire
description: Draft a system wiring plan with explicit owner and compatibility controls.
---

`/hairness-cmd-plan-system-wire`. Surface: intent; chat-first. Machine: `hairness work plan-system-wire`.

Modifiers: `--present <auto|compact|visual|explicit|summary|diagram|...>` default `auto`.

Fixed: `{"controls":{"planKind":"system-wire","promotion":"none"}}`.
Draft: `{schemaVersion:2,protocolVersion:"0.2",summary,inputs:{},controls:{}}`. Set `draft.origin`=`{"kind":"command","commandId":"hairness.work.plan-system-wire"}`. Set `draft.result`=`response`. Run `hairness invoke start --operation hairness/work:plan --draft-json - --json`. Ask one gap or follow `next`. `--auto` is progress only. Inline: complete before render. Worker: fan-in completes.

Keep work aligned. `make-*` returns chat; `save-*` promotes the exact compatible result. Show a dashboard. Effects need a checkpoint; state grants no authority.

No authority implied.
