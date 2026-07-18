# Provider projection

Hairness compiles one neutral source set into Codex and Claude. The built-in
surface is three Skills: `hairness`, `hairness-onboarding` and
`hairness-scratch`. An extension adds neutral `skill.md` files and optional
commands; the compiler adds `$name` or `/name` and writes native `SKILL.md`
files only where it owns them.

Provider directories are never cleared wholesale. Existing native skills,
hooks and surrounding instructions survive. The generated Home records exact
owned paths in ignored `.hairness/build.json`; `hairness build --check` detects
stale or edited generated output.
