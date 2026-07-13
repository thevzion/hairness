# Extensions

Extensions are the executable owners of Hairness behavior.

```text
extensions/<owner>/<name>/
├── extension.json
├── README.md
├── capabilities/*.json
├── index.mjs
├── commands/
├── schemas/
├── guidance/
├── drivers/
└── tests/
```

`extension.json` declares summary, discovery category, tags, maturity, README, dependencies, capability files, provider commands, services, contributions, modifiers, relation types, artifact schemas, source drivers, and declarative onboarding questions. Categories organize the catalogue but never enter an extension ID or physical path. Each declared implementation file remains inside its owner.

Capability files declare operations. Provider-independent CommandSurfaceSpecs
declare bridge, namespace, intent, or specialized projections. Every non-bridge
surface references one operation; names and ResultContracts are derived by the
compiler. Provider instructions define host behavior while fixed intent
controls remain immutable.

Handlers receive a frozen runtime. Cross-extension services require declared dependencies. Extension state is limited to `.overlay/extensions-state/<extension-id>/`. There is no generic source API: a business extension depends on `hairness/sources` and calls its declared service.

## Shared source

```bash
hairness extension add <owner/name> --from <path|tarball|npm-spec>
hairness extension remove <owner/name>
```

Add inspects an explicit source, resolves dependency closure, shows a checkpoint, copies source, updates the manifest, and rebuilds projections. Copying transfers ownership to the distribution.

## Local source

```bash
hairness extension init --local <owner/name>
hairness extension link --local <owner/name> --from <path>
hairness extension unlink --local <owner/name>
hairness build --local
```

Linking preserves external ownership. It requires explicit path trust and affects only ignored local projections. Unlink never deletes the source.

`init --local` creates one disabled experimental scaffold with a manifest, module and complete README contract. The main-session agent may fill its capability, schemas, instructions and tests, but Hairness validates them before enablement. Promotion uses `extension add --from` and an explicit checkpoint.

## Documentation contract

Every extension README explains value and use cases, selection and setup, capabilities and operations, inputs and results, state and artifacts, effects and safety, provider projections, tests and maturity. `official` means maintained by Hairness; `verified` means conformance for a pinned version, not automatic trust.

Community extensions remain source-owned in their publisher repository. A future registry may index immutable source, commit and digest, but discovery never grants trust or authority.

Removing or disabling an extension removes all of its active capabilities, operations, commands, services, contributions, schemas, drivers, and projections. A used dependency cannot be disabled.

See the [catalogue](catalog.md).
