# ADR 0016: Source-owned registry

Status: accepted for 0.4 alpha

## Decision

Hairness distributes agentic assets as files described by registry JSON. The CLI
copies them into the Home and records provenance per Extension. Git owns history.
Only the CLI is published as a package.

## Consequences

- Installed assets are directly readable, editable and reviewable.
- A Home has no Hairness package graph or global dependency lock.
- Synchronization can detect local changes but does not merge them.
- Git tags and commits provide reproducible source addresses.
- Registries can be a Git repository or HTTPS endpoint; a web marketplace is
  optional discovery infrastructure, not part of the runtime.
- Executable Adapters require a separate, explicit build trust decision.
