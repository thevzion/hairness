# Authority

Integration makes a target visible. Authority permits a specific operation.

An Assignment may request only effects declared by its Operation. Before
authority, Hairness stores one immutable checkpoint with the Run and binds it to
the Assignment's targets and effects plus the current `EffectPolicy` digest.
`hairness run <id> approve --checkpoint <id>` revalidates that digest, acquires
the exact locks, transitions `needs-authority` to `ready`, and returns the
granted executor capsule. A mismatched or stale checkpoint is rejected.

An EffectGrant binds one intention to resolved targets, effects, exclusions,
proof, and the revalidated policy digest. Extensions such as
`hairness/constraints` own named policy semantics; the core only aggregates
their allowed and denied effects. Before every effect it recomputes the policy
and verifies the exact grant, target, policy, and lock. Tightening a policy
therefore revokes an already granted effect immediately. Any expansion returns
`needs-authority`.

Locks protect target state across sessions. Targets may be canonical local
paths or credential-free URI identities such as a GitHub branch, tag, PR or npm
package version. Query strings and fragments are forbidden. Ambiguous state is
quarantined instead of assumed safe.
