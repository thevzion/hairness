---
name: hairness-cmd-ship-it
description: Preview and resolve exactly the next delivery boundary.
---

`$hairness-cmd-ship-it`. Surface: intent; chat-first. Machine: `hairness delivery next`.

Fixed: `{"controls":{"promotion":"none"}}`.
Draft: `{schemaVersion:2,protocolVersion:"0.2",summary,inputs:{},controls:{}}`. Set `draft.origin`=`{"kind":"command","commandId":"hairness.delivery.ship-it"}`. Set `draft.result`=`response`. Run `hairness invoke start --operation hairness/delivery:advance --draft-json - --json`. Ask one gap or follow `next`. `--auto` is progress only. Inline: complete before render. Worker: fan-in completes.

Draft one concise brief; ask at most one material question; promote only after acceptance. Show only the next boundary and its proof or limits. Stale or incomplete proof blocks. `--auto` stops before effects. `go` approves only the displayed checkpoint. Never chain boundaries.

No authority implied.
