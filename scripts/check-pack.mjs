import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const exec = promisify(execFile)
const root = new URL('../', import.meta.url).pathname

for (const workspace of [null, '@hairness/native', '@hairness/starter']) {
  const args = ['pack', '--dry-run', '--json', '--ignore-scripts']
  if (workspace) args.push('--workspace', workspace)
  const { stdout } = await exec('npm', args, { cwd: root, maxBuffer: 20 * 1024 * 1024 })
  const [pack] = JSON.parse(stdout)
  const paths = pack.files.map((entry) => entry.path)
  assert.equal(paths.some((path) => /(?:^|\/)(?:node_modules|tests|\.overlay)(?:\/|$)/.test(path)), false)
  if (!workspace) {
    assert.ok(paths.includes('bin/hairness.mjs'))
    assert.ok(paths.includes('schemas/v4/package.schema.json'))
  }
}
console.log('package contents passed')
