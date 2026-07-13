---
name: hairness-cmd-ideate
description: Open several candidate directions without treating them as decisions.
---

`$hairness-cmd-ideate`. Surface: intent; chat-first. Machine: `hairness ideate`.

Modifiers: `--present <auto|compact|visual|explicit|summary|diagram|...>` default `auto`.

Fixed: `{"controls":{"creative":"divergent","promotion":"none"}}`.
Draft: `{schemaVersion:2,protocolVersion:"0.2",summary,inputs:{},controls:{}}`. Set `draft.origin`=`{"kind":"command","commandId":"hairness.ideation.ideate"}`. Set `draft.result`=`default`. Run `hairness invoke start --operation hairness/ideation:ideate --draft-json - --json`. Ask one gap or follow `next`. `--auto` is progress only. Inline: complete before render. Worker: fan-in completes.

`ideate` opens options; `propose` recommends one with tradeoff, risk and confidence. Creative mode changes exploration, never proof.

No authority implied.
