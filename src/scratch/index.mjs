import { appendFile, mkdir, readFile, readdir } from 'node:fs/promises'
import { basename, join, resolve } from 'node:path'
import { API, validateDocument } from '../contracts/index.mjs'
import { loadHome } from '../home/index.mjs'
import { HairnessError } from '../lib/errors.mjs'
import { assertId, exists, now, readJson, writeFileAtomic, writeJsonAtomic } from '../lib/io.mjs'
import { maybeBoundarySnapshot, overlayPaths } from '../overlay/index.mjs'
import { ensureRuntime } from '../runtime/index.mjs'

const semanticKinds = new Set(['decision', 'constraint', 'handoff', 'next', 'park', 'close'])

function sessionKey(session = {}) {
  const provider = session.provider ?? process.env.HAIRNESS_PROVIDER ?? 'local'
  const id = session.id ?? process.env.HAIRNESS_SESSION_ID ?? 'default'
  return `${provider}-${id}`.replace(/[^a-zA-Z0-9._-]+/g, '-')
}

async function bindingPath(root, session) {
  const home = await loadHome(root)
  const runtime = await ensureRuntime(home)
  return join(runtime.providers, 'sessions', `${sessionKey(session)}.json`)
}

export async function activeScratch(root, session) {
  const binding = await readJson(await bindingPath(root, session), null)
  return binding?.scratch ?? null
}

export async function createScratch(root, options = {}) {
  const paths = overlayPaths(root)
  if (!await exists(paths.profile)) throw new HairnessError('overlay_missing', 'Initialize the Overlay before creating a Scratch.')
  const id = assertId(options.id ?? slug(options.title), 'Scratch id')
  const directory = join(paths.scratches, id)
  if (await exists(directory)) throw new HairnessError('scratch_exists', `Scratch ${id} already exists.`)
  await Promise.all([mkdir(join(directory, 'sessions'), { recursive: true }), mkdir(join(directory, 'outputs'), { recursive: true })])
  const timestamp = now()
  const document = {
    apiVersion: API.scratch,
    kind: 'Scratch',
    metadata: { id, createdAt: timestamp, updatedAt: timestamp },
    spec: { title: options.title ?? id, status: 'active', notes: 'notes.md', context: 'context.md', next: null },
  }
  await validateDocument(document, 'Scratch')
  await writeJsonAtomic(join(directory, 'scratch.json'), document)
  await writeFileAtomic(join(directory, 'context.md'), options.context ? `${options.context.trim()}\n` : '', 0o644)
  await writeFileAtomic(join(directory, 'notes.md'), '', 0o644)
  if (options.use !== false) await useScratch(root, id, options.session)
  await maybeBoundarySnapshot(root, `work: create Scratch ${id}`)
  return document
}

export async function useScratch(root, id, session) {
  const document = await showScratch(root, id)
  if (document.spec.status === 'closed') throw new HairnessError('scratch_closed', `Scratch ${id} is closed.`)
  await writeJsonAtomic(await bindingPath(root, session), { scratch: id, attachedAt: now() })
  return document
}

export async function showScratch(root, id) {
  const document = await readJson(join(overlayPaths(root).scratches, assertId(id, 'Scratch id'), 'scratch.json'))
  return validateDocument(document, 'Scratch')
}

export async function listScratches(root) {
  const values = []
  for (const name of (await readdir(overlayPaths(root).scratches, { withFileTypes: true })).filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort()) {
    values.push(await showScratch(root, name))
  }
  return values
}

export async function noteScratch(root, options = {}) {
  if (!semanticKinds.has(options.kind)) throw new HairnessError('note_kind_required', `Scratch notes require a semantic kind: ${[...semanticKinds].join(', ')}.`)
  const id = options.id ?? await activeScratch(root, options.session)
  if (!id) throw new HairnessError('scratch_not_attached', 'This session is ephemeral. Create or join a Scratch before writing notes.')
  const document = await showScratch(root, id)
  if (document.spec.status !== 'active') throw new HairnessError('scratch_not_active', `Scratch ${id} is ${document.spec.status}.`)
  const text = String(options.text ?? '').trim()
  if (!text) throw new HairnessError('note_empty', 'Scratch note text must not be empty.')
  if (/transcript|chain[- ]of[- ]thought|reasoning trace/i.test(text)) throw new HairnessError('transcript_forbidden', 'Scratch notes must contain semantic outcomes, not transcripts or reasoning traces.')
  const directory = join(overlayPaths(root).scratches, id)
  await appendFile(join(directory, 'notes.md'), `\n## ${options.kind} — ${now()}\n\n${text}\n`, { encoding: 'utf8', mode: 0o644 })
  document.metadata.updatedAt = now()
  if (options.kind === 'next') document.spec.next = text
  await writeJsonAtomic(join(directory, 'scratch.json'), document)
  await maybeBoundarySnapshot(root, `work: record ${options.kind} in ${id}`)
  return document
}

export async function setScratchStatus(root, id, status) {
  if (!['parked', 'closed'].includes(status)) throw new HairnessError('scratch_status_invalid', `Unsupported Scratch status: ${status}.`)
  const document = await showScratch(root, id)
  document.spec.status = status
  document.metadata.updatedAt = now()
  await writeJsonAtomic(join(overlayPaths(root).scratches, id, 'scratch.json'), document)
  await maybeBoundarySnapshot(root, `work: ${status === 'closed' ? 'close' : 'park'} Scratch ${id}`)
  return document
}

export async function importScratch(root, source, options = {}) {
  const path = resolve(source)
  const info = await import('node:fs/promises').then(({ stat }) => stat(path))
  let context = ''
  let notes = ''
  if (info.isDirectory()) {
    context = await readFile(join(path, 'context.md'), 'utf8').catch((error) => error.code === 'ENOENT' ? '' : Promise.reject(error))
    notes = await readFile(join(path, 'notes.md'), 'utf8').catch((error) => error.code === 'ENOENT' ? '' : Promise.reject(error))
  } else notes = await readFile(path, 'utf8')
  const document = await createScratch(root, { id: options.id, title: options.title ?? basename(path), context, use: options.use, session: options.session })
  if (notes.trim()) await writeFileAtomic(join(overlayPaths(root).scratches, document.metadata.id, 'notes.md'), notes, 0o644)
  await maybeBoundarySnapshot(root, `work: import Scratch ${document.metadata.id}`)
  return document
}

function slug(value = 'scratch') {
  return String(value).toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^-|-$/g, '').slice(0, 80) || 'scratch'
}

