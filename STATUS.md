# Hairness Status

Current target: `0.2.0-alpha.0`

## Now

- `npm-alpha`
  - Outcome: The verified alpha is available from npm with public provenance.
  - State: active
  - Gate: Public CI is green and the release checkpoint is approved.
  - Evidence: Public repository, npm provenance and install smoke receipts.

## Next

- `alpha-hardening`
  - Outcome: Provider behavior, managed outputs and recovery routes are release-grade.
  - State: planned
  - Gate: Milestone behavior suites and native provider smokes pass.
  - Evidence: Content-addressed eval attestations and CI receipts.

- `methodology-adapters`
  - Outcome: Selected provider-native methods are reusable through semantic bindings without runtime capture.
  - State: planned
  - Gate: Binding fixtures and one reviewed real methodology pass provider parity and artifact normalization.
  - Evidence: Binding conformance and provider eval attestations.

- `source-aware-cockpit`
  - Outcome: Cockpit signals use fresh source evidence without adding network work to session opening.
  - State: planned
  - Gate: Source freshness, latency and failure-mode suites pass.
  - Evidence: Deterministic source receipts and provider behavior attestations.

## Blocked

- None.

## Release gates

- Generic package contains no private composition or local state.
- Provider projections and generated distributions match their canonical sources.
- Node.js 22 and 24 checks pass.
- Public history and package scans contain no secrets, transcripts or private paths.

## References

- [Roadmap](ROADMAP.md)
- [Changelog](CHANGELOG.md)
- [Documentation](docs/README.md)
- [Repository](https://github.com/thevzion/hairness)
