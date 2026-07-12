# Hairness Status

Current target: `0.2.0-alpha.0`

## Now

- `initiative-delivery-controls`
  - Outcome: The forge plans and prepares its own evolution through typed local state, checkpoints and receipts.
  - State: active
  - Gate: Initiative, sequential delivery and release-candidate dogfood pass without Git or publication effects.
  - Evidence: Initiative state, DeliveryPlan, checkpoint and release-candidate receipts.

## Next

- `npm-alpha`
  - Outcome: The experimental package, documentation and release evidence are ready for a separate publication checkpoint.
  - State: planned
  - Gate: Clean-install, provider and package smokes pass on Node.js 22 and 24.
  - Evidence: Content-addressed tarball, known limitations and release candidate receipt.

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

## References

- [Roadmap](ROADMAP.md)
- [Changelog](CHANGELOG.md)
- [Documentation](docs/README.md)
- [Repository](https://github.com/thevzion/hairness)
