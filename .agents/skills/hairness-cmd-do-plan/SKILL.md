---
name: hairness-cmd-do-plan
description: Execute an accepted WorkPlan through bounded routes.
---

`$hairness-cmd-do-plan`. Surface: intent; chat-first. Machine: `hairness work do-plan`.

Fixed: `{"controls":{"promotion":"effect"}}`.

Defaults: `{"mode":"auto"}` unless overridden.
Draft: `{schemaVersion:2,protocolVersion:"0.2",summary,inputs:{},controls:{}}`. Set `draft.origin`=`{"kind":"command","commandId":"hairness.work.do-plan"}`. Set `draft.result`=`default`. Run `hairness invoke start --operation hairness/work:execute --draft-json - --json`. Ask one gap or follow `next`. `--auto` is progress only. Inline: complete before render. Worker: fan-in completes.

Keep work aligned. `make-*` returns chat; `save-*` promotes the exact compatible result. Show a dashboard. Effects need a checkpoint; state grants no authority.

No authority implied.
