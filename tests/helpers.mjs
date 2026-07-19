import { execFile } from 'node:child_process'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { promisify } from 'node:util'

const exec = promisify(execFile)

export function packedHomeOptions(packs, extra = {}) {
  return {
    packageSpec: `file:${packs.cli}`,
    starter: `file:${packs.starter}`,
    starterName: '@hairness/starter',
    packageOverrides: {
      '@hairness/native': `file:${packs.native}`,
      ...(extra.packageOverrides ?? {}),
    },
    ...extra,
  }
}

export async function writePackage(root, document, files = {}) {
  await mkdir(root, { recursive: true })
  await writeFile(join(root, 'package.json'), `${JSON.stringify(document, null, 2)}\n`)
  for (const [path, content] of Object.entries(files)) {
    await mkdir(join(root, path, '..'), { recursive: true })
    await writeFile(join(root, path), content)
  }
}

export async function packPackage(root, destination) {
  await mkdir(destination, { recursive: true })
  const { stdout } = await exec('npm', ['pack', '--json', '--ignore-scripts', '--pack-destination', destination], {
    cwd: root,
    maxBuffer: 20 * 1024 * 1024,
  })
  const [{ filename }] = JSON.parse(stdout)
  return join(destination, filename)
}
