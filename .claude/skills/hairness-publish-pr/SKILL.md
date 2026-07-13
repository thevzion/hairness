---
name: hairness-publish-pr
description: Preview the exact commit, push and pull-request boundary.
---

`/hairness-publish-pr`. Surface: specialized; use only for its exact purpose. Machine: `hairness delivery next`.

Fixed: `{"controls":{"boundary":"publish-pr","promotion":"none"}}`.
Draft: `{schemaVersion:2,protocolVersion:"0.2",summary,inputs:{},controls:{}}`. Set `draft.origin`=`{"kind":"command","commandId":"hairness.delivery.publish-pr"}`. Set `draft.result`=`response`. Run `hairness invoke start --operation hairness/delivery:advance --draft-json - --json`. Ask one gap or follow `next`. `--auto` is progress only. Inline: complete before render. Worker: fan-in completes.

Draft one concise brief; ask at most one material question; promote only after acceptance. Show only the next boundary and its proof or limits. Stale or incomplete proof blocks. `--auto` stops before effects. `go` approves only the displayed checkpoint. Never chain boundaries.

No authority implied.
