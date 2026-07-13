# Hairness Status

Current target: `0.2.0-alpha.0`

## Now

- `npm-alpha`
  - Outcome: Qualify the intent language, operational memory, exact promotion and migrations before npm/public release.
  - State: active
  - Gate: Repository/package checks pass and both providers complete the full dogfood path.
  - Evidence: Command parity, trace, migration receipt, content-addressed tarball and two provider attestations.

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
- Fresh Codex and Claude dogfood is blocking for npm, GitHub release and public communication.

## References

- [Roadmap](ROADMAP.md)
- [Changelog](CHANGELOG.md)
- [Documentation](docs/README.md)
- [Repository](https://github.com/thevzion/hairness)
