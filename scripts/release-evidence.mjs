import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import { basename, dirname, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const defaultRoot = fileURLToPath(new URL('../', import.meta.url))

function digest(buffer, algorithm, encoding) {
  return createHash(algorithm).update(buffer).digest(encoding)
}

function parseArguments(values) {
  const [mode, ...rest] = values
  const flags = {}
  for (let index = 0; index < rest.length; index += 1) {
    const key = rest[index]
    assert.ok(key.startsWith('--'), `Unexpected argument: ${key}`)
    const value = rest[index + 1]
    assert.ok(value && !value.startsWith('--'), `Missing value for ${key}`)
    flags[key.slice(2)] = value
    index += 1
  }
  return { mode, flags }
}

async function releasePolicy(root) {
  const [manifest, distribution] = await Promise.all([
    readFile(resolve(root, 'package.json'), 'utf8').then(JSON.parse),
    readFile(resolve(root, 'hairness.json'), 'utf8').then(JSON.parse),
  ])
  const policy = distribution.defaults.delivery.release
  assert.equal(manifest.name, policy.package, 'package name differs from delivery policy')
  assert.equal(manifest.publishConfig?.tag, policy.prereleaseTag, 'npm tag differs from delivery policy')
  return { manifest, policy }
}

function computedTarball(buffer) {
  return {
    sha256: `sha256:${digest(buffer, 'sha256', 'hex')}`,
    integrity: `sha512-${digest(buffer, 'sha512', 'base64')}`,
    shasum: digest(buffer, 'sha1', 'hex'),
  }
}

export async function createReleaseEvidence({
  root = defaultRoot,
  packJsonPath,
  outputPath,
  commit,
  createdAt = new Date().toISOString(),
}) {
  assert.match(commit, /^[0-9a-f]{40}$/, 'release evidence requires an exact commit')
  const { manifest, policy } = await releasePolicy(root)
  const packs = JSON.parse(await readFile(packJsonPath, 'utf8'))
  assert.equal(packs.length, 1, 'release workflow must produce exactly one tarball')
  const pack = packs[0]
  assert.equal(pack.name, manifest.name)
  assert.equal(pack.version, manifest.version)
  assert.equal(pack.filename, basename(pack.filename), 'tarball filename must not escape its artifact directory')
  const tarballPath = resolve(dirname(packJsonPath), pack.filename)
  const buffer = await readFile(tarballPath)
  const computed = computedTarball(buffer)
  assert.equal(pack.size, buffer.byteLength, 'npm pack size differs from the tarball')
  assert.equal(pack.integrity, computed.integrity, 'npm pack integrity differs from the tarball')
  assert.equal(pack.shasum, computed.shasum, 'npm pack shasum differs from the tarball')
  const evidence = {
    schemaVersion: 1,
    package: {
      name: manifest.name,
      version: manifest.version,
      registry: policy.registry,
      distTag: policy.prereleaseTag,
    },
    commit,
    tarball: {
      file: pack.filename,
      ...computed,
      size: pack.size,
      unpackedSize: pack.unpackedSize,
    },
    qualifiedNodeVersions: ['22', '24'],
    createdAt,
  }
  await writeFile(outputPath, `${JSON.stringify(evidence, null, 2)}\n`)
  return evidence
}

export async function verifyReleaseEvidence({
  root = defaultRoot,
  evidencePath,
  tarballPath,
  commit,
}) {
  const { manifest, policy } = await releasePolicy(root)
  const evidence = JSON.parse(await readFile(evidencePath, 'utf8'))
  const buffer = await readFile(tarballPath)
  assert.equal(evidence.schemaVersion, 1)
  assert.equal(evidence.commit, commit, 'artifact commit differs from the workflow commit')
  assert.equal(evidence.package.name, manifest.name)
  assert.equal(evidence.package.version, manifest.version)
  assert.equal(evidence.package.registry, policy.registry)
  assert.equal(evidence.package.distTag, policy.prereleaseTag)
  assert.equal(evidence.tarball.file, basename(tarballPath))
  assert.deepEqual(
    {
      sha256: evidence.tarball.sha256,
      integrity: evidence.tarball.integrity,
      shasum: evidence.tarball.shasum,
    },
    computedTarball(buffer),
    'downloaded tarball differs from qualified evidence',
  )
  assert.equal(evidence.tarball.size, buffer.byteLength)
  assert.deepEqual(evidence.qualifiedNodeVersions, ['22', '24'])
  return evidence
}

export function renderReleaseSummary(evidence) {
  return [
    '## Qualified npm artifact',
    '',
    `- Package: \`${evidence.package.name}@${evidence.package.version}\``,
    `- Commit: \`${evidence.commit}\``,
    `- Tarball: \`${evidence.tarball.file}\``,
    `- SHA-256: \`${evidence.tarball.sha256}\``,
    `- Integrity: \`${evidence.tarball.integrity}\``,
    `- npm tag: \`${evidence.package.distTag}\``,
    '',
  ].join('\n')
}

async function main() {
  const { mode, flags } = parseArguments(process.argv.slice(2))
  const root = resolve(flags.root ?? defaultRoot)
  if (mode === 'create') {
    const evidence = await createReleaseEvidence({
      root,
      packJsonPath: resolve(flags['pack-json']),
      outputPath: resolve(flags.output),
      commit: flags.commit,
    })
    process.stdout.write(`${JSON.stringify(evidence)}\n`)
    return
  }
  if (mode === 'verify') {
    const evidence = await verifyReleaseEvidence({
      root,
      evidencePath: resolve(flags.evidence),
      tarballPath: resolve(flags.tarball),
      commit: flags.commit,
    })
    process.stdout.write(`release artifact verified: ${evidence.tarball.sha256}\n`)
    return
  }
  if (mode === 'summary') {
    const evidence = JSON.parse(await readFile(resolve(flags.evidence), 'utf8'))
    process.stdout.write(renderReleaseSummary(evidence))
    return
  }
  throw new Error('Usage: release-evidence.mjs create|verify|summary [flags]')
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main()
