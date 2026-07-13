# Hairness Status

Current target: `0.2.0-alpha.0`

## Now

- `npm-alpha`
  - Outcome: Complete the public alpha through reconciled npm proof, an exact Git tag and a GitHub prerelease.
  - State: active
  - Gate: Reconcile the observed dist-tag deviation, then create the tag, push it and publish the GitHub prerelease through separate checkpoints.
  - Evidence: Public npm version, matching registry integrity and bootstrap, immutable publication receipt, reconciliation record and exact release commit.

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

- `session-orchestration`
  - Outcome: Coordinate independent agent sessions without turning Hairness into a provider runtime.
  - State: planned
  - Gate: Workspace/global registry, ownership, leases, locks, attention and resumption are proven before scheduling or issue automation.
  - Evidence: Cross-session collision, recovery and PR-only adapter receipts.

## Blocked

- None.

## Release gates

- README, SPEC, schemas, CLI, projections and tests describe the same grammar.
- Minimal, standard and forge payloads contain selected source only.
- Generic package contains no local state, private composition, secret, transcript or private path.
- Node.js 22 and 24 checks pass.
- Fresh Codex delivery dogfood is blocking for release effects. Codex/Claude projections must remain deterministically identical; live Claude authentication is not required.

## References

- [Roadmap](ROADMAP.md)
- [Changelog](CHANGELOG.md)
- [Documentation](docs/README.md)
- [Repository](https://github.com/thevzion/hairness)
