# Extensions

Extensions are the executable owners of team and workflow capabilities. The core owns the grammar; extensions own commands, policies, contributions and behavior.

```text
extensions/<owner>/<name>/
├── extension.json
├── index.mjs
├── commands/
├── guidance/
├── schemas/
├── test-suites/
├── tests/
└── README.md
```

`extension.json` declares commands, methodology bindings, modifiers, relations, dependencies, services, sources, onboarding questions, attention contributions, provider instructions and artifact schemas. `index.mjs` implements only declared surfaces. A source-only extension needs no command handler.

Handlers receive a frozen runtime. Cross-extension services require declared dependencies. Source reads use `runtime.sources.read`; extension state is restricted to `.overlay/extensions-state/<extension-id>/`.

Provider instructions and artifact schemas remain inside their owner directory. Provider compilation hashes instructions. Artifact promotion rejects unowned types, duplicate owners and invalid payloads.

## Shared ownership

Shared extensions live in `extensions/` and become source-owned by the distribution. Physical presence never activates an extension; `hairness.json` selects the shared composition.

```bash
hairness extension add <owner/name> --from <path|tarball|npm-spec>
hairness extension remove <owner/name>
```

Both operations return a checkpoint before copying or removing source and rebuilding shared projections.

## Local ownership

Local extensions live under `.overlay/extensions/`, require explicit trust and never enter shared projections.

```bash
hairness extension init --local <owner/name>
hairness extension link --local <owner/name> --from <path>
hairness extension unlink --local <owner/name>
hairness build --local
```

`init` creates a private extension. `link` references an externally owned checkout without copying it. `unlink` removes only the local reference, trust entry and local projection; it never mutates the source.

Implicit registries and automatic background updates are outside protocol `0.2`. The `hairness/distribution` extension may explicitly inspect a configured path, tarball, or npm source and propose a conservative source-owned update.

See the [generic extension catalogue](catalog.md).
