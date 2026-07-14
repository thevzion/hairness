# Hairness status

Current target: `0.3.0-alpha.0`

## Now

- `architectural-reset-review`
  - Outcome: review and merge the qualified v0.3 reset without expanding its compatibility surface.
  - State: ready
  - Gate: PR #18 CI and maintainer approval.
  - Evidence: the eight reset commits and PR qualification summary.

## Completed

- `architectural-reset-qualification`
  - Outcome: qualify the clean v0.3 Home, Extension, Scratch, Artifact and delivery model for merge.
  - State: completed
  - Evidence: Node.js 22/24, 27 tests, packed-tarball lab, provider parity, conformance, package, YAML and npm audit gates.

- `v0.3-vertical-slice`
  - Outcome: prove `create → build → onboarding → Scratch → map → save → ship` before public cutover.
  - State: completed
  - Evidence: v0.3 integration suites and exact PR checkpoint test.

- `v0.2-removal`
  - Outcome: remove the orchestration, Forge, material graph, migrations, old extensions and tracked provider outputs without compatibility shims.
  - State: completed
  - Evidence: atomic cutover commit and source-model gate.

## Next

- `0.3.0-alpha.0-release`
  - Outcome: publish the exact qualified package after the reset PR merges.
  - State: planned
  - Gate: separate release PR; npm publish, Git tag and GitHub Release remain separate checkpoints.

- `external-dogfood`
  - Outcome: harden only failures observed in real Homes and independent Targets.
  - State: planned
  - Gate: recurring failures become a rule, schema, gate or test.

## Release gates

- README, SPEC, schemas, CLI, providers and tests describe one v0.3 grammar.
- Minimal and Standard select only declared extensions; maintainer is upstream-only.
- Package contains no Overlay, runtime state, private path, secret, transcript, test fixture or generated provider output.
- Node.js 22 and 24 pass.
- Fresh packed-tarball Home completes onboarding, Scratch, map, save and ship-to-checkpoint.
