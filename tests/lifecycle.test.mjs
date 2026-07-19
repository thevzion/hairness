import assert from 'node:assert/strict'
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import test from 'node:test'
import { buildHome } from '../src/build.mjs'
import { createHome } from '../src/create.mjs'
import { addCatalog, addExtension, removeExtension, searchCatalogs, updateExtension } from '../src/lifecycle.mjs'
import { packHairness } from '../scripts/lib/pack.mjs'
import { packPackage, packedHomeOptions, writePackage } from './helpers.mjs'

const projectRoot = new URL('../', import.meta.url).pathname

test('npm lifecycle stays disabled while add, update and remove remain explicit', async () => {
  const root = await mkdtemp(join(tmpdir(), 'hairness-lifecycle-'))
  try {
    const packs = await packHairness(projectRoot, join(root, 'packs'))
    const home = join(root, 'home')
    await createHome(home, packedHomeOptions(packs))
    const v1 = await extensionFixture(join(root, 'extension-v1'), '0.1.0', 'Review version one.')
    await addExtension(home, await trackedPackage(home, v1))
    assert.match(await readFile(join(home, '.agents/skills/review/SKILL.md'), 'utf8'), /version one/)
    assert.equal(await readFile(join(home, 'generated/static.txt'), 'utf8'), 'static asset\n')
    await assert.rejects(readFile(join(home, 'node_modules/@acme/review/install-ran')), (error) => error.code === 'ENOENT')
    const v2 = await extensionFixture(join(root, 'extension-v2'), '0.2.0', 'Review version two.')
    await updateExtension(home, '@acme/review', await trackedPackage(home, v2))
    assert.match(await readFile(join(home, '.agents/skills/review/SKILL.md'), 'utf8'), /version two/)
    await removeExtension(home, '@acme/review')
    await assert.rejects(readFile(join(home, '.agents/skills/review/SKILL.md')), (error) => error.code === 'ENOENT')
    await assert.rejects(readFile(join(home, 'generated/static.txt')), (error) => error.code === 'ENOENT')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('Adapters require approval, own declared outputs and reject divergence', async () => {
  const root = await mkdtemp(join(tmpdir(), 'hairness-adapter-'))
  try {
    const packs = await packHairness(projectRoot, join(root, 'packs'))
    const home = join(root, 'home')
    await createHome(home, packedHomeOptions(packs))
    const adapter = await adapterFixture(join(root, 'adapter'))
    const spec = await trackedPackage(home, adapter)
    const before = await readFile(join(home, 'package-lock.json'))
    await assert.rejects(() => addExtension(home, spec), (error) => error.code === 'adapter_approval_required')
    assert.deepEqual(await readFile(join(home, 'package-lock.json')), before)
    await addExtension(home, spec, { allowBuild: true })
    const proof = join(home, 'generated/adapter.txt')
    assert.equal(await readFile(proof, 'utf8'), 'adapter ready\n')
    await writeFile(proof, 'changed\n')
    await assert.rejects(() => buildHome(home), (error) => error.code === 'generated_output_diverged')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('Adapters reject undeclared and symbolic-link outputs without partial writes', async () => {
  const root = await mkdtemp(join(tmpdir(), 'hairness-adapter-output-'))
  try {
    const packs = await packHairness(projectRoot, join(root, 'packs'))
    for (const mode of ['undeclared', 'symlink']) {
      const home = join(root, `home-${mode}`)
      await createHome(home, packedHomeOptions(packs))
      const adapter = await invalidAdapterFixture(join(root, `adapter-${mode}`), mode)
      const spec = await trackedPackage(home, adapter)
      const before = await readFile(join(home, 'package-lock.json'))
      await assert.rejects(
        () => addExtension(home, spec, { allowBuild: true }),
        (error) => error.code === (mode === 'undeclared' ? 'adapter_output_undeclared' : 'symlink_forbidden'),
      )
      assert.deepEqual(await readFile(join(home, 'package-lock.json')), before)
      await assert.rejects(readFile(join(home, 'generated/accepted.txt')), (error) => error.code === 'ENOENT')
    }
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('a thin Catalog resolves an exact package spec', async () => {
  const root = await mkdtemp(join(tmpdir(), 'hairness-catalog-'))
  try {
    const packs = await packHairness(projectRoot, join(root, 'packs'))
    const home = join(root, 'home')
    await createHome(home, packedHomeOptions(packs))
    const extension = await extensionFixture(join(root, 'extension'), '0.1.0', 'Catalog review.')
    const extensionSpec = await trackedPackage(home, extension)
    const catalogRoot = join(root, 'catalog')
    await writePackage(catalogRoot, {
      name: '@acme/catalog',
      version: '0.1.0',
      type: 'module',
      files: ['catalog.json'],
      hairness: {
        apiVersion: 'hairness.dev/package/v1alpha1',
        kind: 'Catalog',
        summary: 'Fixture catalog.',
        index: 'catalog.json',
      },
    }, {
      'catalog.json': `${JSON.stringify({ apiVersion: 'hairness.dev/catalog/v1alpha1', entries: { review: extensionSpec } }, null, 2)}\n`,
    })
    const catalog = await packPackage(catalogRoot, join(root, 'packs'))
    const catalogSpec = await trackedPackage(home, catalog)
    await addCatalog(home, 'fixture', catalogSpec)
    assert.deepEqual(await searchCatalogs(home, 'review'), [{ catalog: 'fixture', id: 'review', spec: extensionSpec }])
    await addExtension(home, 'catalog:fixture/review')
    assert.match(await readFile(join(home, '.agents/skills/review/SKILL.md'), 'utf8'), /Catalog review/)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

async function extensionFixture(root, version, body) {
  await writePackage(root, {
    name: '@acme/review',
    version,
    type: 'module',
    files: ['assets/', 'install.mjs'],
    scripts: { install: 'node install.mjs' },
    hairness: {
      apiVersion: 'hairness.dev/package/v1alpha1',
      kind: 'Extension',
      summary: 'Review fixture.',
      subtype: 'assets',
      contributes: {
        files: [{ path: 'assets/static.txt', output: 'generated/static.txt' }],
        skills: [{ id: 'review', summary: 'Review a subject.', path: 'assets/review.md' }],
        commands: [{ id: 'review', skill: 'review', summary: 'Review a subject.' }],
      },
    },
  }, {
    'assets/review.md': `${body}\n`,
    'assets/static.txt': 'static asset\n',
    'install.mjs': "import { writeFileSync } from 'node:fs'; writeFileSync(new URL('./install-ran', import.meta.url), 'ran')\n",
  })
  return packPackage(root, join(root, '..', 'packs'))
}

async function adapterFixture(root) {
  await writePackage(root, {
    name: '@acme/adapter',
    version: '0.1.0',
    type: 'module',
    files: ['adapter.mjs'],
    hairness: {
      apiVersion: 'hairness.dev/package/v1alpha1',
      kind: 'Extension',
      summary: 'Adapter fixture.',
      subtype: 'adapter',
      contributes: {},
      adapter: { entry: 'adapter.mjs', outputs: ['generated'] },
    },
  }, {
    'adapter.mjs': "import { mkdirSync, writeFileSync } from 'node:fs'; import { join } from 'node:path'; const root = process.env.HAIRNESS_OUTPUT_DIR; mkdirSync(join(root, 'generated'), { recursive: true }); writeFileSync(join(root, 'generated/adapter.txt'), 'adapter ready\\n')\n",
  })
  return packPackage(root, join(root, '..', 'packs'))
}

async function invalidAdapterFixture(root, mode) {
  const operation = mode === 'undeclared'
    ? "writeFileSync(join(root, 'rogue.txt'), 'rogue\\n')"
    : "symlinkSync('accepted.txt', join(root, 'generated/link.txt'))"
  await writePackage(root, {
    name: `@acme/adapter-${mode}`,
    version: '0.1.0',
    type: 'module',
    files: ['adapter.mjs'],
    hairness: {
      apiVersion: 'hairness.dev/package/v1alpha1',
      kind: 'Extension',
      summary: `Invalid ${mode} adapter fixture.`,
      subtype: 'adapter',
      contributes: {},
      adapter: { entry: 'adapter.mjs', outputs: ['generated'] },
    },
  }, {
    'adapter.mjs': `import { mkdirSync, symlinkSync, writeFileSync } from 'node:fs'; import { join } from 'node:path'; const root = process.env.HAIRNESS_OUTPUT_DIR; mkdirSync(join(root, 'generated'), { recursive: true }); writeFileSync(join(root, 'generated/accepted.txt'), 'accepted\\n'); ${operation}\n`,
  })
  return packPackage(root, join(root, '..', 'packs'))
}

async function trackedPackage(home, source) {
  const vendor = join(home, 'vendor')
  await mkdir(vendor, { recursive: true })
  const destination = join(vendor, basename(source))
  await copyFile(source, destination)
  return `file:vendor/${basename(source)}`
}
