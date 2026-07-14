# Hairness Status

Current target: `0.3.0-alpha.0`

## Now

- `architectural-reset`
  - Outcome: Replace the v0.2 orchestration model with the lightweight v0.3 Home, Extension, Scratch, Artifact and checkpoint model.
  - State: active
  - Gate: The packed-tarball journey proves `create → build → onboarding → Scratch → map → save → ship` on Node.js 22 and 24.
  - Evidence: ADR 0013, golden journeys, contract fixtures and the reset qualification matrix.

## Completed

- `npm-alpha`
  - Outcome: Published the public alpha with reconciled npm proof, an exact Git tag and a GitHub prerelease.
  - State: completed
  - Evidence: [npm package](https://www.npmjs.com/package/@hairness/cli/v/0.2.0-alpha.0), [GitHub prerelease](https://github.com/thevzion/hairness/releases/tag/v0.2.0-alpha.0), matching registry integrity and release receipts.

## Next

- `reset-dogfood`
  - Outcome: Exercise the Standard Home against independent repositories and harden only failures observed in the golden journey.
  - State: planned
  - Gate: The reset PR is green and its adaptive checkout replaces the useful evidence from PR #17.
  - Evidence: Fresh lab Home, provider projections and delivery receipts.

## Blocked

- None.

## Release gates

- README, SPEC, schemas, CLI, projections and tests describe the same v0.3 grammar.
- Minimal and Standard select only their declared extensions; maintainer remains explicit.
- The npm package contains no Overlay, runtime state, private path, secret, transcript or generated provider output.
- Node.js 22 and 24 checks pass.
- Fresh Codex delivery dogfood is blocking for release effects. Codex/Claude projections must remain deterministically identical; live Claude authentication is not required.

## References

- [Roadmap](ROADMAP.md)
- [Changelog](CHANGELOG.md)
- [Documentation](docs/README.md)
- [Repository](https://github.com/thevzion/hairness)
