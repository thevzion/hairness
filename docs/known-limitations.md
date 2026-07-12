# Known limitations

These limitations apply to `0.2.0-alpha.0`.

- The npm package is prepared but not published. The documented `npx` flow is
  unavailable until a separate publication checkpoint completes.
- Protocol, command, capability and extension contracts may change before 1.0.
  Exact version pinning is required.
- Codex and Claude provider projections use guarded agent-first-call routing
  where the host cannot guarantee a deterministic command hook.
- The existing Codex attestation is not a cross-provider guarantee.
  Deterministic fixtures do not prove native UI behavior by themselves.
- Claude live qualification depends on a locally authenticated Claude CLI.
- The community catalogue, PackManifest, remote registry and extension search
  are not implemented.
- External routes define the boundary for execution loops and MCP-backed
  operations, but no generic loop adapter ships in this alpha.
- Updates are conservative. Diverged source, changed dependencies and edited
  managed regions require manual review.
- Session intelligence preserves typed digests, not transcripts. It cannot
  reconstruct omitted conversation details.
- Hairness does not provide generic rollback for partial or unknown effects.

Report unexpected behavior through the repository issue templates. Security
issues follow [SECURITY.md](../SECURITY.md).
