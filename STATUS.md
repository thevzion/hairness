# Hairness Status

Current target: `0.2.0-alpha.0`

## Now

- `npm-alpha`
  - Outcome: The experimental package, documentation and release evidence are ready for a separate publication checkpoint.
  - State: active
  - Gate: Deterministic package and distribution validation passes, followed by one consolidated provider campaign.
  - Evidence: Content-addressed tarball, known limitations, release candidate receipt and provider attestations.

## Next

- `alpha-hardening`
  - Outcome: Stabilize the public contracts from external dogfooding feedback.
  - State: planned
  - Gate: Repeated failures become migrations, gates or owner tests.
  - Evidence: Compatibility notes and hardening receipts.

- `execution-adapters`
  - Outcome: Prove one external loop adapter without turning Hairness into a loop runtime.
  - State: planned
  - Gate: External route preserves authority, typed results and fan-in.
  - Evidence: Adapter conformance and bounded execution receipt.

## Blocked

- None.

## Release gates

- README, SPEC, schemas, CLI, projections and tests describe the same grammar.
- Minimal, standard and forge payloads contain selected source only.
- Generic package contains no local state, private composition, secret, transcript or private path.
- Node.js 22 and 24 checks pass.
- Native provider qualification is run once after deterministic validation, not during each implementation step.

## References

- [Roadmap](ROADMAP.md)
- [Changelog](CHANGELOG.md)
- [Documentation](docs/README.md)
- [Repository](https://github.com/thevzion/hairness)
