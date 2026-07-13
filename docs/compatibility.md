# Compatibility

Protocol and implementation versions are independent. Protocol `0.2` is a clean
break from the unpublished `0.1` contracts; Hairness provides no
legacy manifest or schema shim.

Distributions and extensions declare an exact protocol version in this
experimental alpha. Provider projections refuse mismatched protocol versions.

Before 1.0, consumers SHOULD pin exact implementation versions. Releases carry
versioned MigrationDescriptors required to chain supported versions inside the
same protocol minor. `migrate plan` transforms a scratch candidate; only an
exact checkpoint may apply it and record its digest in `hairness.lock.json`.

Source-owned distributions keep their current source until an explicit update
plan is accepted. Intact Hairness materials may update mechanically. Diverged
consumer material and linked local extensions remain `review-required` and are
never silently merged or codemodded.
