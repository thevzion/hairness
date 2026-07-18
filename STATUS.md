# Hairness status

Current target: `0.4.0-alpha.0`

## Now

- `agent-workspace-kernel-reset`
  - Outcome: prove `create → build → Targets/Integrations → prologue → Scratch`
    from a packed candidate runtime.
  - State: implementing
  - Gate: private multi-Target Home, provider parity and complete package matrix.

## Removed at cutover

- Distributions and presets;
- work, map and delivery recipes;
- generic Artifact, Operation, Checkpoint and Receipt engines;
- resumable onboarding and Overlay lifecycle engines;
- global per-Home runtime.

## Release gates

- README, SPEC, schemas, CLI, providers and tests describe one v0.4 grammar.
- Only `hairness`, `hairness-onboarding` and `hairness-scratch` are core commands.
- Tracked Home documents contain no local Target path or secret.
- Package contains no Overlay, runtime, Target, private path or generated output.
- Node.js 22 and 24 pass.
- A packed-tarball Home binds three independent Targets and rebuilds both
  providers without touching unmanaged files.
