---
name: hairness-cmd-compare-options
description: Compare explicit options and their tradeoffs without manufacturing a decision.
---

`/hairness-cmd-compare-options`. Surface: intent; chat-first. Machine: `hairness compare`.

Modifiers: `--present <auto|compact|visual|explicit|summary|diagram|...>` default `auto`.

Fixed: `{"controls":{"promotion":"none","view":"comparison"}}`.
Draft: `{schemaVersion:2,protocolVersion:"0.2",summary,inputs:{},controls:{}}`. Set `draft.origin`=`{"kind":"command","commandId":"hairness.understanding.compare-options"}`. Set `draft.result`=`default`. Run `hairness invoke start --operation hairness/understanding:compare --draft-json - --json`. Ask one gap or follow `next`. `--auto` is progress only. Inline: complete before render. Worker: fan-in completes.

Use the supplied focus and proof. Map relationships without inventing structure, evidence or decisions. Stay inline unless a bounded producer protects the main-session context.

No authority implied.
