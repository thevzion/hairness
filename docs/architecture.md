# Architecture

Hairness separates a minimal protocol kernel from selected behavior and native provider execution.

```mermaid
flowchart TD
  human["Human intent"] --> main["Native provider main session"]
  opening["Compact SessionOpening"] --> main
  commands["Repo-local commands"] --> main
  main --> cli["Deterministic Hairness CLI"]
  cli --> registry["Active extension registry"]
  registry --> capability["Capability"]
  capability --> operation["Operation: observe · derive · effect"]
  operation --> route["Route: deterministic · inline · worker · external"]
  route --> gates["Schemas · fan-in · policy · authority · locks"]
  gates --> result["Typed Result"]
  result --> main
  sources["Selected source drivers"] --> registry
  targets["Mounted codebase checkouts"] --> gates
```

## Owners

| Owner | Owns | Does not own |
| --- | --- | --- |
| Kernel | contracts, registry, storage, runs, plans, fan-in, artifacts, authority enforcement, locks | domain behavior or concrete sources |
| Extension | capabilities, operations, commands, services, contributions, schemas, instructions, tests | implicit authority |
| Distribution | active selection, defaults, source drivers, codebase contracts, provider projections | upstream control after generation |
| Provider adapter | Codex/Claude syntax and managed output mechanics | capabilities or model runtime |
| Provider | model, UI, tools, sandbox, native workers and threads | Hairness source ownership |
| Mounted codebase | Git history, runtime, conventions and files | Hairness local state |

The generic invocation store and event lifecycle live in the kernel. Operation lookup, preferences and trusted resolver contributions live in the distribution layer. Provider models may propose drafts but never mutate canonical invocation state directly.

Forge-only Initiative and Delivery Controls sit above Work Controls. They preserve macro outcomes and sequential delivery evidence while delegating every Git or publication effect to an explicitly checkpointed native executor.

```text
core owns grammar
extensions own behavior
distribution owns selection
providers own execution
```

## Source-owned flow

```mermaid
flowchart LR
  package["@hairness/hairness"] --> recipe["minimal · standard · forge recipe"]
  recipe --> generated["Standalone source-owned repository"]
  generated --> codex["Codex projection"]
  generated --> claude["Claude projection"]
  update["Explicit update proposal"] --> generated
```

A recipe selects named material sets. Hairness resolves their declared dependency graph, rejects cycles and target conflicts, and copies the exact resulting entries. A generated distribution contains selected extensions and drivers only. A forge can retain dormant generic catalogue source, but only manifest-selected extensions execute.

## State

```text
Git tracked
├── kernel and public schemas
├── selected extension source
├── selected source drivers
├── hairness.json and hairness.lock.json
├── provider projections and hairness.build.json
└── distribution-owned documentation

.overlay (workspace local)
├── config and named codebase mounts
├── runs, artifacts and scratch
├── extension-owned state
└── local-only extension projections

~/.hairness (user local)
├── preferences
├── workspace and local-extension trust
└── canonical-realpath locks
```

Tracked `.hairness/` state belongs to the distribution. Ignored `.overlay/` state belongs to the local workspace. Personal preferences and trust live in `~/.hairness/`. None of these locations activates an extension by presence.

No provider transcript or hidden reasoning crosses these boundaries.
