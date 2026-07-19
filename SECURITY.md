# Security policy

Report vulnerabilities through GitHub Security Advisories. Do not open a public
issue for path traversal, arbitrary code execution, supply-chain compromise,
credential exposure or ownership bypass.

Only the latest prerelease is supported during alpha.

## Package boundary

- Package specs are exact.
- Every npm operation disables lifecycle scripts.
- Manifests reject unknown fields and escaping paths.
- Package asset and template symbolic links are rejected.
- A package is inactive until selected in `hairness.json`.

## Adapter boundary

Adapters are trusted package code. `--allow-build` records explicit approval;
it does not provide an operating-system sandbox.

Hairness runs an approved Adapter in staging with bounded time and output size.
Only declared output roots are accepted. Symbolic links, foreign paths,
unmanaged collisions and owner collisions stop the build before reconciliation.

## Local data

Targets are independent repositories bound by ignored symbolic links.
Integrations store accessor choices, never credentials. Do not persist secrets,
auth state, customer data, production data, transcripts or hidden reasoning in a
Home or Scratch.

Hairness creates no remote and performs no automatic push, merge, tag, release
or publication.
