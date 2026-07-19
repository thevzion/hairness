# Package model

## Manifest

Every package uses `package.json#hairness` with
`hairness.dev/package/v1alpha1`.

- `Starter` selects initial packages, providers, config, Targets and
  Integrations.
- `Extension` contributes provider-neutral assets.
- `Extension` with subtype `adapter` may execute during an approved build.
- `Catalog` indexes exact package specs.

## Source policy

| Source | Accepted |
| --- | --- |
| npm | exact SemVer |
| Git | exact SemVer tag or 40-character SHA |
| local | `file:` |

Ranges, dist-tags, branches and `HEAD` are rejected. npm lifecycle scripts are
disabled for every install, recovery and removal.

## Extension lifecycle

```bash
hairness extension add <exact-spec>
hairness extension update <package> --to <exact-spec>
hairness extension remove <package>
hairness extension list
hairness extension doctor
```

The operation is transactional across `package.json`, `package-lock.json`,
`hairness.json` and generated output. A failed validation or build restores the
previous package graph and composition.

## Catalog lifecycle

```bash
hairness catalog add <id> <exact-spec>
hairness catalog update <id> --to <exact-spec>
hairness catalog remove <id>
hairness catalog list
hairness catalog search [query]
```

A Catalog does not install code by itself. It resolves an entry to the same
exact spec accepted by direct installation.
