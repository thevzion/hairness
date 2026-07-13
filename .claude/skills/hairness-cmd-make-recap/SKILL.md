---
name: hairness-cmd-make-recap
description: Produce a typed chat recap of active work without artifact promotion.
---

`/hairness-cmd-make-recap`. Surface: intent; chat-first. Machine: `hairness work make-recap`.

Modifiers: `--present <auto|compact|visual|explicit|summary|diagram|...>` default `auto`.

Fixed: `{"controls":{"promotion":"none"}}`.
Draft: `{schemaVersion:2,protocolVersion:"0.2",summary,inputs:{},controls:{}}`. Set `draft.origin`=`{"kind":"command","commandId":"hairness.work.make-recap"}`. Set `draft.result`=`response`. Run `hairness invoke start --operation hairness/work:recap --draft-json - --json`. Ask one gap or follow `next`. `--auto` is progress only. Inline: complete before render. Worker: fan-in completes.

Keep work aligned. `make-*` returns chat; `save-*` promotes the exact compatible result. Show a dashboard. Effects need a checkpoint; state grants no authority.

No authority implied.
