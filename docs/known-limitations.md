# Known limitations

These limitations apply to `0.2.0-alpha.0`.

- The npm alpha uses the prerelease channel `next`; `latest` is intentionally
  not used. Pin `@hairness/cli@0.2.0-alpha.0` for reproducible evaluation.
- Package publication, Git tagging and GitHub Release creation remain separate
  authority boundaries. A successful pull-request merge never grants them.
- Protocol, command, capability and extension contracts may change before 1.0.
  Exact version pinning is required.
- Provider command files are lossy projections of Hairness metadata. The
  canonical model lives in extension manifests, capabilities, invocations and
  generated build metadata.
- Operational memory covers Hairness intent commands, routed methodology
  bindings and their Runs. Free conversation, direct third-party skills and raw
  provider tool calls are not captured.
- The alpha ledger is append-only and un-compacted. Legacy pre-epoch entries
  remain inspectable but are excluded from current attention alerts.
- Codex and Claude provider projections use guarded agent-first-call routing
  where the host cannot guarantee a deterministic command hook.
- Fresh Codex dogfood is not a cross-provider runtime guarantee. Deterministic
  fixtures prove projection parity, not native UI behavior on every host.
- The community catalogue, PackManifest, remote registry and extension search
  are not implemented.
- External routes define the boundary for execution loops and MCP-backed
  operations, but no generic loop adapter ships in this alpha.
- Delivery Controls coordinates one session at a time. Workspace/global task
  registries, leases, cross-session ownership, attention scheduling, autonomous
  issue intake and PR-only loops remain post-alpha work.
- Updates and migrations are conservative. Diverged source, changed
  dependencies, linked local extensions and edited managed regions require
  manual review. Hairness does not codemod arbitrary consumer code.
- Session intelligence preserves typed digests, not transcripts. It cannot
  reconstruct omitted conversation details.
- Hairness does not provide generic rollback for partial or unknown effects.

Report unexpected behavior through the repository issue templates. Security
issues follow [SECURITY.md](../SECURITY.md).
