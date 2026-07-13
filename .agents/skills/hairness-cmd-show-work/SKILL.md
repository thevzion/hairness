---
name: hairness-cmd-show-work
description: Show the compact active-work dashboard with links, limits and next route.
---

`$hairness-cmd-show-work`. Surface: intent; chat-first. Machine: `hairness work show-work`.

Fixed: `{"controls":{"view":"work","promotion":"none"}}`.
Draft: `{schemaVersion:2,protocolVersion:"0.2",summary,inputs:{},controls:{}}`. Set `draft.origin`=`{"kind":"command","commandId":"hairness.work.show-work"}`. Set `draft.result`=`dashboard`. Run `hairness invoke start --operation hairness/work:inspect --draft-json - --json`. Ask one gap or follow `next`. `--auto` is progress only. Inline: complete before render. Worker: fan-in completes.

Keep work aligned. `make-*` returns chat; `save-*` promotes the exact compatible result. Show a dashboard. Effects need a checkpoint; state grants no authority.

No authority implied.
