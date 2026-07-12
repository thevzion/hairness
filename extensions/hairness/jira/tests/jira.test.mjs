import test from 'node:test'
import assert from 'node:assert/strict'
import { chmod, mkdtemp, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { sourceOperations } from '../index.mjs'

test('Jira source owns issue reads', async () => {
  const root = await mkdtemp(join(tmpdir(), 'hairness-jira-'))
  const bin = join(root, 'jira.mjs')
  await writeFile(bin, '#!/usr/bin/env node\nprocess.stdout.write(JSON.stringify({key:"PLAT-1"}))\n'); await chmod(bin, 0o755)
  process.env.HAIRNESS_JIRA_BIN = bin
  assert.equal((await sourceOperations.issue({ input: { key: 'PLAT-1' } })).key, 'PLAT-1')
})
