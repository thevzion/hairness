# Initiative and delivery controls

The forge separates strategic trajectory from operational delivery.

```text
Initiative
  outcome + gate + evidence + links
        │
        ▼
DeliveryPlan
  check → commit → push → pull request → CI → release candidate
        │
        ▼
operation checkpoints + typed receipts
```

Initiative Controls keeps the local macro roadmap in owner-scoped overlay state. `STATUS.md` is a deliberately published snapshot, never the live database. Publishing returns a filesystem checkpoint and executor input; the handler does not edit the file.

Delivery Controls turns one initiative into ordered steps. It prepares checkpoints and records proof, but never stages, commits, pushes, opens a PR, merges, tags, releases, publishes npm, or posts externally. A release candidate is produced as a typed artifact only after delivery proof exists.

This boundary lets Hairness improve itself without becoming a Git bot: the native agent performs an approved operation and returns a receipt; the extension preserves the plan and evidence.
