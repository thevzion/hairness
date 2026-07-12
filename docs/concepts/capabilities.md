# Capabilities, operations, routes and results

```text
Capability
└── Operation: observe | derive | effect
    └── Route: deterministic | inline | worker | external
        └── ResultOption[] + default result
```

A capability groups coherent operations under one owner. An operation class states its effect semantics before execution:

- `observe` reads current state;
- `derive` creates meaning from allowed inputs;
- `effect` mutates an exact target or external system.

The route is an execution choice, not a different capability. `worker` resolves to producer for observe/derive and executor for effect. `inline` keeps semantic work in the main session. `deterministic` uses local mechanics. `external` delegates to another owned runtime.

Each operation declares one or more typed result options and exactly one default. Invocation controls may choose only a declared option. Operation references survive provider compilation and appear in invocations, routes, assignments, capsules, and receipts. This makes ownership and validation traceable end to end.
