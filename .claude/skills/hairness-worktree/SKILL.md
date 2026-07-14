---
name: hairness-worktree
description: Inspect and manage explicit delivery worktrees.
---

`/hairness-worktree`. Surface: namespace guide. Machine: `hairness worktree`.
Draft: `{schemaVersion:2,protocolVersion:"0.2",summary,inputs:{},controls:{}}`. Set `draft.origin`=`{"kind":"command","commandId":"hairness.worktree"}`. Set `draft.result`=`default`. Run `hairness invoke start --operation hairness/worktree:inspect --draft-json - --json`. Ask one gap or follow `next`. `--auto` is progress only. Inline: complete before render. Worker: fan-in completes.

Show live multi-repository inventory. Ask once if the target is ambiguous.
Mutations require an exact Run and checkpoint; `--auto` grants nothing. Never
mutate anchors or unmanaged checkouts, force-remove, or retry unknown effects.
Batch close and foreign takeover stay explicit.

No authority implied.
