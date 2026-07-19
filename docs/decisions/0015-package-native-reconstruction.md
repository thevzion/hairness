# ADR 0015: package-native reconstruction

Status: accepted

## Context

The previous branch carried a large product model before its package and
consumer boundaries were proven. Real personal and team Homes already provided
a smaller source of truth.

## Decision

- Reconstruct the Kernel from `origin/main` without rewriting Git history.
- Use `package.json#hairness` for Starter, Extension and Catalog manifests.
- Treat Adapter as an executable Extension subtype.
- Use direct dependencies and `package-lock.json` as the only package lock.
- Keep `hairness.json` for composition and `.hairness/build.json` for local
  output ownership.
- Make Catalogs optional and preserve direct exact installation.
- Keep Native and the default Starter as ordinary packages.
- Put team behavior, GSD and other depth in separate Extensions.
- Keep Targets independent and Integrations credential-free.

## Consequences

The Kernel has a smaller public surface. npm and Git supply distribution before
a web marketplace exists. Team packages evolve without destabilizing the
Kernel. A breaking contract change returns to planning; implementation defects
remain ordinary fixes.

The removed 0.3 source model has no compatibility layer.
