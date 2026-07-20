import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { packHairness } from './lib/pack.mjs'

const exec = promisify(execFile)
const root = new URL('../', import.meta.url).pathname
const temporary = await mkdtemp(join(tmpdir(), 'hairness-lab-'))
try {
  const packs = await packHairness(root, join(temporary, 'packs'))
  const home = join(temporary, 'home')
  const command = ['--yes', '--package', packs.cli, 'hairness']
  await exec('npx', [...command, 'create', home, '--language', 'fr'], { cwd: temporary, maxBuffer: 20 * 1024 * 1024 })
  const { stdout } = await exec('npx', [...command, 'doctor', '--home', home, '--json'], { cwd: temporary, maxBuffer: 20 * 1024 * 1024 })
  const doctor = JSON.parse(stdout)
  assert.equal(doctor.status, 'ready')
  assert.equal(doctor.extensions[0].id, 'hairness/core')
  assert.equal(JSON.parse(await readFile(join(home, 'hairness.json'), 'utf8')).runtime, '@hairness/cli@0.4.0-alpha.0')
  console.log(`packed lab passed (${home})`)
} finally {
  await rm(temporary, { recursive: true, force: true })
}
