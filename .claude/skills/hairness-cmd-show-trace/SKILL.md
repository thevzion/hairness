---
name: hairness-cmd-show-trace
description: Show the active Invocation, child Runs, results and fan-in trace.
---

`/hairness-cmd-show-trace`. Surface: intent; chat-first. Machine: `hairness work show-trace`.

Fixed: `{"controls":{"view":"trace","promotion":"none"}}`.
Draft: `{schemaVersion:2,protocolVersion:"0.2",summary,inputs:{},controls:{}}`. Set `draft.origin`=`{"kind":"command","commandId":"hairness.work.show-trace"}`. Set `draft.result`=`dashboard`. Run `hairness invoke start --operation hairness/work:inspect --draft-json - --json`. Ask one gap or follow `next`. `--auto` is progress only. Inline: complete before render. Worker: fan-in completes.

Keep work aligned. `make-*` returns chat; `save-*` promotes the exact compatible result. Show a dashboard. Effects need a checkpoint; state grants no authority.

No authority implied.
