import { randomUUID } from 'node:crypto'
import { readdir } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import * as sandbox from './sandbox.mjs'
import { receipt } from './receipts.mjs'

const root = dirname(fileURLToPath(import.meta.url))
async function suiteIds() { return (await readdir(join(root, 'test-suites'), { withFileTypes: true })).filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort() }
async function load(id) { if (!(await suiteIds()).includes(id)) throw new Error(`Unknown test suite: ${id}`); const module = await import(`${pathToFileURL(join(root, 'test-suites', id, 'test.mjs')).href}?v=${Date.now()}`); return module.default }

export async function run({ repositoryRoot, runtime, suiteId, replayOf = null }) {
  const suite = await load(suiteId)
  const attemptId = `${Date.now().toString(36)}-${randomUUID().slice(0, 8)}`
  const box = await sandbox.prepare(repositoryRoot, runtime, suite.id, attemptId)
  await sandbox.write(box, 'manifest.json', { schemaVersion: 2, protocolVersion: '0.2', attemptId, suite: suite.id, actor: suite.actor.id, sandbox: box.path, replayOf, startedAt: new Date().toISOString() })
  const measurements = []; const checks = []
  const command = async (args, budget) => {
    const result = await sandbox.command(box, args, budget)
    if (budget) {
      const ceiling = process.env.CI ? 1000 : budget
      result.measurement.assertions.push(`durationMs<${ceiling}`)
      if (result.measurement.durationMs >= ceiling) throw new Error(`${result.measurement.command} exceeded ${ceiling} ms (${result.measurement.durationMs} ms).`)
    }
    measurements.push(result.measurement)
    return result.data
  }
  let result
  try {
    await suite.test({ sandbox: box, command, checks, actor: suite.actor, write: (path, value) => sandbox.write(box, path, value) })
    result = await receipt(runtime, { schemaVersion: 2, protocolVersion: '0.2', attemptId, suite: suite.id, status: 'succeeded', measurements, checks, evidence: [], limits: [], finishedAt: new Date().toISOString() })
    await sandbox.write(box, 'result.json', result); await sandbox.compact(box)
  } catch (error) {
    if (error.measurement) measurements.push(error.measurement)
    result = await receipt(runtime, { schemaVersion: 2, protocolVersion: '0.2', attemptId, suite: suite.id, status: 'failed', measurements, checks, evidence: [], limits: [error.message], finishedAt: new Date().toISOString() })
    await sandbox.write(box, 'result.json', result)
  }
  return { ...result, path: box.path, routes: result.status === 'failed' ? [`hairness maintain test replay ${attemptId}`] : [] }
}

export async function command({ repositoryRoot, runtime, action, rest, flags }) {
  const mode = action ?? 'list'
  if (mode === 'list') return { suites: await suiteIds() }
  if (mode === 'run') return run({ repositoryRoot, runtime, suiteId: rest[0] ?? flags.suite })
  if (mode === 'show') { const found = await sandbox.find(repositoryRoot, rest[0] ?? flags.attempt); return { manifest: await sandbox.read(found, 'manifest.json'), result: await sandbox.read(found, 'result.json'), path: found.path } }
  if (mode === 'replay') { const attempt = rest[0] ?? flags.attempt; const found = await sandbox.find(repositoryRoot, attempt); return run({ repositoryRoot, runtime, suiteId: found.suite, replayOf: attempt }) }
  if (mode === 'clean') return { summary: `Removed ${await sandbox.clean(repositoryRoot, Number.parseInt(String(flags['older-than'] ?? '7d'), 10))} expired test attempt(s).`, status: 'cleaned', limits: [], routes: [] }
  throw new Error(`Unknown maintain test action: ${mode}`)
}
