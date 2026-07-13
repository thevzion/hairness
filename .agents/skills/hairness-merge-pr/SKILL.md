---
name: hairness-merge-pr
description: Preview the exact squash-merge boundary.
---

`$hairness-merge-pr`. Surface: specialized; use only for its exact purpose. Machine: `hairness delivery next`.

Fixed: `{"controls":{"boundary":"merge","promotion":"none"}}`.
Draft: `{schemaVersion:2,protocolVersion:"0.2",summary,inputs:{},controls:{}}`. Set `draft.origin`=`{"kind":"command","commandId":"hairness.delivery.merge-pr"}`. Set `draft.result`=`response`. Run `hairness invoke start --operation hairness/delivery:advance --draft-json - --json`. Ask one gap or follow `next`. `--auto` is progress only. Inline: complete before render. Worker: fan-in completes.

Ask one gap max; promote after acceptance. Show one boundary; stale proof blocks. Partial/failed/unknown receipts: immutable; choose `accept-deviation`, `retry` or `abort`. `--auto` cannot reconcile/pass effects. `go` approves shown checkpoint. Never chain; split tag create/push.

No authority implied.
