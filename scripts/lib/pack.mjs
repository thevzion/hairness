import { execFile } from 'node:child_process'
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { promisify } from 'node:util'

const exec = promisify(execFile)

export async function packHairness(root, destination) {
  await mkdir(destination, { recursive: true })
  const cli = await pack(root, destination, [])
  const native = await pack(root, destination, ['--workspace', '@hairness/native'])
  const starter = await pack(root, destination, ['--workspace', '@hairness/starter'])
  return {
    cli: join(destination, cli.filename),
    native: join(destination, native.filename),
    starter: join(destination, starter.filename),
  }
}

async function pack(root, destination, workspace) {
  const { stdout } = await exec('npm', ['pack', '--json', '--ignore-scripts', '--pack-destination', destination, ...workspace], {
    cwd: root,
    maxBuffer: 20 * 1024 * 1024,
  })
  return JSON.parse(stdout)[0]
}
