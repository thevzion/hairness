import { spawn } from 'node:child_process'
import { readdir } from 'node:fs/promises'
import { join } from 'node:path'

const root = new URL('../', import.meta.url).pathname

async function testFiles(directory) {
  const files = []
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) files.push(...await testFiles(path))
    else if (entry.name.endsWith('.test.mjs')) files.push(path)
  }
  return files
}

const files = (await testFiles(join(root, 'tests'))).sort()
const child = spawn(process.execPath, ['--test', '--test-concurrency=1', ...files], { stdio: 'inherit' })
child.on('exit', (code, signal) => process.exit(signal ? 1 : code ?? 1))
