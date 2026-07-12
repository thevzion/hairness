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
  for (const path of ['LICENSE', 'SPEC.md', 'SECURITY.md', 'ROADMAP.md', 'CHANGELOG.md', 'CONTRIBUTING.md', 'STATUS.md', 'docs', 'templates', 'providers', 'catalog', 'src/bootstrap', 'extensions/hairness/maintainer', 'scripts/check-commits.mjs', 'scripts/check-pack.mjs', 'scripts/impact-gate.mjs']) await assert.rejects(access(join(team.target, path)), path)
  for (const path of ['scripts/check.mjs', 'scripts/check-providers.mjs', 'scripts/conformance.mjs', 'scripts/extension-ownership-gate.mjs', 'scripts/run-tests.mjs']) await access(join(team.target, path))
  const teamPackage = JSON.parse(await readFile(join(team.target, 'package.json'), 'utf8'))
  assert.equal(teamPackage.private, true)
  assert.equal(teamPackage.license, 'UNLICENSED')
  for (const name of ['check:pack', 'check:impact', 'check:commits']) assert.equal(teamPackage.scripts[name], undefined)
  const teamLock = JSON.parse(await readFile(join(team.target, 'hairness.lock.json'), 'utf8'))
  assert.ok(teamLock.materials.every((material) => !['scripts', 'providers'].includes(material.path)))
  assert.equal(new Set(teamLock.materials.map((material) => material.id)).size, teamLock.materials.length)

  const forge = await createFixture('company-forge', 'forge')
  await access(join(forge.target, 'catalog/standard.json'))
  await access(join(forge.target, 'src/bootstrap/create.mjs'))
  await access(join(forge.target, 'extensions/hairness/maintainer/extension.json'))
  const forgeManifest = JSON.parse(await readFile(join(forge.target, 'hairness.json'), 'utf8'))
  assert.ok(forgeManifest.extensions.some((extension) => extension.id === 'hairness/maintainer'))
  await access(join(forge.target, 'STATUS.md'))
  for (const path of ['scripts/check-commits.mjs', 'scripts/check-pack.mjs', 'scripts/impact-gate.mjs']) await access(join(forge.target, path))
  for (const path of ['LICENSE', 'SPEC.md', 'ROADMAP.md', 'CHANGELOG.md']) await assert.rejects(access(join(forge.target, path)), path)
})

test('safe update ignores scripts outside the distribution payload', async () => {
  const fixture = await createFixture('minimal-update')
  const candidate = join(fixture.base, 'candidate-with-forge-script')
  await cp(fixture.target, candidate, { recursive: true })
  await writeFile(join(candidate, 'scripts/check.mjs'), `${await readFile(join(candidate, 'scripts/check.mjs'), 'utf8')}\n// candidate proof\n`)
  await writeFile(join(candidate, 'scripts/check-pack.mjs'), 'throw new Error("must not be copied")\n')
  const plan = await planDistributionUpdate(fixture.target, { to: candidate, scope: 'core' })
  assert.equal(plan.status, 'ready')
  await applyDistributionUpdate(fixture.target, plan.id, plan.checkpointId)
  assert.match(await readFile(join(fixture.target, 'scripts/check.mjs'), 'utf8'), /candidate proof/)
  await assert.rejects(access(join(fixture.target, 'scripts/check-pack.mjs')))
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
