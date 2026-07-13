---
name: hairness-cmd-do-frame
description: Act on one accepted frame through an explicit checkpoint.
---

`/hairness-cmd-do-frame`. Surface: intent; chat-first. Machine: `hairness work do-frame`.

Fixed: `{"controls":{"promotion":"effect"}}`.

Defaults: `{"mode":"auto"}` unless overridden.
Draft: `{schemaVersion:2,protocolVersion:"0.2",summary,inputs:{},controls:{}}`. Set `draft.origin`=`{"kind":"command","commandId":"hairness.work.do-frame"}`. Set `draft.result`=`default`. Run `hairness invoke start --operation hairness/work:act --draft-json - --json`. Ask one gap or follow `next`. `--auto` is progress only. Inline: complete before render. Worker: fan-in completes.

Keep work aligned. `make-*` returns chat; `save-*` promotes the exact compatible result. Show a dashboard. Effects need a checkpoint; state grants no authority.

No authority implied.
