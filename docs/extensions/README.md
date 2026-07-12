# Extensions

Extensions are the executable owners of Hairness behavior.

```text
extensions/<owner>/<name>/
├── extension.json
├── capabilities/*.json
├── index.mjs
├── commands/
├── schemas/
├── guidance/
├── drivers/
└── tests/
```

`extension.json` declares dependencies, capability files, provider commands, services, contributions, modifiers, relation types, artifact schemas, source drivers, and declarative onboarding questions. Each declared implementation file remains inside its owner.

Capability files declare operations. Commands of kind `capability` or `preset` reference one operation. Provider instructions define provider behavior; the compiler adds only common safety guidance.

Handlers receive a frozen runtime. Cross-extension services require declared dependencies. Extension state is limited to `.overlay/extensions-state/<extension-id>/`. There is no generic source API: a business extension depends on `hairness/sources` and calls its declared service.

## Shared source

```bash
hairness extension add <owner/name> --from <path|tarball|npm-spec>
hairness extension remove <owner/name>
```

Add inspects an explicit source, resolves dependency closure, shows a checkpoint, copies source, updates the manifest, and rebuilds projections. Copying transfers ownership to the distribution.

## Local source

```bash
hairness extension link --local <owner/name> --from <path>
hairness extension unlink --local <owner/name>
hairness build --local
```

Linking preserves external ownership. It requires explicit path trust and affects only ignored local projections. Unlink never deletes the source.

Removing or disabling an extension removes all of its active capabilities, operations, commands, services, contributions, schemas, drivers, and projections. A used dependency cannot be disabled.

See the [catalogue](catalog.md).
