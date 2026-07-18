---
id: 0013-v0-3-clean-architectural-reset
status: superseded
owners: [hairness/cockpit]
signals: [home, distribution, extension, overlay, scratch, delivery]
paths: [src, schemas, distributions, assets/extensions/hairness, docs/architecture.md, docs/persistence.md]
---

# 0013: Hairness v0.3 clean architectural reset

Superseded by [ADR 0015](0015-agent-workspace-kernel-reset.md).

Hairness is a lightweight, provider-agnostic harness for agentic assets. The npm
runtime owns deterministic composition, validation and effects. A generated Home
owns the human-facing assets that shape native Codex and Claude sessions. Target
repositories remain independent inputs; a Home is never coupled to one checkout.

## Product invariants

- Agentic assets are software: they are explicit, typed where repeatability needs
  a contract, reviewable, testable and source-owned.
- Recipes remain direct provider conversations. Chat does not create protocol
  events, hidden runs, receipts or persistence as a side effect.
- A session is ephemeral until the human attaches it to a Scratch.
- Scratch is flexible working memory. Artifacts are accepted, typed outcomes.
- Effects require an exact, revalidated Checkpoint and produce a Receipt.
- Providers own their runtime, UI, threads and native skills. Hairness compiles a
  small native command surface without owning provider directories.
- Installed files do not activate an extension. `hairness.json` is the sole
  composition authority.
- Git supplies revision history. Hairness does not recreate revision graphs,
  controller pools, worktree pools or a generic workflow engine.

## Reset boundary

v0.3 has no compatibility layer for v0.2 commands, APIs, documents, Home layout,
Overlay layout or runtime state. Existing Overlays may only be archived opaquely;
selected human content may then be imported through the generic Scratch importer.
The supported upgrade is to create a new Home.

Type-specific `apiVersion` values replace global schema and protocol versions.
SemVer versions packages and extensions. The public model contains Home,
Distribution, Extension, Scratch, Artifact, Gate, Checkpoint and Receipt. It does
not contain Forge, Invocation, Run, Plan, Worker, fan-in, Semantic Ledger,
Attention Index or a generic material graph.

## Anti-goals

- no provider runtime or scheduler;
- no hosted marketplace;
- no implicit authority, remote, push, tag or publication;
- no distribution synchronization after bootstrap;
- no shared multi-user memory, transcript capture or hidden reasoning store;
- no generic migration, three-way merge or workflow engine;
- no public worktree orchestration surface;
- no Hupso-specific policy in the Hairness package.

This decision supersedes decisions 0001, 0003, 0004, 0005, 0008, 0009, 0010,
0011 and 0012 where their source-owned kernel, Forge, tracked projection,
material, update, invocation or artifact-graph models conflict with this reset.
The non-invasive authority principle from decision 0002 remains valid.
