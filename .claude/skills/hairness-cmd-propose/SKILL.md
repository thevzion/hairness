---
name: hairness-cmd-propose
description: Recommend one direction with its tradeoff, risk and confidence.
---

`/hairness-cmd-propose`. Surface: intent; chat-first. Machine: `hairness propose`.

Modifiers: `--present <auto|compact|visual|explicit|summary|diagram|...>` default `auto`.

Fixed: `{"controls":{"creative":"convergent","promotion":"none"}}`.
Draft: `{schemaVersion:2,protocolVersion:"0.2",summary,inputs:{},controls:{}}`. Set `draft.origin`=`{"kind":"command","commandId":"hairness.ideation.propose"}`. Set `draft.result`=`default`. Run `hairness invoke start --operation hairness/ideation:propose --draft-json - --json`. Ask one gap or follow `next`. `--auto` is progress only. Inline: complete before render. Worker: fan-in completes.

`ideate` opens options; `propose` recommends one with tradeoff, risk and confidence. Creative mode changes exploration, never proof.

No authority implied.
