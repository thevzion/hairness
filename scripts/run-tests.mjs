import { spawn } from 'node:child_process'
import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'

const root = new URL('../', import.meta.url).pathname
const compositionIndex = process.argv.indexOf('--composition')
const composition = compositionIndex >= 0 ? process.argv[compositionIndex + 1] : 'active'
const distribution = JSON.parse(await readFile(join(root, 'hairness.json'), 'utf8'))
const extensionIds = composition === 'active'
  ? distribution.extensions.map((extension) => extension.id)
  : JSON.parse(await readFile(join(root, 'catalog', `${composition}.json`), 'utf8')).extensions

async function testFiles(directory) {
  const files = []
  for (const entry of await readdir(directory, { withFileTypes: true }).catch(() => [])) {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) files.push(...await testFiles(path))
    else if (entry.name.endsWith('.test.mjs')) files.push(path)
  }
  return files
}

const extensionTests = (await Promise.all(extensionIds.map((id) => testFiles(join(root, 'extensions', ...id.split('/'), 'tests'))))).flat()
const files = [...await testFiles(join(root, 'tests')), ...extensionTests].sort()

const child = spawn(process.execPath, ['--test', ...files], { stdio: 'inherit' })
child.on('exit', (code, signal) => process.exit(signal ? 1 : code ?? 1))
