# Golden journeys

## Personal Home

1. Pack Native, Starter and CLI.
2. Create a Home from the exact tarballs.
3. Confirm Home v1alpha3, direct dependencies and one npm lock.
4. Run build check, doctor and prologue.
5. Confirm Codex and Claude receive equivalent Native Skills.

## Extension and Catalog

1. Add an exact static Extension.
2. Confirm npm lifecycle scripts did not run.
3. Update it to another exact package.
4. Remove it and confirm owned outputs disappear.
5. Resolve the same Extension through a thin Catalog.
6. Force a failed Adapter build and confirm the package graph rolls back.

## Team Starter with GSD

1. Pack the private team Extension and Starter.
2. Pack `@hairness/adapter-gsd`.
3. Create a Home with `--allow-build`.
4. Confirm GSD's official installer produced the core Codex profile at 1.6.1.
5. Confirm Hairness build check is deterministic after atomic Home creation.
6. Confirm team Skills, declared Targets, Integrations and prologue facts.
7. Keep private repository and business details outside public evidence.

## Existing Homes

1. Create one branch and worktree per Home.
2. Store candidate tarballs under `vendor/`.
3. Replace the Home document and npm lock without touching Target repositories
   or unrelated Overlay memory.
4. Bind the existing local Targets.
5. Run build check, doctor and prologue.
6. Confirm a second npm install changes no version.
