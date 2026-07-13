---
name: hairness-cmd-show-structure
description: Show the relationships needed to understand one focus.
---

`$hairness-cmd-show-structure`. Surface: intent; chat-first. Machine: `hairness map`.

Modifiers: `--present <auto|compact|visual|explicit|summary|diagram|...>` default `auto`.

Fixed: `{"controls":{"promotion":"none","view":"structure"}}`.
Draft: `{schemaVersion:2,protocolVersion:"0.2",summary,inputs:{},controls:{}}`. Set `draft.origin`=`{"kind":"command","commandId":"hairness.understanding.show-structure"}`. Set `draft.result`=`default`. Run `hairness invoke start --operation hairness/understanding:map --draft-json - --json`. Ask one gap or follow `next`. `--auto` is progress only. Inline: complete before render. Worker: fan-in completes.

Use the supplied focus and proof. Map relationships without inventing structure, evidence or decisions. Stay inline unless a bounded producer protects the main-session context.

No authority implied.
