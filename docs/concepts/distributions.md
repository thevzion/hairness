# Distributions

A Hairness forge contains an organization-owned catalogue and selects an explicit maintainer composition. A team distribution is a smaller standalone source repository created from a recipe. The recipe selects branding, material sets, extensions, providers, sources, and codebases. Hairness resolves those selections into a deterministic material graph; it does not parse source imports or copy dormant catalogue content. The generated repository owns the copied source and records provenance, material bases, update source, and protocol version in `hairness.lock.json`.

Hairness uses the open-code distribution model popularized by shadcn/ui. Adding
an extension copies its source into the distribution; it does not add a hidden runtime dependency. Generated team distributions contain no dormant catalogue, forge bootstrap, maintainer suites, or reference-project documentation.

Physical presence never activates an extension. `hairness.json` selects shared source; `.overlay/config.json` may disable it or add a separately trusted local extension.

## Local hub

A forge or distribution may mount repositories that it does not own under `.overlay/codebases/`. It may also link externally owned extension source under `.overlay/extensions/`. These local references are explicit, trust-gated and excluded from shared provider projections.

The root contains source owned by the distribution. The overlay contains machine-specific reality. Typed artifacts preserve interpretations of mounted sources without replacing live proof.

## Storage boundaries

`.hairness/` is tracked distribution-owned policy and published artifact state. `.overlay/` is ignored operational state. `~/.hairness/` is personal preference and trust. Extension source remains under `extensions/<owner>/<name>` so discovery categories can evolve without changing IDs.

## Composition levels

An extension owns behavior. A future pack may name a reusable partial composition. A recipe describes a complete bootstrap. A distribution is the resolved, source-owned result. Pack manifests and remote registries remain post-alpha; material sets solve payload selection without adding runtime dependencies.

## Lifecycle

`hairness update plan` compares the recorded base, current consumer material, and a candidate source. Only intact material can be applied automatically. A consumer edit makes its complete scope review-required. Updates never create Git state or merge content.
