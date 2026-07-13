# Releasing

A Hairness release is an explicit `ReleaseDeliveryPlan`. Planning and
validation may advance automatically, but publication always stops at a named
authority boundary. The first npm alpha is published manually from one exact
candidate; later versions will use GitHub Trusted Publishing behind a protected
environment approval.

## Alpha policy

Pre-release versions use the npm dist-tag `next`. They MUST NOT be published as
`latest`. Protocol and implementation versions are independent and MUST both be
reported by the CLI.

## Release candidate

Start the explicit release plan with a nested version argument:

```bash
hairness delivery plan --kind release --version <version> --baseline <commit-or-tag>
```

1. Collect all conventional pull requests merged since the previous tag, or
   the configured bootstrap baseline when no tag exists. Exclude release PRs
   and `releaseImpact: none`.
2. Choose the version explicitly, compare it to the SemVer recommendation, and
   open `release/<version>`. The release PR contains only the frozen changelog,
   candidate notes and status metadata.
3. Merge that PR independently, then require a clean tree with
   `HEAD === origin/main` at the exact public commit.
4. Run deterministic checks on Node.js 22 and 24 and fresh Codex dogfood.
   Codex/Claude projection parity remains deterministic; live Claude auth is
   not a release gate.
5. Run `npm ci`, inspect the provider projections and produce one tarball under
   `.overlay/scratch/release/<version>/`.
6. Record its absolute path, SHA-256 and npm integrity; install that exact
   tarball in a temporary workspace; verify `hairness --version` and bootstrap.
7. Run `npm publish <tarball> --dry-run --access public --tag next` on the same
   file and promote one typed `ReleaseCandidate`.

The dry-run commands are safe preparation steps:

```bash
npm pack --dry-run --json
npm publish --dry-run --access public --tag next
```

Immediately before the first publish, Sources must revalidate:

```text
npm identity is thevzion
thevzion remains a package owner
@hairness/cli@0.2.0-alpha.0 does not exist
latest is absent or unchanged
package, version, registry, commit, tarball and digests match the candidate
```

The displayed checkpoint includes those fields. Only an explicit `go` for that
checkpoint permits `npm publish <exact-tarball> --access public --tag next`.
Timeout or unknown output requires `npm view` reconciliation and integrity
comparison before any retry.

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

After npm verification, create the annotated Git tag, push it, and create the
GitHub prerelease through three separate checkpoints. Download the registry
tarball and compare integrity and SHA-256 with the candidate before tagging.
The post-release traceability PR records date, commit, tag, npm URL and digests;
it also introduces Trusted Publishing without `NPM_TOKEN`. The future workflow
publishes one previously qualified artifact after approval by the protected
`npm` environment and never creates a Git tag or GitHub Release.

The prepared alpha notes live in [releases/0.2.0-alpha.0.md](releases/0.2.0-alpha.0.md).
