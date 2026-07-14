import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import test from 'node:test'
import { createHome } from '../src/home/create.mjs'

const exec = promisify(execFile)
const bin = new URL('../bin/hairness.mjs', import.meta.url).pathname

test('public CLI exposes only the v0.3 document and command model', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'hairness-v3-cli-'))
  process.env.HAIRNESS_STATE_HOME = join(root, 'state')
  t.after(async () => {
    delete process.env.HAIRNESS_STATE_HOME
    await rm(root, { recursive: true, force: true })
  })
  const home = join(root, 'home')
  await createHome(home, { preset: 'minimal', language: 'fr', providers: ['codex'], overlayGit: false, install: false })

  const version = (await exec(process.execPath, [bin, '--version'], { cwd: home })).stdout.trim()
  assert.equal(version, '0.3.0-alpha.0')
  const help = JSON.parse((await exec(process.execPath, [bin, 'help', '--json'], { cwd: home })).stdout)
  assert.equal(help.ok, true)
  assert.equal(JSON.stringify(help).includes('protocolVersion'), false)
  for (const removed of ['invoke', 'worker', 'fan-in']) assert.equal(help.data.commands.includes(removed), false)

  const opening = JSON.parse((await exec(process.execPath, [bin, 'opening', '--json'], { cwd: home, env: { ...process.env, HAIRNESS_STATE_HOME: process.env.HAIRNESS_STATE_HOME } })).stdout)
  assert.equal(opening.data.home.language, 'fr')
  assert.equal(opening.data.kind, 'SessionOpening')
  assert.equal(opening.data.limits.includes('session-ephemeral'), true)

  await assert.rejects(
    exec(process.execPath, [bin, 'invoke', '--json'], { cwd: home }),
    (error) => JSON.parse(error.stderr).error.code === 'unknown_command',
  )
})
