# Persistence

Hairness writes only named, inspectable state.

```text
Home/
├── .hairness/                         # ignored build/tmp state
├── .overlay/
│   ├── config.json                    # preferences and Integration bindings
│   ├── scratches/<slug>/scratch.md    # explicit working memory
│   └── artifacts/                     # accepted documents, if any
└── targets/<id>                        # ignored symlink to a Git checkout
```

The Home Git repository tracks configuration, extension source and human
Overlay. It never tracks absolute Target paths, generated provider projections,
runtime locks, credentials or transcripts. A session without an explicit
Scratch creates no memory. A Scratch is plain Markdown, not a protocol object.

Machine-only state such as build digests and temporary extension staging stays
under `.hairness/` and can be discarded. Git history is the only revision
history for human documents; Hairness does not create an internal graph.
