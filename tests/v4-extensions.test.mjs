import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { promisify } from 'node:util'
import test from 'node:test'
import { createHome } from '../src/v4/create.mjs'
import { addExtension, removeExtension, updateExtension } from '../src/v4/extension-lifecycle.mjs'
import { inspectExtension } from '../src/v4/extensions.mjs'
import { prologueModel } from '../src/v4/prologue.mjs'

const exec = promisify(execFile)

test('a neutral Skill, its Command and a bounded prologue contributor remain distinct', async () => {
  const root = await mkdtemp(join(tmpdir(), 'hairness-v4-extension-'))
  try {
    const home = join(root, 'home')
    const source = join(root, 'extension')
    await createHome(home, { providers: ['codex', 'claude'], install: false })
    await writeExtension(source, {
      id: 'acme/review',
      skill: 'acme-review',
      command: 'review',
      prologue: true,
    })
    await inspectExtension(source)
    assert.equal(await exists(join(source, 'executed')), false)
    await addExtension(home, source)
    assert.equal(await exists(join(source, 'executed')), false)
    assert.match(await readFile(join(home, '.agents', 'skills', 'acme-review', 'SKILL.md'), 'utf8'), /# acme-review/)
    assert.match(await readFile(join(home, '.agents', 'skills', 'review', 'SKILL.md'), 'utf8'), /# \$review/)
    assert.match(await readFile(join(home, '.claude', 'skills', 'review', 'SKILL.md'), 'utf8'), /# \/review/)

    const model = await prologueModel(home)
    assert.equal(model.facts.some((fact) => fact.id === 'acme/review/reviews.enabled' && fact.value === true), true)
    assert.equal(await exists(join(home, 'extensions', 'acme', 'review', 'executed')), false)

    await writeFile(join(home, 'extensions', 'acme', 'review', 'skills', 'review', 'skill.md'), 'local divergence\n')
    await assert.rejects(() => updateExtension(home, 'acme/review'), (error) => error.code === 'extension_diverged')
    await assert.rejects(() => removeExtension(home, 'acme/review'), (error) => error.code === 'extension_diverged')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('a pinned Git extension updates only while its installed base is intact', async () => {
  const root = await mkdtemp(join(tmpdir(), 'hairness-v4-git-extension-'))
  try {
    const home = join(root, 'home')
    const source = join(root, 'source')
    await createHome(home, { providers: ['codex'], install: false })
    await writeExtension(source, { id: 'acme/git-review', skill: 'git-review', command: 'git-review' })
    await exec('git', ['init', '--quiet', '--initial-branch=main'], { cwd: source })
    await exec('git', ['add', '--all'], { cwd: source })
    await exec('git', ['-c', 'user.name=Test', '-c', 'user.email=test@example.com', 'commit', '--quiet', '-m', 'v1'], { cwd: source })
    const remote = pathToFileURL(source).href
    await addExtension(home, remote, { ref: 'main' })
    const first = JSON.parse(await readFile(join(home, 'hairness.lock.json'), 'utf8')).extensions[0]

    await writeFile(join(source, 'skills', 'review', 'skill.md'), 'Version two.\n')
    const manifest = JSON.parse(await readFile(join(source, 'extension.json'), 'utf8'))
    manifest.metadata.version = '0.2.0'
    await writeFile(join(source, 'extension.json'), `${JSON.stringify(manifest, null, 2)}\n`)
    await exec('git', ['add', '--all'], { cwd: source })
    await exec('git', ['-c', 'user.name=Test', '-c', 'user.email=test@example.com', 'commit', '--quiet', '-m', 'v2'], { cwd: source })

    const updated = await updateExtension(home, 'acme/git-review')
    assert.equal(updated.action, 'update')
    const second = JSON.parse(await readFile(join(home, 'hairness.lock.json'), 'utf8')).extensions[0]
    assert.notEqual(second.resolvedCommit, first.resolvedCommit)
    assert.equal(second.version, '0.2.0')
    assert.equal((await removeExtension(home, 'acme/git-review')).status, 'removed')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('provider-native sources, escaping paths and core command collisions are rejected', async () => {
  const root = await mkdtemp(join(tmpdir(), 'hairness-v4-invalid-extension-'))
  try {
    const native = join(root, 'native')
    await writeExtension(native, { id: 'acme/native', skill: 'native', command: 'native' })
    await writeFile(join(native, 'SKILL.md'), 'provider native\n')
    await assert.rejects(() => inspectExtension(native), (error) => error.code === 'provider_native_source')

    const home = join(root, 'home')
    const collision = join(root, 'collision')
    await createHome(home, { providers: ['codex'], install: false })
    await writeExtension(collision, { id: 'acme/collision', skill: 'collision', command: 'hairness' })
    await assert.rejects(() => addExtension(home, collision), (error) => error.code === 'command_collision')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

async function writeExtension(root, options) {
  await mkdir(join(root, 'skills', 'review'), { recursive: true })
  await writeFile(join(root, 'skills', 'review', 'skill.md'), 'Review the current subject directly in chat.\n')
  const spec = {
    skills: [{ id: options.skill, summary: 'Review one subject.', path: 'skills/review/skill.md' }],
    commands: [{ id: options.command, skill: options.skill, summary: 'Review now.' }],
  }
  if (options.prologue) {
    spec.prologue = { path: 'prologue.mjs', timeoutMs: 1000 }
    await writeFile(join(root, 'prologue.mjs'), `import { writeFileSync } from 'node:fs'\ntry { writeFileSync(new URL('./executed', import.meta.url), 'x') } catch {}\nprocess.stdout.write(JSON.stringify({ facts: [{ id: 'reviews.enabled', value: true }], signals: [] }))\n`)
  }
  await writeFile(join(root, 'extension.json'), `${JSON.stringify({
    apiVersion: 'hairness.dev/extension/v1alpha2',
    kind: 'Extension',
    metadata: { id: options.id, version: '0.1.0', summary: 'A minimal review extension.' },
    spec,
  }, null, 2)}\n`)
}

async function exists(path) {
  return readFile(path).then(() => true, (error) => error.code === 'ENOENT' ? false : Promise.reject(error))
}
