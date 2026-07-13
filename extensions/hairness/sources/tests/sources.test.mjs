import test from 'node:test'
import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { services } from '../index.mjs'
import { operations as gitOperations } from '../drivers/git/index.mjs'

const exec = promisify(execFile)

const manifest = JSON.parse(await readFile(new URL('../extension.json', import.meta.url), 'utf8'))
const runtime = {
  contracts: { validate: async (_name, value) => value },
  distribution: { read: async () => ({ sources: [{ id: 'git', requirement: 'required' }] }) },
}

test('sources expose only drivers selected by the distribution', async () => {
  const values = await services.list({ manifest, runtime })
  assert.deepEqual(values.map((value) => value.id), ['git'])
  assert.ok(values[0].operations.some((operation) => operation.id === 'status'))
})

test('git status gives a detached checkout a stable branch label', async (context) => {
  const root = await mkdtemp(join(tmpdir(), 'hairness-git-source-'))
  context.after(() => rm(root, { recursive: true, force: true }))
  await exec('git', ['init', root])
  await writeFile(join(root, 'README.md'), 'fixture\n')
  await exec('git', ['-C', root, 'add', '.'])
  await exec('git', ['-C', root, '-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.com', 'commit', '-m', 'fixture'])
  await exec('git', ['-C', root, 'checkout', '--detach'])

  const value = await gitOperations.status({ root, input: {} })
  assert.equal(value.branch, 'HEAD')
})
