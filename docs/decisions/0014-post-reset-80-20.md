# ADR 0014 — Post-reset 80/20 vertical slice

Status: accepted

## Context

The v0.3 architectural reset established the right ownership boundaries but its
first public slice still exposed setup friction: language lived in the Home,
Target paths were hidden in Runtime, `opening` duplicated `doctor`, Sources had
no concrete access contract, and Standard carried a separate codebase extension.

## Decision

- Keep the npm runtime model for this slice; defer source-owned runtime install.
- Put stable personal preferences only in `.overlay/profile.json`.
- Make Target identity a core capability and bind checkouts through ignored
  `targets/<id>` symlinks matched by normalized Git remotes.
- Let `hairness/sources` own CLI/provider/none access declarations and keep
  credential-free selections only in local Runtime.
- Remove `opening` and make `doctor [--json]` the only live macro view.
- Move live Target mapping into `hairness/work`; saved maps are ordinary typed
  Artifacts and have no separate index.
- Let Distributions seed expected Targets and namespaced extension config, then
  sever the Distribution relationship after Home creation.
- Keep create on `node:readline/promises` and use one resumable agent onboarding
  checkpoint for profile, Targets, Sources, config, build and doctor.

## Anti-goals

No TUI, form engine, source installer, authentication manager, Target registry,
map index, provider scheduler, marketplace, Distribution synchronization,
in-place compatibility layer, or automatic clone selection is introduced.

## Consequences

The smallest useful path is now `create → onboarding → live Target/Source proof
→ optional Scratch → accepted Artifact → checkpointed ship`. Local machine
bindings stay inspectable without contaminating source-owned documents, and a
company Distribution can express its required environment without coupling the
kernel to company behavior.
