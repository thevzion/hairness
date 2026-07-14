# Security policy

Report vulnerabilities privately through GitHub Security Advisories. Do not open
a public issue for secrets, arbitrary code execution, path traversal, checkpoint
bypass, unsafe Git cleanup, or supply-chain concerns.

## Supported versions

Only the latest published prerelease is supported during alpha. Users should pin
exact versions and keep provider, Node.js, npm, Git, and operating-system updates
current.

## Trust boundary

Hairness extensions are code and instructions. Source inspection validates the
manifest and declared files without importing adapter modules. Activation requires
an explicit composition checkpoint. Effect adapters require a second, exact
operation checkpoint; installing an extension does not authorize its effects.

Git refs are resolved to immutable commits and subtree digests. Local divergence
blocks mechanical updates. npm installation during Home creation uses
`--ignore-scripts`.

## Local data

Home source may be committed. `.overlay/` and `~/.hairness/` are local by default.
Do not store credentials, secrets, customer data, transcripts, or reasoning traces
in either location. Overlay snapshots reject common credential paths, symbolic
links, and oversized files. Hairness creates no remote and performs no automatic
push.

Generated provider output ownership is path-exact. Hairness does not clear native
provider directories. Target paths, checkout locks, checkpoints, caches, and logs
remain outside tracked Home documents.

## Effects

An effect checkpoint binds exact inputs, Target identity and state, evidence, and
policy. Apply revalidates all of them. Stale state refuses execution. Partial or
unknown outcomes produce immutable Receipts and stop replay. Worktree cleanup
refuses dirty state and never forces deletion implicitly.
