import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { readFile } from 'node:fs/promises'

const exec = promisify(execFile)
const root = new URL('../', import.meta.url).pathname
const packageDocument = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'))
const { stdout } = await exec('npm', ['pack', '--dry-run', '--json', '--ignore-scripts'], { cwd: root, maxBuffer: 20 * 1024 * 1024 })
const [pack] = JSON.parse(stdout)
const files = pack.files.map((entry) => entry.path)
for (const required of [
  'bin/hairness.mjs',
  'src/cli.mjs',
  'schemas/v3/home.schema.json',
  'distributions/standard/hairness.distribution.json',
  'assets/extensions/hairness/cockpit/extension.json',
]) assert.ok(files.includes(required), `tarball misses ${required}`)
for (const path of files) {
  assert.ok(!/(^|\/)(?:\.overlay|node_modules|tests|\.agents|\.claude|\.codex)(?:\/|$)/.test(path) && !path.startsWith('runtime/'), `tarball contains forbidden path ${path}`)
  assert.ok(!/\/Users\//.test(String(await readFile(new URL(`../${path}`, import.meta.url)))), `tarball contains a private path in ${path}`)
}
assert.equal(pack.version, packageDocument.version)
assert.equal(packageDocument.name, '@hairness/cli')
assert.deepEqual(packageDocument.bin, { hairness: 'bin/hairness.mjs' })
console.log(`package gate passed (${files.length} files, ${pack.size} bytes)`)
