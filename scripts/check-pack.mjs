import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const exec = promisify(execFile)
const root = new URL('../', import.meta.url).pathname
const { stdout } = await exec('npm', ['pack', '--dry-run', '--json', '--ignore-scripts'], { cwd: root, maxBuffer: 20 * 1024 * 1024 })
const [pack] = JSON.parse(stdout)
const paths = pack.files.map((entry) => entry.path)
assert.equal(paths.some((path) => /(?:^|\/)(?:node_modules|tests|\.overlay|packages)(?:\/|$)/.test(path)), false)
for (const required of ['bin/hairness.mjs', 'schemas/v4/home.schema.json', 'schemas/v4/extension.schema.json', 'extensions/onboarding/hairness.json', 'extensions/scratch/hairness.json']) assert.ok(paths.includes(required), `${required} missing from tarball`)
assert.equal(paths.some((path) => path.startsWith('extensions/project/')), false)
assert.equal(pack.name, '@hairness/cli')
console.log(`package contents passed (${paths.length} files)`)
