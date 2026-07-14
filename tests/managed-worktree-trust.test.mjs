import test from 'node:test'
import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { isWorkspaceTrusted } from '../src/distribution/registry.mjs'

const exec = promisify(execFile)
const git = (path, args) => exec('git', ['-C', path, ...args], { encoding: 'utf8' })

test('only a locked managed workspace worktree inherits trust from its anchor', async (context) => {
  const anchor = await mkdtemp(join(tmpdir(), 'hairness-trust-anchor-'))
  const home = join(anchor, 'home')
  const linked = join(dirname(anchor), `${anchor.split('/').at(-1)}-linked`)
  const foreign = join(dirname(anchor), `${anchor.split('/').at(-1)}-foreign`)
  const previousHome = process.env.HAIRNESS_HOME
  process.env.HAIRNESS_HOME = home
  context.after(async () => {
    if (previousHome === undefined) delete process.env.HAIRNESS_HOME
    else process.env.HAIRNESS_HOME = previousHome
    await rm(linked, { recursive: true, force: true })
    await rm(foreign, { recursive: true, force: true })
    await rm(anchor, { recursive: true, force: true })
  })
  await git(anchor, ['init', '-b', 'main'])
  await git(anchor, ['config', 'user.email', 'test@example.test'])
  await git(anchor, ['config', 'user.name', 'Trust Test'])
  await mkdir(join(anchor, '.overlay', 'extensions-state', 'hairness', 'worktree-controls'), { recursive: true })
  await writeFile(join(anchor, '.gitignore'), '.overlay\n')
  await writeFile(join(anchor, 'README.md'), '# fixture\n')
  await git(anchor, ['add', '.gitignore', 'README.md'])
  await git(anchor, ['commit', '-m', 'init'])
  await git(anchor, ['worktree', 'add', '--lock', '--reason', 'hairness:controller-example:handle-example:plan-example', '-b', 'feat/linked', linked, 'main'])
  await symlink(join(anchor, '.overlay'), join(linked, '.overlay'), 'dir')
  await mkdir(home, { recursive: true })
  await writeFile(join(home, 'trust.json'), JSON.stringify({ schemaVersion: 2, protocolVersion: '0.2', workspaces: { [anchor]: { trusted: true } }, extensions: {} }))
  const timestamp = new Date().toISOString()
  await writeFile(join(anchor, '.overlay', 'extensions-state', 'hairness', 'worktree-controls', 'state.json'), JSON.stringify({
    schemaVersion: 2,
    protocolVersion: '0.2',
    controller: { id: 'controller-example', anchorRoot: anchor, overlayRoot: join(anchor, '.overlay'), poolRoot: `${anchor}-worktrees`, state: 'active' },
    handles: [{ id: 'handle-example', controllerRef: { id: 'controller-example', digest: 'sha256:controller' }, repository: { kind: 'workspace' }, planId: 'plan-example', path: linked, state: 'active' }],
    leases: [{ id: 'lease-example', handleId: 'handle-example', planId: 'plan-example', sessionId: 'session-example', state: 'active', acquiredAt: timestamp }],
  }))
  assert.equal(await isWorkspaceTrusted(linked), true)

  await mkdir(foreign)
  await symlink(join(anchor, '.overlay'), join(foreign, '.overlay'), 'dir')
  assert.equal(await isWorkspaceTrusted(foreign), false)

  await git(anchor, ['worktree', 'unlock', linked])
  await git(anchor, ['worktree', 'lock', '--reason', 'hairness:another-controller:handle-example:plan-example', linked])
  assert.equal(await isWorkspaceTrusted(linked), false)
})
