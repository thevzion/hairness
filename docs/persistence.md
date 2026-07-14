# Persistence

Hairness persists only state whose owner and purpose are explicit.

## Home

The Home is a normal Git repository. `package-lock.json` pins the CLI;
`hairness.json` selects providers, extensions and target identities; and
`hairness.lock.json` records immutable distribution and extension provenance.
Local paths, generated provider outputs and live target state are never tracked.

## Overlay

`.overlay/` is human-meaningful memory. Without an active Scratch, a provider
session writes nothing. Once attached, it may update notes at semantic boundaries:
accepted decisions, changed constraints, handoffs, park/close and changed next
steps. It never stores a transcript or reasoning trace.

An Overlay may be its own nested local Git repository. Boundary snapshots are the
default; manual snapshots are always available. Hairness never creates a remote
or pushes. Artifacts contain a typed envelope and exactly one canonical Markdown
or JSON payload. Git supplies their history. Receipts are immutable and separate.

## Runtime

Credential-free machine state lives below `~/.hairness/runtime/<home-id>/`:
provider build manifests, target path bindings, adaptive checkouts, checkpoints,
locks, cache, temporary staging and logs. User preferences, trust and opaque
legacy archives are siblings under `~/.hairness/`.

Runtime state can be rebuilt or discarded. Overlay state may be valuable and is
therefore explicit, inspectable and independently versionable.

```text
.overlay/
├── README.md
├── profile.json
├── onboarding/draft.json
├── scratches/<id>/
│   ├── scratch.json
│   ├── context.md
│   ├── notes.md
│   ├── sessions/
│   └── outputs/
├── artifacts/<owner>/<type>/<id>/
│   ├── artifact.json
│   └── payload.md|payload.json
├── receipts/
└── .gitignore
```

The machine-owned counterpart is deliberately separate:

```text
~/.hairness/
├── preferences/
├── trust/
├── archives/
└── runtime/<home-id>/
    ├── build.json
    ├── providers/
    ├── targets/
    ├── checkouts/
    ├── checkpoints/
    ├── locks/
    ├── cache/
    ├── tmp/
    └── logs/
```
