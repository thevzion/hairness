# Hairness Status

Current target: `0.2.0-alpha.0`

## Now

- `agentic-foundation-reset`
  - Outcome: Capability → Operation → Route → Result is the single executable grammar and every behavior has an extension owner.
  - State: active
  - Gate: Clean-break schemas, 24-command parity, selected-only distributions, Node 22/24, package and native provider smokes pass.
  - Evidence: CI receipts, generated distribution checks, provider build manifest and draft PR.

## Next

- `npm-alpha`
  - Outcome: The verified MIT alpha is available from npm with public provenance.
  - State: planned
  - Gate: Public CI is green and the publication checkpoint is approved.
  - Evidence: Package provenance and clean install receipts.

- `alpha-hardening`
  - Outcome: Provider behavior, managed outputs and recovery routes are release-grade.
  - State: planned
  - Gate: Milestone behavior suites and native provider smokes pass.
  - Evidence: Content-addressed eval attestations and CI receipts.

- `execution-adapters`
  - Outcome: External execution loops can implement Hairness operations without losing their native runtime.
  - State: planned
  - Gate: One adapter proves authority, typed result, recovery and fan-in without runtime capture.
  - Evidence: Adapter conformance suite and provider-native smoke.

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
