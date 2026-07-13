---
name: hairness-cmd-ask-next
description: Ask the one next question that unblocks the active work.
---

`/hairness-cmd-ask-next`. Surface: intent; chat-first. Machine: `hairness work ask-next`.

Fixed: `{"controls":{"view":"question","promotion":"none"}}`.
Draft: `{schemaVersion:2,protocolVersion:"0.2",summary,inputs:{},controls:{}}`. Set `draft.origin`=`{"kind":"command","commandId":"hairness.work.ask-next"}`. Set `draft.result`=`dashboard`. Run `hairness invoke start --operation hairness/work:inspect --draft-json - --json`. Ask one gap or follow `next`. `--auto` is progress only. Inline: complete before render. Worker: fan-in completes.

Keep work aligned. `make-*` returns chat; `save-*` promotes the exact compatible result. Show a dashboard. Effects need a checkpoint; state grants no authority.

No authority implied.
