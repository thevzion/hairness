import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

const exec = promisify(execFile)
const root = new URL('../', import.meta.url).pathname
const retiredPackageName = ['@hairness', 'hairness'].join('/')
const { stdout } = await exec('npm', ['pack', '--dry-run', '--json', '--ignore-scripts'], { cwd: root, encoding: 'utf8', maxBuffer: 20 * 1024 * 1024 })
const [pack] = JSON.parse(stdout)
const files = pack.files.map((entry) => entry.path)
for (const required of ['bin/hairness.mjs', 'src/cli.mjs', 'schemas/protocol.schema.json', 'catalog/standard.json', 'extensions/hairness/cockpit/extension.json']) assert.ok(files.includes(required), `tarball misses ${required}`)
for (const path of files) {
  assert.ok(!/(^|\/)(?:\.overlay|node_modules|transcripts?|\.env)(?:\/|$)/.test(path), `tarball contains forbidden path ${path}`)
  if (path.startsWith('extensions/')) assert.ok(path.startsWith('extensions/hairness/'), `tarball contains non-generic extension ${path}`)
  if (path.startsWith('catalog/')) assert.ok(['catalog/minimal.json', 'catalog/standard.json', 'catalog/forge.json'].includes(path) || path.startsWith('catalog/materials/'), `tarball contains non-generic recipe ${path}`)
  assert.ok(!String(await readFile(join(root, path))).includes(retiredPackageName), `tarball contains the retired package name in ${path}`)
}
for (const excluded of ['STATUS.md', 'ROADMAP.md', 'CHANGELOG.md', 'CONTRIBUTING.md', 'SPEC.md', 'SECURITY.md']) assert.ok(!files.includes(excluded), `tarball contains forge-only documentation ${excluded}`)
assert.equal(pack.version, '0.2.0-alpha.0')
const packageJson = JSON.parse(await readFile(new URL('../package.json', import.meta.url)))
assert.equal(packageJson.name, '@hairness/cli')
assert.deepEqual(packageJson.bin, { hairness: 'bin/hairness.mjs' })
assert.equal(pack.name, packageJson.name)
assert.equal(packageJson.private, false)
assert.equal(packageJson.license, 'MIT')
assert.equal(packageJson.publishConfig.tag, 'next')
console.log(`package gate passed (${files.length} files, ${pack.size} bytes)`)
