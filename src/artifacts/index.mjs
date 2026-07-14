import { mkdir, readFile, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { API, validateDocument } from '../contracts/index.mjs'
import { HairnessError } from '../lib/errors.mjs'
import { assertId, exists, now, readJson, writeFileAtomic, writeJsonExclusive } from '../lib/io.mjs'
import { maybeBoundarySnapshot, overlayPaths } from '../overlay/index.mjs'

export async function saveArtifact(root, options) {
  const owner = assertId(options.owner, 'Artifact owner')
  const type = assertId(options.type, 'Artifact type')
  const id = assertId(options.id, 'Artifact id')
  const mediaType = options.mediaType ?? (typeof options.payload === 'string' ? 'text/markdown' : 'application/json')
  const payloadName = mediaType === 'text/markdown' ? 'payload.md' : mediaType === 'application/json' ? 'payload.json' : null
  if (!payloadName) throw new HairnessError('artifact_media_type_invalid', `Unsupported Artifact media type: ${mediaType}.`)
  const directory = join(overlayPaths(root).artifacts, owner, type, id)
  if (await exists(directory)) throw new HairnessError('artifact_exists', `Artifact ${owner}/${type}/${id} already exists.`)
  if (mediaType === 'application/json' && options.validatePayload) await options.validatePayload(options.payload)
  const envelope = {
    apiVersion: API.artifact,
    kind: 'Artifact',
    metadata: { id, owner, type, createdAt: now() },
    spec: { mediaType, payload: payloadName, provenance: options.provenance ?? {} },
  }
  await validateDocument(envelope, 'Artifact')
  await mkdir(directory, { recursive: true })
  const content = mediaType === 'text/markdown' ? String(options.payload) : `${JSON.stringify(options.payload, null, 2)}\n`
  await writeFileAtomic(join(directory, payloadName), content, 0o644)
  await writeJsonExclusive(join(directory, 'artifact.json'), envelope)
  await maybeBoundarySnapshot(root, `artifact: save ${owner}/${type}/${id}`)
  return { envelope, payload: options.payload }
}

export async function showArtifact(root, owner, type, id) {
  const directory = join(overlayPaths(root).artifacts, assertId(owner), assertId(type), assertId(id))
  const envelope = await validateDocument(await readJson(join(directory, 'artifact.json')), 'Artifact')
  const names = (await readdir(directory)).filter((name) => name.startsWith('payload.'))
  if (names.length !== 1 || names[0] !== envelope.spec.payload) throw new HairnessError('artifact_payload_invalid', 'Artifact must contain exactly its one declared canonical payload.')
  const raw = await readFile(join(directory, envelope.spec.payload), 'utf8')
  return { envelope, payload: envelope.spec.mediaType === 'application/json' ? JSON.parse(raw) : raw }
}

export async function validateArtifact(root, owner, type, id, validatePayload) {
  const value = await showArtifact(root, owner, type, id)
  if (value.envelope.spec.mediaType === 'application/json' && validatePayload) await validatePayload(value.payload)
  return value
}

export async function listArtifacts(root) {
  const base = overlayPaths(root).artifacts
  const values = []
  async function visit(path) {
    for (const entry of await readdir(path, { withFileTypes: true }).catch((error) => error.code === 'ENOENT' ? [] : Promise.reject(error))) {
      const target = join(path, entry.name)
      if (entry.isDirectory()) await visit(target)
      else if (entry.name === 'artifact.json') values.push(await validateDocument(await readJson(target), 'Artifact'))
    }
  }
  await visit(base)
  values.sort((left, right) => `${left.metadata.owner}/${left.metadata.type}/${left.metadata.id}`.localeCompare(`${right.metadata.owner}/${right.metadata.type}/${right.metadata.id}`))
  return values
}
