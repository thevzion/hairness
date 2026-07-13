---
name: hairness-cmd-show-topics
description: Show recoverable subjects across sessions with their next read-only route.
---

`$hairness-cmd-show-topics`. Surface: intent; chat-first. Machine: `hairness topics`.

Fixed: `{"controls":{"view":"topics","promotion":"none"}}`.
Draft: `{schemaVersion:2,protocolVersion:"0.2",summary,inputs:{},controls:{}}`. Set `draft.origin`=`{"kind":"command","commandId":"hairness.cockpit.show-topics"}`. Set `draft.result`=`default`. Run `hairness invoke start --operation hairness/cockpit:attention --draft-json - --json`. Ask one gap or follow `next`. `--auto` is progress only. Inline: complete before render. Worker: fan-in completes.

Render at most twenty recoverable topics as a compact dashboard. Keep state, last activity, limits and the read-only resume route visible. Do not reopen closed work implicitly.

No authority implied.
