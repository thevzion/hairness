import test from 'node:test'
import assert from 'node:assert/strict'
import { chmod, mkdtemp, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { sourceOperations } from '../index.mjs'

test('AWS source owns identity reads without credentials in output', async () => {
  const root = await mkdtemp(join(tmpdir(), 'hairness-aws-'))
  const bin = join(root, 'aws.mjs')
  await writeFile(bin, '#!/usr/bin/env node\nprocess.stdout.write(JSON.stringify({Account:"123",Arn:"arn:fixture"}))\n'); await chmod(bin, 0o755)
  process.env.HAIRNESS_AWS_BIN = bin
  assert.equal((await sourceOperations.identity({ input: {} })).Account, '123')
})
