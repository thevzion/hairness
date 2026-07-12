import test from 'node:test'
import assert from 'node:assert/strict'
import { access, cp, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { answerCreate, applyCreate, planCreate, startCreate } from '../src/bootstrap/create.mjs'
import { applyDistributionUpdate, planDistributionUpdate } from '../src/distribution/update-engine.mjs'

async function createFixture(name, role = 'distribution') {
  const base = await mkdtemp(join(tmpdir(), `hairness-${name}-`))
  process.env.HAIRNESS_HOME = join(base, 'home')
  const target = join(base, name)
  let gap = await startCreate(target, 'standard', role)
  const answers = { language: 'en', name, displayName: name, providerPrefix: name, cliAlias: 'none', extensions: 'preset', providers: 'codex', codebases: 'later', rootCommit: 'no' }
  while (gap.question) gap = await answerCreate(gap.createId, gap.id, answers[gap.id] ?? gap.options[0].value)
  const plan = await planCreate(gap.createId)
  await applyCreate(gap.createId, plan.checkpointId, { install: false, git: false, build: false })
  return { base, target }
}

test('team and forge payloads have distinct operational boundaries', async () => {
  const team = await createFixture('team-payload')
  await access(join(team.target, 'hairness.lock.json'))
  await access(join(team.target, 'LICENSES/Hairness-MIT.txt'))
  for (const path of ['LICENSE', 'SPEC.md', 'ROADMAP.md', 'CHANGELOG.md', 'STATUS.md', 'catalog', 'src/bootstrap', 'extensions/hairness/maintainer']) await assert.rejects(access(join(team.target, path)), path)

  const forge = await createFixture('company-forge', 'forge')
  await access(join(forge.target, 'catalog/standard.json'))
  await access(join(forge.target, 'src/bootstrap/create.mjs'))
  await access(join(forge.target, 'extensions/hairness/maintainer/extension.json'))
  const forgeManifest = JSON.parse(await readFile(join(forge.target, 'hairness.json'), 'utf8'))
  assert.ok(forgeManifest.extensions.some((extension) => extension.id === 'hairness/maintainer'))
  await access(join(forge.target, 'STATUS.md'))
  for (const path of ['LICENSE', 'SPEC.md', 'ROADMAP.md', 'CHANGELOG.md']) await assert.rejects(access(join(forge.target, path)), path)
})

test('safe update applies intact material and rejects consumer divergence', async () => {
  const fixture = await createFixture('safe-update')
  const candidate = join(fixture.base, 'candidate')
  await cp(fixture.target, candidate, { recursive: true })
  await writeFile(join(candidate, 'extensions/hairness/cockpit/candidate-proof.txt'), 'candidate\n')
  const plan = await planDistributionUpdate(fixture.target, { to: candidate, scope: 'extension:hairness/cockpit' })
  assert.equal(plan.status, 'ready')
  const receipt = await applyDistributionUpdate(fixture.target, plan.id, plan.checkpointId)
  assert.equal(receipt.status, 'succeeded')
  assert.equal(await readFile(join(fixture.target, 'extensions/hairness/cockpit/candidate-proof.txt'), 'utf8'), 'candidate\n')

  const divergedCandidate = join(fixture.base, 'diverged-candidate')
  await cp(fixture.target, divergedCandidate, { recursive: true })
  await writeFile(join(fixture.target, 'extensions/hairness/cockpit/consumer-proof.txt'), 'consumer\n')
  await writeFile(join(divergedCandidate, 'extensions/hairness/cockpit/next-proof.txt'), 'next\n')
  const diverged = await planDistributionUpdate(fixture.target, { to: divergedCandidate, scope: 'extension:hairness/cockpit' })
  assert.equal(diverged.status, 'review-required')
  await assert.rejects(applyDistributionUpdate(fixture.target, diverged.id, diverged.checkpointId), (error) => error.code === 'update_review_required')
})
