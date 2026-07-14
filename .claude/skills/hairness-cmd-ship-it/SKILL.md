---
name: hairness-cmd-ship-it
description: Preview and resolve exactly the next delivery boundary.
---

`/hairness-cmd-ship-it`. Surface: intent; chat-first. Machine: `hairness delivery next`.

Fixed: `{"controls":{"promotion":"none"}}`.
Draft: `{schemaVersion:2,protocolVersion:"0.2",summary,inputs:{},controls:{}}`. Set `draft.origin`=`{"kind":"command","commandId":"hairness.delivery.ship-it"}`. Set `draft.result`=`response`. Run `hairness invoke start --operation hairness/delivery:advance --draft-json - --json`. Ask one gap or follow `next`. `--auto` is progress only. Inline: complete before render. Worker: fan-in completes.

Show one boundary. Mutations require the plan-owned writer lease. Workers get
only their capsule and checkout. A new HEAD invalidates later proof. `--auto`
grants no effect; `go` approves only the shown checkpoint. Never chain effects.

No authority implied.
