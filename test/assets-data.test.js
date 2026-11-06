import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { runAssets } from '../src/assets.js';
import { runData } from '../src/data.js';

async function project(version = '1.21.1') {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'mcdev-json-'));
  await fs.mkdir(path.join(root, 'src/main/resources'), { recursive: true });
  await fs.writeFile(path.join(root, 'settings.gradle'), "rootProject.name = 'testmod'\n");
  await fs.writeFile(path.join(root, 'build.gradle'), "plugins { id 'fabric-loom' version '1.9-SNAPSHOT' }\ndependencies { minecraft 'com.mojang:minecraft:" + version + "' }\n");
  await fs.writeFile(path.join(root, 'gradle.properties'), 'minecraft_version=' + version + '\n');
  await fs.writeFile(path.join(root, 'src/main/resources/fabric.mod.json'), JSON.stringify({ schemaVersion: 1, id: 'testmod', version: '1.0.0', depends: { minecraft: '>=1.21', fabricloader: '>=0.16' } }));
  return root;
}

test('generates item/block assets and language entries', async () => {
  const cwd = await project();
  const item = await runAssets({ action: 'item', name: 'ruby' }, { cwd });
  assert.equal(item.ok, true);
  assert.ok(item.files.some((file) => file.path === 'assets/testmod/models/item/ruby.json'));
  const block = await runAssets({ action: 'block', name: 'ruby_block' }, { cwd });
  assert.equal(block.ok, true);
  const lang = JSON.parse(await fs.readFile(path.join(cwd, 'src/main/resources/assets/testmod/lang/en_us.json'), 'utf8'));
  assert.equal(lang['item.testmod.ruby'], 'Ruby');
  assert.equal(lang['block.testmod.ruby_block'], 'Ruby Block');
  const validation = await runAssets({ action: 'validate' }, { cwd });
  assert.equal(validation.ok, true);
});

test('uses 1.21.4 item model definitions', async () => {
  const cwd = await project('1.21.4');
  const item = await runAssets({ action: 'item', name: 'ruby' }, { cwd });
  assert.ok(item.files.some((file) => file.path === 'assets/testmod/items/ruby.json'));
});

test('writes version-correct recipe files and validates', async () => {
  const cwd = await project('1.21.1');
  const result = await runData({ action: 'recipe', name: 'ruby_block', type: 'crafting_shaped', pattern: ['RRR', 'RRR', 'RRR'], key: { R: 'testmod:ruby' }, result: 'testmod:ruby_block' }, { cwd });
  assert.equal(result.ok, true);
  assert.ok(result.path.endsWith('data/testmod/recipe/ruby_block.json'));
  const recipe = JSON.parse(await fs.readFile(result.path, 'utf8'));
  assert.deepEqual(recipe.result, { id: 'testmod:ruby_block', count: 1 });
  const validation = await runData({ action: 'validate' }, { cwd });
  assert.equal(validation.ok, true);
});

test('writes a tag file under the requested namespace', async () => {
  const cwd = await project('1.20.1');
  const result = await runData({ action: 'tag', tag: 'minecraft:planks', values: ['testmod:ruby'] }, { cwd });
  assert.equal(result.ok, true);
  assert.ok(result.path.endsWith('data/minecraft/tags/items/planks.json'));
});

test('detects model parent cycles', async () => {
  const cwd = await project('1.21.1');
  const models = path.join(cwd, 'src/main/resources/assets/testmod/models/block');
  await fs.mkdir(models, { recursive: true });
  await fs.writeFile(path.join(models, 'a.json'), JSON.stringify({ parent: 'testmod:block/b' }));
  await fs.writeFile(path.join(models, 'b.json'), JSON.stringify({ parent: 'testmod:block/a' }));
  const report = await runAssets({ action: 'validate' }, { cwd });
  assert.equal(report.ok, false);
  assert.ok(report.errors.some((message) => message.includes('parent cycle')));
});

test('warns about missing 1.21.4 item definitions', async () => {
  const cwd = await project('1.21.4');
  const models = path.join(cwd, 'src/main/resources/assets/testmod/models/item');
  await fs.mkdir(models, { recursive: true });
  await fs.writeFile(path.join(models, 'ruby.json'), JSON.stringify({ parent: 'minecraft:item/generated', textures: { layer0: 'testmod:item/ruby' } }));
  const report = await runAssets({ action: 'validate' }, { cwd });
  assert.ok(report.warnings.some((message) => message.includes('item model definition missing')));
});

test('writes legacy smithing recipes with the item result key', async () => {
  const cwd = await project('1.20.1');
  const result = await runData({ action: 'recipe', name: 'ruby_pickaxe', type: 'smithing', template: 'testmod:template', base: 'minecraft:iron_pickaxe', addition: 'testmod:ruby', result: 'testmod:ruby_pickaxe' }, { cwd });
  const recipe = JSON.parse(await fs.readFile(result.path, 'utf8'));
  assert.equal(recipe.type, 'minecraft:smithing');
  assert.deepEqual(recipe.result, { item: 'testmod:ruby_pickaxe', count: 1 });
});
