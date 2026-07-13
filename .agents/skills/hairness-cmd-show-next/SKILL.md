---
name: hairness-cmd-show-next
description: Show the next useful routes for the active work.
---

`$hairness-cmd-show-next`. Surface: intent; chat-first. Machine: `hairness work show-next`.

Fixed: `{"controls":{"view":"next","promotion":"none"}}`.
Draft: `{schemaVersion:2,protocolVersion:"0.2",summary,inputs:{},controls:{}}`. Set `draft.origin`=`{"kind":"command","commandId":"hairness.work.show-next"}`. Set `draft.result`=`dashboard`. Run `hairness invoke start --operation hairness/work:inspect --draft-json - --json`. Ask one gap or follow `next`. `--auto` is progress only. Inline: complete before render. Worker: fan-in completes.

Keep work aligned. `make-*` returns chat; `save-*` promotes the exact compatible result. Show a dashboard. Effects need a checkpoint; state grants no authority.

No authority implied.
