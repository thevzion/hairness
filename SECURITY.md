# Security

Hairness treats manifests, extensions, mounts, providers, and source tools as trust boundaries.

- Trust a workspace and executable extension before loading it.
- Grant effects per operation; never infer write authority from access.
- Keep credentials and auth artifacts in their existing tools, not Hairness.
- Never store secrets, customer data, private production data, provider transcripts, or model reasoning in `.overlay/`.
- Quarantine targets after ambiguous or partial execution.
- Stop with `review-required` instead of overwriting edited managed regions or JSON entries.
- Keep replayable E2E effects inside `.overlay/test-runs/<suite>/<attempt>/`.
- Report vulnerabilities privately to the repository owner while the project remains private.
