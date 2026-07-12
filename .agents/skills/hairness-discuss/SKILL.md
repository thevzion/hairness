---
name: hairness-discuss
description: Discuss one bounded frame without effects.
---

Invoke with `$hairness-discuss`.

Accepted modifiers:
- `--present <auto|compact|visual|explicit|summary|diagram|tree|table|timeline|checklist|matrix|trace>` (default: `auto`)

Infer a compact InvocationDraft from the request and current opening. Before asking a question, call `hairness invoke start --operation hairness/work:discuss --draft-json - --json`. Add `--auto` only when explicitly requested. Ask only a returned gap; otherwise follow `preview.next` and render the typed result.

# Work Controls

Use the persistent work graph only to keep mission, segment, frame, boundaries and accepted artifacts aligned. `discuss` stays read-only. `recap` and `plan` may prepare one bounded producer. `act` and `execute` require an explicit current checkpoint and never infer authority from the work graph.

No authority is implied. Keep checkpoints and worker capsules exact.
