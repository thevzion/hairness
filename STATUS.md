# Hairness Status

Current target: `0.2.0-alpha.0`

## Now

- `managed-worktrees`
  - Outcome: Isolate every Hairness-controlled versioned mutation in an explicit checkout with one writer lease and recoverable receipts.
  - State: active
  - Gate: Merge Worktree Controls, run live doctor/reconciliation, then dogfood the complete release flow from managed checkouts.
  - Evidence: Worktree, Sources, Codebase and Delivery owner tests plus a fresh Codex draft-PR receipt.

- `trusted-publishing`
  - Outcome: Make future npm releases use GitHub OIDC with one qualified artifact and no long-lived publish token.
  - State: active
  - Gate: Merge the manual release workflow, protect the `npm` environment, configure the exact npm trusted publisher and verify it live.
  - Evidence: `.github/workflows/release.yml`, environment approval rules and `npm trust list @hairness/cli`.

## Completed

- `npm-alpha`
  - Outcome: Published the public alpha with reconciled npm proof, an exact Git tag and a GitHub prerelease.
  - State: completed
  - Evidence: [npm package](https://www.npmjs.com/package/@hairness/cli/v/0.2.0-alpha.0), [GitHub prerelease](https://github.com/thevzion/hairness/releases/tag/v0.2.0-alpha.0), matching registry integrity and release receipts.

## Next

- `npm-alpha.1`
  - Outcome: Publish `@hairness/cli@0.2.0-alpha.1` through the protected OIDC workflow from a detached qualified checkout.
  - State: planned
  - Gate: Worktree Controls merged, local inventory reconciled and npm Trusted Publisher relation verified live.
  - Evidence: Exact workflow artifact, SHA-256, npm integrity, provenance, dist-tags and fresh npx bootstrap.

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
