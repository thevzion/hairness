# Hairness status

Current target: `0.3.0-alpha.0`

## Now

- `post-merge-80-20`
  - Outcome: prove the complete `create → onboarding → Targets/Sources → Scratch → map → Artifact → ship` path with a real Hupso consumer.
  - State: ready
  - Gate: generic suite, packed-tarball Hupso dogfood and draft PR evidence.
  - Evidence: ADR 0014, 34 integration tests, Node 22/24, packed-tarball lab, and the local `hupso-hairness` consumer proof.

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

- `post-merge-80-20-review`
  - Outcome: review the one breaking polish PR without publishing or merging it from this workstream.
  - State: planned
  - Gate: Node 22/24, package checks, Hupso golden journey and maintainer approval.

- `external-dogfood`
  - Outcome: harden only failures observed in real Homes and independent Targets.
  - State: planned
  - Gate: recurring failures become a rule, schema, gate or test.

## Release gates

- README, SPEC, schemas, CLI, providers and tests describe one v0.3 grammar.
- Minimal and Standard select only declared extensions; maintainer is upstream-only.
- `opening` and `hairness/codebase` are absent; Target identity is core and map belongs to work.
- Tracked documents contain no local Target path; Source Runtime contains no secret or fetched result.
- Package contains no Overlay, runtime state, private path, secret, transcript, test fixture or generated provider output.
- Node.js 22 and 24 pass.
- Fresh packed-tarball Home completes onboarding, Scratch, map, save and ship-to-checkpoint.
