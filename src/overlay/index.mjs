import { cp, lstat, mkdir, readFile, readdir, realpath, rename, stat, writeFile } from 'node:fs/promises'
import { join, relative, resolve, sep } from 'node:path'
import { API } from '../contracts/index.mjs'
import { loadHome } from '../home/index.mjs'
import { HairnessError } from '../lib/errors.mjs'
import { assertInside, exists, now, readJson, writeFileAtomic, writeJsonAtomic } from '../lib/io.mjs'
import { ensureRuntime, userPaths } from '../runtime/index.mjs'
import { git } from '../runtime/git.mjs'

const forbiddenNames = new Set(['.env', '.env.local', 'credentials', 'credentials.json', 'id_rsa', 'id_ed25519', '.npmrc'])

export function overlayPaths(root) {
  const overlay = join(root, '.overlay')
  return {
    root: overlay,
    readme: join(overlay, 'README.md'),
    profile: join(overlay, 'profile.json'),
    onboarding: join(overlay, 'onboarding'),
    onboardingDraft: join(overlay, 'onboarding', 'draft.json'),
    scratches: join(overlay, 'scratches'),
    artifacts: join(overlay, 'artifacts'),
    receipts: join(overlay, 'receipts'),
    gitignore: join(overlay, '.gitignore'),
  }
}

export async function initializeOverlay(root, options = {}) {
  const home = await loadHome(root)
  const paths = overlayPaths(root)
  await Promise.all([paths.onboarding, paths.scratches, paths.artifacts, paths.receipts].map((path) => mkdir(path, { recursive: true })))
  if (!await exists(paths.readme)) await writeFile(paths.readme, '# Hairness Overlay\n\nExplicit local memory: Scratch, accepted Artifacts and immutable Receipts. No transcripts, reasoning, credentials or runtime state.\n')
  if (!await exists(paths.profile)) await writeJsonAtomic(paths.profile, { language: home.spec.language, snapshot: home.spec.overlay.snapshot })
  if (!await exists(paths.gitignore)) await writeFile(paths.gitignore, '.DS_Store\n*.tmp\n')
  if (options.git ?? home.spec.overlay.git) {
    if (!await exists(join(paths.root, '.git'))) await git(['init', '--quiet'], { cwd: paths.root })
    if (!await git(['remote'], { cwd: paths.root }).then((value) => !value).catch(() => false)) {
      throw new HairnessError('overlay_remote_forbidden', 'Overlay Git must remain local and have no remotes.')
    }
    await snapshotOverlay(root, { message: 'chore: initialize Hairness Overlay', allowEmpty: true })
  }
  return paths
}

export async function overlayStatus(root) {
  const home = await loadHome(root)
  const paths = overlayPaths(root)
  const gitEnabled = await exists(join(paths.root, '.git'))
  const status = gitEnabled ? await git(['status', '--porcelain=v2', '--untracked-files=all'], { cwd: paths.root, trim: false }) : ''
  return { home: home.metadata.id, path: paths.root, git: gitEnabled, snapshot: home.spec.overlay.snapshot, dirty: Boolean(status.trim()), changes: status.split('\n').filter(Boolean) }
}

export async function inspectOverlaySafety(root, options = {}) {
  const paths = overlayPaths(root)
  const maxFileBytes = options.maxFileBytes ?? 1024 * 1024
  const files = []
  async function visit(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      if (entry.name === '.git') continue
      const path = join(directory, entry.name)
      const rel = relative(paths.root, path).split(sep).join('/')
      if (entry.isSymbolicLink()) {
        const target = await realpath(path)
        assertInside(paths.root, target, `Overlay symlink ${rel}`)
        throw new HairnessError('overlay_symlink_forbidden', `Overlay snapshots do not include symbolic links: ${rel}.`)
      }
      if (entry.isDirectory()) await visit(path)
      else if (entry.isFile()) {
        if (forbiddenNames.has(entry.name.toLowerCase()) || /(?:secret|token|private[-_]?key)/i.test(entry.name)) {
          throw new HairnessError('overlay_credential_path', `Credential-like path blocks the snapshot: ${rel}.`)
        }
        const size = (await stat(path)).size
        if (size > maxFileBytes) throw new HairnessError('overlay_file_oversized', `${rel} exceeds the ${maxFileBytes} byte Overlay limit.`)
        files.push({ path: rel, size })
      }
    }
  }
  await visit(paths.root)
  return files
}

export async function snapshotOverlay(root, options = {}) {
  const paths = overlayPaths(root)
  if (!await exists(join(paths.root, '.git'))) return { status: 'disabled', commit: null }
  const remotes = await git(['remote'], { cwd: paths.root })
  if (remotes) throw new HairnessError('overlay_remote_forbidden', 'Overlay snapshots refuse repositories with a remote.')
  await inspectOverlaySafety(root, options)
  const status = await git(['status', '--porcelain=v2', '--untracked-files=all'], { cwd: paths.root, trim: false })
  if (!status.trim() && !options.allowEmpty) return { status: 'unchanged', commit: await git(['rev-parse', 'HEAD'], { cwd: paths.root }).catch(() => null) }
  await git(['add', '--all'], { cwd: paths.root })
  await git(['-c', 'user.name=Hairness', '-c', 'user.email=local@hairness.dev', 'commit', '--quiet', ...(options.allowEmpty ? ['--allow-empty'] : []), '-m', options.message ?? 'chore: snapshot Hairness boundary'], { cwd: paths.root })
  return { status: 'snapshotted', commit: await git(['rev-parse', 'HEAD'], { cwd: paths.root }) }
}

export async function maybeBoundarySnapshot(root, message) {
  const home = await loadHome(root)
  if (home.spec.overlay.snapshot !== 'boundary') return { status: 'manual', commit: null }
  return snapshotOverlay(root, { message })
}

export async function archiveOverlay(root) {
  const home = await loadHome(root)
  const source = overlayPaths(root).root
  if (!await exists(source)) throw new HairnessError('overlay_missing', 'No Overlay exists to archive.')
  const stamp = now().replace(/[:.]/g, '-')
  const destination = join(userPaths().archives, home.metadata.id, stamp)
  await mkdir(destination, { recursive: true })
  await cp(source, join(destination, 'overlay'), { recursive: true, verbatimSymlinks: true })
  await writeJsonAtomic(join(destination, 'archive.json'), { home: home.metadata.id, archivedAt: now(), format: 'opaque-directory', source: '.overlay' })
  return { status: 'archived', path: destination }
}

