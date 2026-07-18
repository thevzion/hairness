---
id: 0015-agent-workspace-kernel-reset
status: accepted
owners: [hairness/kernel]
signals: [home, target, integration, extension, prologue, scratch]
paths: [src, schemas/v4, assets/core, docs]
---

# 0015: Agent Workspace Kernel reset

Hairness is a lightweight, provider-agnostic Kernel for agent workspaces. A Home
owns portable agentic assets and explicit human memory. Git Targets remain
independent repositories and may be bound through either a clone or a worktree.

## Decision

- The Kernel and Home are the only product roles. Distribution is removed.
- Home documents declare providers, active extensions, Git Target identities,
  Integrations and namespaced extension config.
- Machine state lives below ignored `.hairness/`; human memory lives in tracked
  `.overlay/`; ignored `targets/<id>` symlinks are the only local Target bindings.
- A Scratch is one freely editable `scratch.md`. Accepted documents may be kept
  as ordinary files; Hairness does not impose a generic Artifact envelope.
- Extensions declare provider-neutral instructions, Skills, Commands, one
  optional bounded prologue contributor, checks, config and direct dependencies.
- The Kernel projects only `hairness`, `hairness-onboarding` and
  `hairness-scratch`. Thinking methods belong to Think It Through.
- The prologue has exactly three sections: preferences, facts and signals. It is
  orientation, never a promise of live health.

## Removals

The reset removes Distributions, presets, work recipes, maps, delivery, generic
Artifacts, Operations, receipts, checkpoints, Overlay snapshots, resumable
onboarding state and global per-Home runtime. There is no v0.3 reader, alias,
migration or archive path.

## Anti-goals

- no provider runtime, scheduler, workflow or worktree manager;
- no generic Action, Artifact Type, Gate or lifecycle-hook framework;
- no transcript, reasoning store or implicit persistence;
- no automatic installation, authentication, remote, push or publication;
- no company-specific assets or source-owned runtime in this slice.

ADRs 0013 and 0014 are superseded. The non-invasive authority principle from
ADR 0002 remains valid.
