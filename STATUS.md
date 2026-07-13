# Hairness Status

Current target: `0.2.0-alpha.0`

## Now

- `npm-alpha`
  - Outcome: Dogfood policy-driven agentic delivery, merge one release PR, and publish the exact qualified `@hairness/cli` alpha.
  - State: active
  - Gate: The feature PR and release PR pass Node.js 22/24 plus delivery policy; fresh Codex dogfood produces one validated ReleaseCandidate and explicit npm checkpoint.
  - Evidence: Deterministic Codex/Claude command parity, correlated delivery receipts, public release commit, content-addressed tarball and npm integrity.

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
- Fresh Codex delivery dogfood is blocking for npm. Codex/Claude projections must remain deterministically identical; live Claude authentication is not required.

## References

- [Roadmap](ROADMAP.md)
- [Changelog](CHANGELOG.md)
- [Documentation](docs/README.md)
- [Repository](https://github.com/thevzion/hairness)
