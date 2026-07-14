# Compatibility

v0.3 is a clean break from v0.2.

There is no in-place Home upgrade, old command alias, old schema reader, runtime
bridge, automatic Overlay conversion, migration descriptor, or copied legacy
documentation tree. The supported path is:

1. pin v0.2 if an existing Home must remain operational;
2. archive its complete Overlay opaquely under `~/.hairness/archives/`;
3. create a new v0.3 Home;
4. import only selected human notes into a new Scratch;
5. reinstall or rewrite extensions against the v0.3 manifest.

Published v0.2 packages remain in npm for pinned users. v0.3 documents declare
type-specific `apiVersion` values; package and extension compatibility uses
SemVer.
