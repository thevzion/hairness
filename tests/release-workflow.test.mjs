import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createReleaseEvidence, renderReleaseSummary, verifyReleaseEvidence } from '../scripts/release-evidence.mjs'

const root = new URL('../', import.meta.url).pathname

function digest(buffer, algorithm, encoding) {
  return createHash(algorithm).update(buffer).digest(encoding)
}

test('release evidence binds one tarball to package policy and commit', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'hairness-release-evidence-'))
  const manifest = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'))
  const filename = 'hairness-cli-0.2.0-alpha.0.tgz'
  const tarball = join(directory, filename)
  const content = Buffer.from('qualified release tarball')
  await writeFile(tarball, content)
  const pack = [{
    name: manifest.name,
    version: manifest.version,
    filename,
    size: content.byteLength,
    unpackedSize: 42,
    shasum: digest(content, 'sha1', 'hex'),
    integrity: `sha512-${digest(content, 'sha512', 'base64')}`,
  }]
  const packJsonPath = join(directory, 'pack.json')
  const evidencePath = join(directory, 'evidence.json')
  const commit = 'a'.repeat(40)
  await writeFile(packJsonPath, JSON.stringify(pack))
  const evidence = await createReleaseEvidence({
    root,
    packJsonPath,
    outputPath: evidencePath,
    commit,
    createdAt: '2026-07-13T19:33:33.800Z',
  })
  assert.equal(evidence.tarball.sha256, `sha256:${digest(content, 'sha256', 'hex')}`)
  assert.match(renderReleaseSummary(evidence), /Qualified npm artifact/)
  assert.equal((await verifyReleaseEvidence({ root, evidencePath, tarballPath: tarball, commit })).commit, commit)
  await writeFile(tarball, 'tampered')
  await assert.rejects(
    verifyReleaseEvidence({ root, evidencePath, tarballPath: tarball, commit }),
    /downloaded tarball differs|size/,
  )
})

test('release workflow preserves one artifact and one OIDC publish boundary', async () => {
  const workflow = await readFile(join(root, '.github/workflows/release.yml'), 'utf8')
  assert.match(workflow, /^on:\n  workflow_dispatch:\n/m)
  assert.doesNotMatch(workflow, /^\s+push:/m)
  assert.match(workflow, /matrix:\n\s+node: \[22, 24\]/)
  assert.match(workflow, /npm install --global npm@\$\{\{ env\.NPM_VERSION \}\}/)
  assert.match(workflow, /NPM_VERSION: 11\.5\.1/)
  assert.equal((workflow.match(/npm pack --json/g) ?? []).length, 1)
  assert.match(workflow, /actions\/upload-artifact@v4/)
  assert.match(workflow, /actions\/download-artifact@v4/)
  assert.match(workflow, /environment:\n\s+name: npm/)
  assert.match(workflow, /id-token: write/)
  assert.match(workflow, /npm publish "\$release_dir\/\$tarball_file" --access public --tag "\$dist_tag"/)
  assert.doesNotMatch(workflow, /NPM_TOKEN|NODE_AUTH_TOKEN/)
  assert.doesNotMatch(workflow, /\bgit\s+tag\b|\bgh\s+release\b/)
  assert.ok(workflow.indexOf('actions/download-artifact@v4') < workflow.indexOf('Publish the exact artifact through npm OIDC'))
  assert.ok(workflow.indexOf('environment:\n      name: npm') < workflow.indexOf('id-token: write'))
})
