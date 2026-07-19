import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHome } from '../src/create.mjs'
import { doctorHome } from '../src/doctor.mjs'
import { packHairness } from './lib/pack.mjs'

const root = new URL('../', import.meta.url).pathname
const temporary = await mkdtemp(join(tmpdir(), 'hairness-lab-'))
try {
  const packs = await packHairness(root, join(temporary, 'packs'))
  const home = join(temporary, 'home')
  await createHome(home, {
    packageSpec: `file:${packs.cli}`,
    starter: `file:${packs.starter}`,
    starterName: '@hairness/starter',
    packageOverrides: { '@hairness/native': `file:${packs.native}` },
    language: 'fr',
  })
  const doctor = await doctorHome(home)
  assert.equal(doctor.status, 'ready')
  assert.equal(doctor.extensions[0].package, '@hairness/native')
  console.log(`lab passed (${home})`)
} finally {
  await rm(temporary, { recursive: true, force: true })
}
