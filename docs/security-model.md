# Security model

Hairness separates visibility, trust, and authority.

```mermaid
flowchart LR
  source["Extension source"] --> inspect["Manifest + file inspection"]
  inspect --> checkpoint["Composition checkpoint"]
  checkpoint --> active["Active extension"]
  active --> observe["Observe / derive"]
  active --> prepare["Prepare exact effect"]
  prepare --> revalidate["Revalidate Target + inputs + proof + policy"]
  revalidate --> effect["Apply effect"]
  effect --> receipt["Immutable Receipt"]
```

Source inspection imports no adapter. Activation grants no effect authority.
Target registration stores only a local binding and grants no authority. Effect
checkpoints are single-use and stale on any relevant change.

Home Git, Overlay Git, and Target Git are independent. Creation configures no
remote. Generated provider paths are exact. Overlay snapshots reject obvious
credential paths, symlinks, and oversized files. Unknown effects stop replay and
leave an immutable Receipt for reconciliation.
