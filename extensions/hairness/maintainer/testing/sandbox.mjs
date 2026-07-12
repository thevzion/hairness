import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { cp, mkdir, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { join, relative, resolve } from 'node:path'

const exec = promisify(execFile)
const safeId = (value, label) => { if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(value)) throw new Error(`Invalid ${label}: ${value}`) }
const base = (root) => join(root, '.overlay', 'extensions-state', 'hairness', 'maintainer', 'test-runs')
function attemptPath(root, suite, attempt) { safeId(suite, 'suite'); safeId(attempt, 'attempt'); return join(base(root), suite, attempt) }
function child(attempt, path) { const target = resolve(attempt, path); if (relative(attempt, target).startsWith('..')) throw new Error(`Test path escapes attempt: ${path}`); return target }

export async function prepare(root, runtime, suite, attempt) {
  const path = attemptPath(root, suite, attempt)
  const sandbox = { path, workspace: join(path, 'workspace'), home: join(path, 'home'), fixtures: join(path, 'fixtures'), evidence: join(path, 'evidence') }
  await Promise.all(Object.values(sandbox).slice(1).map((directory) => mkdir(directory, { recursive: true })))
  for (const entry of ['AGENTS.md', 'CLAUDE.md', 'package.json', 'hairness.json', 'hairness.build.json', 'bin', 'catalog', 'schemas', 'src', '.agents', '.codex']) await cp(join(root, entry), join(sandbox.workspace, entry), { recursive: true })
  for (const entry of ['skills', 'agents', 'settings.json']) await cp(join(root, '.claude', entry), join(sandbox.workspace, '.claude', entry), { recursive: true })
  const manifest = JSON.parse(await (await import('node:fs/promises')).readFile(join(root, 'hairness.json'), 'utf8'))
  for (const extension of manifest.extensions) await cp(resolve(root, extension.path), resolve(sandbox.workspace, extension.path), { recursive: true })
  return sandbox
}

export async function command(sandbox, args, budgetMs = 1000) {
  const started = performance.now()
  try {
    const { stdout, stderr } = await exec(process.execPath, [join(sandbox.workspace, 'bin', 'hairness.mjs'), ...args, '--json'], { cwd: sandbox.workspace, env: { ...process.env, HAIRNESS_ROOT: sandbox.workspace, HAIRNESS_HOME: sandbox.home }, encoding: 'utf8', timeout: Math.max(1000, budgetMs), maxBuffer: 10 * 1024 * 1024 })
    const durationMs = Math.round((performance.now() - started) * 100) / 100
    const envelope = JSON.parse(stdout)
    if (!envelope.ok) throw new Error(`${envelope.error.code}: ${envelope.error.summary}`)
    return { data: envelope.data, stderr, measurement: { command: `hairness ${args.join(' ')}`, durationMs, exitCode: 0, outputBytes: Buffer.byteLength(stdout), assertions: [] } }
  } catch (error) {
    error.measurement = { command: `hairness ${args.join(' ')}`, durationMs: Math.round((performance.now() - started) * 100) / 100, exitCode: error.code ?? 1, outputBytes: Buffer.byteLength(error.stdout ?? ''), assertions: [] }
    throw error
  }
}

export async function write(sandbox, path, value) { const target = child(sandbox.path, path); await mkdir(resolve(target, '..'), { recursive: true }); await writeFile(target, typeof value === 'string' ? value : `${JSON.stringify(value, null, 2)}\n`); return target }
export async function read(sandbox, path, fallback = null) { try { return JSON.parse(await (await import('node:fs/promises')).readFile(child(sandbox.path, path), 'utf8')) } catch (error) { if (error.code === 'ENOENT') return fallback; throw error } }
export async function compact(sandbox) { await Promise.all([sandbox.workspace, sandbox.home, sandbox.fixtures].map((path) => rm(path, { recursive: true, force: true }))) }
export async function find(root, attempt) { safeId(attempt, 'attempt'); for (const suite of await readdir(base(root)).catch(() => [])) { const path = attemptPath(root, suite, attempt); if (await stat(path).then(() => true).catch(() => false)) return { suite, path, workspace: join(path, 'workspace'), home: join(path, 'home'), fixtures: join(path, 'fixtures'), evidence: join(path, 'evidence') } } throw new Error(`Unknown test attempt: ${attempt}`) }
export async function clean(root, days) { const cutoff = Date.now() - days * 86_400_000; let removed = 0; for (const suite of await readdir(base(root)).catch(() => [])) for (const attempt of await readdir(join(base(root), suite)).catch(() => [])) { const path = attemptPath(root, suite, attempt); if ((await stat(path)).mtimeMs < cutoff) { await rm(path, { recursive: true, force: true }); removed += 1 } } return removed }
