import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { detectProject, validateProject } from '../src/project.js';

async function fixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'mcdev-project-'));
  await fs.mkdir(path.join(root, 'src/main/java/com/example/testmod'), { recursive: true });
  await fs.mkdir(path.join(root, 'src/main/resources'), { recursive: true });
  await fs.writeFile(path.join(root, 'settings.gradle'), "rootProject.name = 'testmod'\n");
  await fs.writeFile(path.join(root, 'build.gradle'), "plugins { id 'fabric-loom' version '1.9-SNAPSHOT' }\ndependencies { minecraft 'com.mojang:minecraft:1.21.1' }\n");
  await fs.writeFile(path.join(root, 'gradle.properties'), 'minecraft_version=1.21.1\nyarn_mappings=1.21.1+build.3\njava_version=21\n');
  await fs.writeFile(path.join(root, 'src/main/resources/fabric.mod.json'), JSON.stringify({ schemaVersion: 1, id: 'testmod', version: '1.0.0', entrypoints: {}, depends: { minecraft: '>=1.21', fabricloader: '>=0.16' }, mixins: [] }));
  await fs.writeFile(path.join(root, 'src/main/resources/pack.mcmeta'), JSON.stringify({ pack: { pack_format: 34, description: 'test' } }));
  await fs.writeFile(path.join(root, 'src/main/java/com/example/testmod/TestMod.java'), 'package com.example.testmod; public class TestMod {}');
  return root;
}

test('detects a Fabric 1.21.1 project', async () => {
  const cwd = await fixture();
  const project = await detectProject(cwd);
  assert.equal(project.found, true);
  assert.equal(project.loader, 'fabric');
  assert.equal(project.minecraftVersion, '1.21.1');
  assert.equal(project.modId, 'testmod');
  assert.equal(project.javaVersion, '21');
  assert.equal(project.javaFiles, 1);
  assert.deepEqual(project.warnings, []);
  const validation = await validateProject(project);
  assert.equal(validation.ok, true);
});

test('reports broken metadata', async () => {
  const cwd = await fixture();
  await fs.writeFile(path.join(cwd, 'src/main/resources/fabric.mod.json'), JSON.stringify({ schemaVersion: 1, id: 'Bad Id', version: '', entrypoints: [] }));
  const validation = await validateProject(await detectProject(cwd));
  assert.equal(validation.ok, false);
  assert.ok(validation.errors.some((error) => error.includes('id must match')));
  assert.ok(validation.errors.some((error) => error.includes('version must be')));
});

test('warns when pack.mcmeta format does not match the Minecraft version', async () => {
  const cwd = await fixture();
  await fs.writeFile(path.join(cwd, 'src/main/resources/pack.mcmeta'), JSON.stringify({ pack: { pack_format: 99, description: 'test' } }));
  const validation = await validateProject(await detectProject(cwd));
  assert.ok(validation.warnings.some((warning) => warning.includes('does not match Minecraft')));
});
