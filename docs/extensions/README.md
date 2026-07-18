# Extension contract

An extension is a portable package of agentic assets. The canonical source is
provider-neutral; Hairness generates Codex and Claude projections.

```text
acme/review/
├── extension.json
└── skills/review/skill.md
```

The manifest uses `hairness.dev/extension/v1alpha2` and may contain:

- `instructions` — context included in the managed Home contract;
- `skills` — reusable neutral Markdown abilities;
- `commands` — explicit human entrypoints pointing at a Skill;
- one bounded read-only `prologue` contributor;
- `checks`, `configSchema` and direct `requires` dependencies.

`skill.md` is the source. `SKILL.md` is provider output. A source is inspected
without executing code, rejects symlinks, nested locks, provider-native files
and paths outside its root. Physical presence never activates an extension.

```bash
hairness extension add ./extensions/acme/review
hairness extension add https://github.com/acme/review.git --ref v1.2.0
hairness extension list
hairness extension doctor
hairness extension update acme/review
hairness extension remove acme/review
```

Git refs are locked to commits and tree digests. An intact installation can be
updated mechanically; local divergence stops and asks for a human merge. Home
configuration is namespaced by extension ID and validated by its optional
schema. There is deliberately no generic lifecycle hook, workflow engine,
artifact type system or migration framework.
