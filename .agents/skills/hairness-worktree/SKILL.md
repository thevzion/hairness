---
name: hairness-worktree
description: Inspect and manage explicit delivery worktrees.
---

`$hairness-worktree`. Surface: namespace guide. Machine: `hairness worktree`.
Draft: `{schemaVersion:2,protocolVersion:"0.2",summary,inputs:{},controls:{}}`. Set `draft.origin`=`{"kind":"command","commandId":"hairness.worktree"}`. Set `draft.result`=`default`. Run `hairness invoke start --operation hairness/worktree:inspect --draft-json - --json`. Ask one gap or follow `next`. `--auto` is progress only. Inline: complete before render. Worker: fan-in completes.

Show live inventory by default. Mutations require an exact proposal, Run and
checkpoint; `--auto` never grants authority. Revalidate the writer lease. Never
mutate anchors or unmanaged checkouts, force-remove, replace overlay/hooks, or
retry unknown effects before reconciliation. Bootstrap adoption must match its
locked non-anchor target and parent grant.

No authority implied.
