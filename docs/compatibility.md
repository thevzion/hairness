# Compatibility

Protocol and implementation versions are independent. Protocol `0.2` is a clean
break from the unpublished `0.1` contracts; Hairness provides no
legacy manifest or schema shim.

Distributions and extensions declare an exact protocol version in this
experimental alpha. Provider projections refuse mismatched protocol versions.

Before 1.0, consumers SHOULD pin exact implementation versions and review the
documented migration for any protocol or extension-contract change. Source-owned
distributions keep their current source until an explicit update plan is
accepted; package availability alone never mutates them.
