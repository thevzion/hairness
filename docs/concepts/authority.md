# Authority

Integration makes a target visible. Authority permits a specific operation.

An EffectGrant binds one intention to resolved targets, effects, exclusions, proof, and an `EffectPolicy` digest. Extensions such as `hairness/constraints` own named policy semantics; the core only aggregates their allowed and denied effects. Before every effect it recomputes the policy and verifies the exact grant, target, policy, and lock. Tightening a policy therefore revokes an already granted effect immediately. Any expansion returns `needs-authority`.

Locks protect target state across sessions. Ambiguous state is quarantined instead of assumed safe.
