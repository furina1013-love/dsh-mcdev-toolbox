import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { runMappings } from '../src/mappings.js';
import { analyzeLog } from '../src/log.js';

async function project() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'mcdev-map-'));
  await fs.mkdir(path.join(root, 'src/main/resources'), { recursive: true });
  await fs.writeFile(path.join(root, 'settings.gradle'), "rootProject.name = 'testmod'\n");
  await fs.writeFile(path.join(root, 'build.gradle'), "plugins { id 'fabric-loom' version '1.9-SNAPSHOT' }\n");
  await fs.writeFile(path.join(root, 'gradle.properties'), 'minecraft_version=1.21.1\n');
  await fs.writeFile(path.join(root, 'src/main/resources/fabric.mod.json'), JSON.stringify({ schemaVersion: 1, id: 'testmod', version: '1.0.0' }));
  return root;
}

test('searches a local Tiny mapping file', async () => {
  const cwd = await project();
  await fs.mkdir(path.join(cwd, 'mappings'), { recursive: true });
  await fs.writeFile(path.join(cwd, 'mappings/mappings.tiny'), 'tiny\t2\t0\tofficial\tnamed\nc\tnet/minecraft/class_1\tnet/minecraft/world/entity/Entity\n\tm\t()V\tmethod_1\thurt\n');
  const result = await runMappings({ query: 'Entity', file: 'mappings/mappings.tiny' }, { cwd });
  assert.equal(result.ok, true);
  assert.ok(result.mappings.length >= 1);
  assert.equal(result.mappings[0].named, 'net/minecraft/world/entity/Entity');
});

test('analyzes a mixin crash excerpt', async () => {
  const cwd = await project();
  await fs.mkdir(path.join(cwd, 'run/logs'), { recursive: true });
  await fs.writeFile(path.join(cwd, 'run/logs/latest.log'), 'line one\nMixin apply failed testmod.mixins.json:ExampleMixin -> net.minecraft.class_1\nCaused by: java.lang.NoSuchMethodError: foo\n');
  const result = await analyzeLog({}, { cwd });
  assert.equal(result.ok, true);
  assert.ok(result.findings.some((finding) => finding.kind === 'mixin'));
});
