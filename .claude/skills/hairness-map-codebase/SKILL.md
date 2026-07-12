---
name: hairness-map-codebase
description: Produce a bounded codebase, entrypoint, or system map.
---

Invoke with `/hairness-map-codebase`.

Accepted modifiers:
- `--present <auto|compact|visual|explicit|summary|diagram|tree|table|timeline|checklist|matrix|trace>` (default: `auto`)

Infer a compact InvocationDraft from the request and current opening. Before asking a question, call `hairness invoke start --operation hairness/codebase:map --draft-json - --json`. Add `--auto` only when explicitly requested. Ask only a returned gap; otherwise follow `preview.next` and render the typed result.

Run `hairness codebase map <id> --json`. Spawn one native producer only when the returned capsule requests it, then fan in.

No authority is implied. Keep checkpoints and worker capsules exact.
