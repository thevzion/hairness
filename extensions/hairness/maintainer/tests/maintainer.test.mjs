import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { changeImpact, projectStatus } from '../index.mjs'
import { validateContract } from '../../../../src/core/contracts.mjs'
import { command as evalCommand } from '../testing/evals.mjs'

test('maintainer owns deterministic documentation impact', async () => {
  const report = await changeImpact({ root: '/tmp', files: ['src/core/io.mjs'], runtime: { contracts: { validate: validateContract } } })
  assert.equal(report.decision, 'must-update')
})

test('provider eval planning is checkpointed and resolves local profile preferences', async () => {
  const state = new Map()
  const runtime = {
    distribution: { preferences: async () => ({ interaction: { language: 'fr' }, providers: { codex: { profiles: { fast: { model: 'fixture-model' } } } } }) },
    overlay: { write: async (path, value) => { state.set(path, value); return value } },
  }
  const plan = await evalCommand({ root: '/tmp', runtime, action: 'plan', rest: ['cockpit-language'], flags: { provider: 'codex', profile: 'fast' } })
  assert.equal(plan.repetitions, 3)
  assert.equal(plan.model, 'fixture-model')
  assert.match(plan.checkpointId, /^checkpoint-/)
  assert.ok(state.has(`evals/plans/${plan.id}.json`))
})

test('provider eval transport uses the canonical opening command', async () => {
  const source = await (await import('node:fs/promises')).readFile(new URL('../testing/evals.mjs', import.meta.url), 'utf8')
  assert.match(source, /'opening', '--host'/)
  assert.doesNotMatch(source, /'session', 'opening'/)
})

test('project status limits active and next work and aligns Work Controls', async () => {
  const root = await mkdtemp(join(tmpdir(), 'hairness-status-'))
  await writeFile(join(root, 'STATUS.md'), '# Status\n\n## Now\n\n- `public-ready`\n  - Outcome: Ship the generic forge.\n  - State: active\n  - Gate: Checks pass.\n  - Evidence: CI.\n\n## Next\n\n- `release`\n  - Outcome: Publish the alpha.\n  - State: planned\n  - Gate: Approval.\n  - Evidence: Receipt.\n\n## Blocked\n\n- None.\n\n## Release gates\n\n- CI passes.\n\n## References\n\n- ROADMAP.md\n')
  const runtime = { extensions: { call: async () => ({ activeSegmentId: 'public-ready', segments: [{ id: 'public-ready' }] }) } }
  const report = await projectStatus({ root, runtime })
  assert.equal(report.status, 'ready')
  assert.equal(report.now[0].id, 'public-ready')
  assert.equal(report.next.length, 1)
})
