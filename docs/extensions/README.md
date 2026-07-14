# Extension contract

An Extension is a portable package of agentic assets. Hairness supplies the
harness and provider compilers; the extension supplies domain behavior.

## Smallest useful extension

```text
acme/review/
├── extension.json
└── review.md
```

The manifest declares identity, capabilities, recipes, adapters, schemas, gates,
onboarding, and tests. Every list is explicit, including empty lists. Declared
paths must stay within the extension root.

Recipes are provider-neutral Markdown and converse directly. They should not call
the CLI to generate ordinary chat. The compiler adds provider syntax, language,
ownership, persistence, and authority rules.

## Capabilities and composition

`spec.provides` and `spec.requires` contain capability IDs. Build rejects missing
requirements, multiple providers of one capability, and command collisions.
Physical source presence never activates an extension.

An extension may point `spec.configSchema` at its own JSON Schema. Its config
lives only at `Home.spec.config[extension-id]`. Invalid or missing config blocks
that owner's adapters, not its onboarding recipes. Home-local extension packages
share the root npm workspace and lock; Hairness never creates nested locks.

Minimal selects cockpit and work. Standard adds sources and delivery. Target
identity is native core capability and `hairness-map` belongs to work.
The upstream maintainer extension is explicitly selected only by the Hairness
development Home.

## Adapters

Adapters declare one mode:

- `observe`: deterministic read;
- `derive`: deterministic transformation;
- `effect`: external or filesystem mutation.

Observe and derive export `run()` and use `hairness operation run`. Effect
adapters export separate `prepare()` and `apply()` functions. Prepare describes
the exact Target, evidence, and policy. Apply runs only after checkpoint
revalidation.

## Gates and onboarding

Delivery gates attach to `after-implementation`, `before-publish-pr`,
`before-merge`, or `after-merge`. Onboarding entries are declarative questions
with optional conditions and explanations. No extension module is imported while
an untrusted source is inspected.

## Sources and updates

```bash
hairness extension add ./extensions/acme/review
hairness extension add ./path/to/extension
hairness extension add https://github.com/acme/review.git --ref v1.2.0 --path extensions/acme/review
```

Git refs resolve to commits. The lock stores source, requested ref, resolved
commit, subtree digest, and installed base digest. Update is mechanical only for
an intact install. `adopt` accepts deliberate local source. Divergence otherwise
requires a human merge. Removing an extension never deletes personal Artifacts
and blocks when another active extension requires its capabilities.

## Authoring lifecycle

```bash
hairness extension init acme/review
hairness extension doctor acme/review
hairness extension add ./extensions/acme/review
hairness extension update acme/review
hairness extension remove acme/review
```

Every composition mutation previews the exact diff and returns a Checkpoint. Pass
that checkpoint back to the same command with `--checkpoint <id>` to apply it.
