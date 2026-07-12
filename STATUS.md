# Hairness Status

Current target: `0.2.0-alpha.0`

## Now

- `invocation-engine`
  - Outcome: Natural and direct requests resolve to one traceable invocation contract.
  - State: active
  - Gate: Preview, one-gap resolution, `--auto`, event recovery and receipt contracts pass.
  - Evidence: Reconstructible invocation event streams and behavior tests.

## Next

- `provider-intent-controls`
  - Outcome: Codex and Claude use compact instructions and the same deterministic invocation path.
  - State: planned
  - Gate: Provider parity, budgets and native smokes pass.
  - Evidence: Content-addressed behavior attestations.

- `initiative-delivery-controls`
  - Outcome: The forge plans and ships its own evolution through typed local artifacts and checkpoints.
  - State: planned
  - Gate: Roadmap, delivery and release-candidate dogfood passes.
  - Evidence: Initiative, delivery and launch-kit receipts.

- `npm-alpha`
  - Outcome: The experimental package, documentation and release evidence are ready for a separate publication checkpoint.
  - State: planned
  - Gate: Clean-install, provider and package smokes pass on Node.js 22 and 24.
  - Evidence: Content-addressed tarball, known limitations and release candidate receipt.

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
