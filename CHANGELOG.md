# Changelog

## 0.4.0-alpha.0

- Make the provider-agnostic Home the primary Hairness product.
- Reduce publication to the single on-demand `@hairness/cli` Kernel.
- Bundle source-owned onboarding and opt-in Scratch Assets in the CLI.
- Add local, HTTPS, official and GitHub Asset resolution.
- Give each installed Asset one autonomous manifest with provenance and base digests.
- Add offline status, diff, cautious sync and source-aware remove.
- Keep Git as history; remove Registries, Catalogs, package dependencies and Hairness locks from Homes.
- Track Codex and Claude projections so a clone works without a build.
- Require explicit staging approval for executable Adapters.
- Preserve independent Targets, credential-free Integrations and explicit
  `.overlay/` memory.
- Add the source-owned `hairness/project` Asset for dogfood from an independent Home.

This alpha has no in-place migration from the removed 0.3 model or superseded
0.4 candidates.
