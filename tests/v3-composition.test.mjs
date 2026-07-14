import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { loadDistribution } from '../src/composition/distributions.mjs'
import { inspectExtension } from '../src/composition/extensions.mjs'
import { homeDocument } from '../src/home/index.mjs'
import { copyTree, writeJsonAtomic } from '../src/lib/io.mjs'
import { buildProviders } from '../src/providers/v3-compiler.mjs'
import { git } from '../src/runtime/git.mjs'

const official = fileURLToPath(new URL('../assets/extensions/', import.meta.url))

async function homeFixture(t, preset = 'standard') {
  const root = await mkdtemp(join(tmpdir(), 'hairness-v3-composition-'))
  const home = join(root, 'home')
  process.env.HAIRNESS_STATE_HOME = join(root, 'state')
  const distribution = (await loadDistribution(preset)).document
  const document = homeDocument({
    id: 'composition-home',
    language: 'fr',
    providers: ['codex', 'claude'],
    extensions: distribution.spec.extensions,
    targets: [],
    overlayGit: false,
  })
  await writeJsonAtomic(join(home, 'hairness.json'), document)
  for (const id of document.spec.extensions) {
    await copyTree(join(official, ...id.split('/')), join(home, 'extensions', ...id.split('/')))
  }
  await git(['init', '--quiet'], { cwd: home })
  t.after(async () => {
    delete process.env.HAIRNESS_STATE_HOME
    await rm(root, { recursive: true, force: true })
  })
  return { root, home, document }
}

test('Minimal and Standard are bootstrap-only compositions', async () => {
  const minimal = (await loadDistribution('minimal')).document
  const standard = (await loadDistribution('standard')).document
  assert.deepEqual(minimal.spec.extensions, ['hairness/cockpit', 'hairness/work'])
  assert.deepEqual(standard.spec.extensions, [
    'hairness/cockpit', 'hairness/work', 'hairness/sources', 'hairness/codebase', 'hairness/delivery',
  ])
  assert.equal(JSON.stringify(standard).includes('forge'), false)
})

test('extension inspection validates files without importing adapter code', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'hairness-v3-inspect-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  await writeJsonAtomic(join(root, 'extension.json'), {
    apiVersion: 'hairness.dev/extension/v1alpha1',
    kind: 'Extension',
    metadata: { id: 'acme/two-file', version: '1.0.0', summary: 'Test extension.' },
    spec: {
      provides: ['acme.test'], requires: [], recipes: [],
      adapters: [{ id: 'danger', mode: 'observe', path: 'adapter.mjs', capability: 'acme.test' }],
      schemas: [], gates: [], onboarding: [], tests: [],
    },
  })
  await writeFile(join(root, 'adapter.mjs'), `throw new Error('inspection executed adapter')\n`)
  const inspected = await inspectExtension(root)
  assert.equal(inspected.manifest.metadata.id, 'acme/two-file')
})

test('provider compiler emits exactly ten parity commands and preserves native skills', async (t) => {
  const { root, home, document } = await homeFixture(t)
  await mkdir(join(home, '.agents/skills/user-native'), { recursive: true })
  await writeFile(join(home, '.agents/skills/user-native/SKILL.md'), '# User native\n')
  const first = await buildProviders(home)
  const commands = [
    'hairness', 'hairness-onboarding', 'hairness-scratch', 'hairness-discuss', 'hairness-map',
    'hairness-ideate', 'hairness-propose', 'hairness-recap', 'hairness-plan', 'hairness-ship',
  ]
  assert.equal(first.outputs.length, 20)
  for (const command of commands) {
    const codex = await readFile(join(home, '.agents/skills', command, 'SKILL.md'), 'utf8')
    const claude = await readFile(join(home, '.claude/skills', command, 'SKILL.md'), 'utf8')
    assert.match(codex, new RegExp(`\\$${command}`))
    assert.match(claude, new RegExp(`/${command}`))
    assert.equal(codex.includes('Speak fr'), true)
    assert.equal(claude.includes('Speak fr'), true)
  }
  await buildProviders(home, { check: true })

  document.spec.providers = ['codex']
  await writeJsonAtomic(join(home, 'hairness.json'), document)
  const second = await buildProviders(home)
  assert.equal(second.outputs.length, 10)
  assert.equal((await readFile(join(home, '.agents/skills/user-native/SKILL.md'), 'utf8')).trim(), '# User native')
  assert.equal((await readdir(join(home, '.claude/skills'))).includes('hairness'), false)

  const exclude = await readFile(join(home, '.git/info/exclude'), 'utf8')
  assert.equal(exclude.includes('.agents/skills/hairness/SKILL.md'), true)
  assert.equal(exclude.includes('.agents/skills/user-native'), false)

  const clone = join(root, 'clone')
  await copyTree(join(home, 'extensions'), join(clone, 'extensions'))
  await writeJsonAtomic(join(clone, 'hairness.json'), document)
  await mkdir(join(clone, '.agents/skills/user-native'), { recursive: true })
  await writeFile(join(clone, '.agents/skills/user-native/SKILL.md'), '# Clone native\n')
  await git(['init', '--quiet'], { cwd: clone })
  process.env.HAIRNESS_STATE_HOME = join(root, 'clone-state')
  const restored = await buildProviders(clone)
  assert.equal(restored.outputs.length, 10)
  assert.match(await readFile(join(clone, '.agents/skills/hairness/SKILL.md'), 'utf8'), /\$hairness/)
  assert.equal((await readFile(join(clone, '.agents/skills/user-native/SKILL.md'), 'utf8')).trim(), '# Clone native')

  await git(['add', '--all'], { cwd: home })
  await git(['-c', 'user.name=Test', '-c', 'user.email=test@example.test', 'commit', '--quiet', '-m', 'home source'], { cwd: home })
  await writeFile(join(home, '.git/info/exclude'), '')
  const worktree = join(root, 'home-worktree')
  await git(['worktree', 'add', '--quiet', '-b', 'linked-home', worktree], { cwd: home })
  process.env.HAIRNESS_STATE_HOME = join(root, 'worktree-state')
  await buildProviders(worktree)
  assert.match(await git(['check-ignore', '-v', '.agents/skills/hairness/SKILL.md'], { cwd: worktree }), /info\/exclude/)
})
