import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import test from 'node:test'
import { createHome } from '../src/home/create.mjs'
import { runCli } from '../src/cli.mjs'

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

  const doctor = JSON.parse((await exec(process.execPath, [bin, 'doctor', '--json'], { cwd: home, env: { ...process.env, HAIRNESS_STATE_HOME: process.env.HAIRNESS_STATE_HOME } })).stdout)
  assert.equal(doctor.data.profile.language, 'fr')
  assert.equal(doctor.data.scratch, null)
  await assert.rejects(
    exec(process.execPath, [bin, 'opening', '--json'], { cwd: home }),
    (error) => JSON.parse(error.stderr).error.code === 'unknown_command',
  )

  await assert.rejects(
    exec(process.execPath, [bin, 'invoke', '--json'], { cwd: home }),
    (error) => JSON.parse(error.stderr).error.code === 'unknown_command',
  )

  const targetList = (await exec(process.execPath, [bin, 'target', 'list'], { cwd: home, env: { ...process.env, HAIRNESS_STATE_HOME: process.env.HAIRNESS_STATE_HOME } })).stdout
  assert.match(targetList, /^Targets\n  none/m)
  await assert.rejects(
    exec(process.execPath, [bin, 'opening'], { cwd: home }),
    (error) => /unknown_command: Unknown command: opening\.[\s\S]*State: No effect Receipt was produced\.[\s\S]*Recovery: hairness doctor/.test(error.stderr),
  )
})

test('human CLI output is hierarchical and respects NO_COLOR', async () => {
  const stream = (tty) => ({ isTTY: tty, value: '', write(chunk) { this.value += chunk } })
  const previous = process.env.NO_COLOR
  try {
    delete process.env.NO_COLOR
    const colored = stream(true)
    await runCli(['help'], { stdin: {}, stdout: colored, stderr: stream(true) })
    assert.match(colored.value, /\x1b\[1;36m/)
    assert.match(colored.value, /Next useful routes/)
    assert.equal(colored.value.trim().startsWith('{'), false)

    process.env.NO_COLOR = '1'
    const plain = stream(true)
    await runCli(['help'], { stdin: {}, stdout: plain, stderr: stream(true) })
    assert.equal(plain.value.includes('\u001b['), false)
  } finally {
    if (previous === undefined) delete process.env.NO_COLOR
    else process.env.NO_COLOR = previous
  }
})
