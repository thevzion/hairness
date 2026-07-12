# Releasing

A Hairness release is an explicit delivery operation. Planning and validation
may be automated; publication never is.

## Alpha policy

Pre-release versions use the npm dist-tag `next`. They MUST NOT be published as
`latest`. Protocol and implementation versions are independent and MUST both be
reported by the CLI.

## Release candidate

1. Require a clean Git tree and the expected public commit.
2. Run deterministic checks on Node.js 22 and 24.
3. Review deterministic provider parity, existing attestations and explicit live limits.
4. Generate the changelog preview from accepted Conventional Commits.
5. Inspect provider projections and the npm tarball file list.
6. Install the exact tarball and create a temporary distribution from it.
7. Record the tarball SHA-256, known limitations, test receipts and rollback.
8. Produce a typed `ReleaseCandidate` and review its checkpoint.

The dry-run commands are safe preparation steps:

```bash
npm pack --dry-run --json
npm publish --dry-run --access public --tag next
```

## External effects

The following actions require separate confirmation and receipts:

```text
npm publish --access public --tag next
git tag v0.2.0-alpha.0
git push origin v0.2.0-alpha.0
GitHub Release publication
social or community posts
```

Do not combine package publication, Git tagging, GitHub Release publication,
or announcements into one implicit approval. If an effect is partial or its
result is unknown, stop and reconcile before continuing.

The prepared alpha notes live in [releases/0.2.0-alpha.0.md](releases/0.2.0-alpha.0.md).
