import { mkdir, readdir, rename, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { HairnessError } from './errors.mjs'
import { appendJsonLine, ensureOverlay, now, readJson, removePath, workspacePaths, writeJsonAtomic } from './io.mjs'
import { validateContract } from './contracts.mjs'

function artifactParts(id) {
  const parts = id.split('/')
  if (parts.length !== 2 || parts.some((part) => !/^[a-z0-9][a-z0-9-]*$/.test(part))) {
    throw new HairnessError('invalid_artifact_id', `Invalid artifact id: ${id}`, { exitCode: 2 })
  }
  return parts
}

function renderArtifact(envelope) {
  const metadata = {
    id: envelope.id,
    owner: envelope.owner,
    type: envelope.type,
    revision: envelope.revision,
    labels: envelope.metadata.labels,
    signals: envelope.metadata.signals,
  }
  return `---\nhairness: ${JSON.stringify(metadata)}\n---\n\n<!-- Generated from artifact.json. Annotate or revise; do not edit this projection. -->\n\n# ${envelope.id}\n\n${envelope.summary}\n\n## Payload\n\n\`\`\`json\n${JSON.stringify(envelope.payload, null, 2)}\n\`\`\`\n`
}

export async function stageArtifact(root, runId, envelope) {
  await ensureOverlay(root)
  await validateContract('ArtifactEnvelope', envelope)
  if (envelope.runId !== runId) throw new HairnessError('artifact_run_mismatch', 'Artifact runId does not match staging run.')
  const directory = join(workspacePaths(root).staging, runId)
  await removePath(directory)
  await mkdir(directory, { recursive: true })
  await writeJsonAtomic(join(directory, 'artifact.json'), envelope)
  await writeFile(join(directory, 'artifact.md'), renderArtifact(envelope), { mode: 0o600 })
  return { directory, envelope }
}

export async function promoteArtifact(root, runId) {
  const paths = workspacePaths(root)
  const staging = join(paths.staging, runId)
  const envelope = await readJson(join(staging, 'artifact.json'), null)
  if (!envelope) throw new HairnessError('artifact_not_staged', `No staged artifact for run ${runId}.`)
  await validateContract('ArtifactEnvelope', envelope)
  const [namespace, name] = artifactParts(envelope.id)
  const artifactRoot = join(paths.artifacts, namespace, name)
  const revisionRoot = join(artifactRoot, 'revisions')
  const destination = join(revisionRoot, envelope.revision)
  if (await readJson(join(destination, 'artifact.json'), null)) {
    throw new HairnessError('artifact_revision_exists', `Artifact revision exists: ${envelope.id}@${envelope.revision}`, { exitCode: 2 })
  }
  await mkdir(revisionRoot, { recursive: true })
  await rename(staging, destination)
  await writeJsonAtomic(join(artifactRoot, 'current.json'), {
    schemaVersion: 2,
    protocolVersion: '0.2',
    id: envelope.id,
    revision: envelope.revision,
    promotedAt: now(),
  })
  return envelope
}

export async function readArtifact(root, id, revision) {
  const [namespace, name] = artifactParts(id)
  const artifactRoot = join(workspacePaths(root).artifacts, namespace, name)
  const selected = revision ?? (await readJson(join(artifactRoot, 'current.json'), null))?.revision
  if (!selected) throw new HairnessError('artifact_not_found', `Artifact not found: ${id}`)
  const envelope = await readJson(join(artifactRoot, 'revisions', selected, 'artifact.json'), null)
  if (!envelope) throw new HairnessError('artifact_revision_not_found', `Artifact revision not found: ${id}@${selected}`)
  return validateContract('ArtifactEnvelope', envelope)
}

export async function artifactHistory(root, id) {
  const [namespace, name] = artifactParts(id)
  const artifactRoot = join(workspacePaths(root).artifacts, namespace, name)
  const current = await readJson(join(artifactRoot, 'current.json'), null)
  if (!current) throw new HairnessError('artifact_not_found', `Artifact not found: ${id}`)
  const revisions = await readdir(join(artifactRoot, 'revisions'))
  return { id, current: current.revision, revisions: revisions.sort() }
}

export async function listArtifacts(root, filters = {}) {
  const output = []
  const base = workspacePaths(root).artifacts
  for (const namespace of await readdir(base, { withFileTypes: true }).catch(() => [])) {
    if (!namespace.isDirectory() || namespace.name.startsWith('.')) continue
    for (const name of await readdir(join(base, namespace.name), { withFileTypes: true }).catch(() => [])) {
      if (!name.isDirectory()) continue
      const artifact = await readArtifact(root, `${namespace.name}/${name.name}`).catch(() => null)
      if (!artifact) continue
      if (filters.owner && artifact.owner !== filters.owner) continue
      if (filters.type && artifact.type !== filters.type) continue
      if (filters.label && !artifact.metadata.labels.includes(filters.label)) continue
      if (filters.signal && !artifact.metadata.signals.includes(filters.signal)) continue
      output.push(artifact)
    }
  }
  return output.sort((a, b) => a.id.localeCompare(b.id))
}

export async function artifactGraph(root, id) {
  const artifact = await readArtifact(root, id)
  const incoming = []
  for (const candidate of await listArtifacts(root)) for (const relation of candidate.metadata.relations) {
    if (relation.target?.id === id) incoming.push({ from: { kind: 'artifact', id: candidate.id }, type: relation.type, target: relation.target })
  }
  return { artifact: { id: artifact.id, revision: artifact.revision, owner: artifact.owner, type: artifact.type }, outgoing: artifact.metadata.relations, incoming }
}

export async function annotateArtifact(root, id, annotation) {
  const [namespace, name] = artifactParts(id)
  await readArtifact(root, id)
  const path = join(workspacePaths(root).artifacts, namespace, name, 'annotations.jsonl')
  const record = { at: now(), ...annotation }
  await appendJsonLine(path, record)
  return record
}
