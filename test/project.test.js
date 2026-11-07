import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { detectProject, detectProjectFrom, validateProject } from '../src/project.js';

async function fixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'mcdev-project-'));
  await fs.mkdir(path.join(root, 'src/main/java/com/example/testmod'), { recursive: true });
  await fs.mkdir(path.join(root, 'src/main/resources'), { recursive: true });
  await fs.writeFile(path.join(root, 'settings.gradle'), "rootProject.name = 'testmod'\n");
  await fs.writeFile(path.join(root, 'build.gradle'), "plugins { id 'fabric-loom' version '1.9.2' }\ndependencies { minecraft 'com.mojang:minecraft:1.21.1' }\n");
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

test('accepts client-only sources and finds client mixin classes', async () => {
  const cwd = await fixture();
  await fs.rm(path.join(cwd, 'src/main/java'), { recursive: true, force: true });
  const mixinDir = path.join(cwd, 'src/client/java/com/example/testmod/mixin');
  await fs.mkdir(mixinDir, { recursive: true });
  await fs.writeFile(path.join(mixinDir, 'TestMixin.java'), 'package com.example.testmod.mixin; public class TestMixin {}');
  await fs.writeFile(path.join(cwd, 'src/main/resources/testmod.mixins.json'), JSON.stringify({ package: 'com.example.testmod.mixin', client: ['TestMixin'] }));
  await fs.writeFile(path.join(cwd, 'src/main/resources/fabric.mod.json'), JSON.stringify({ schemaVersion: 1, id: 'testmod', version: '1.0.0', entrypoints: {}, depends: { minecraft: '>=1.21', fabricloader: '>=0.16' }, mixins: [{ config: 'testmod.mixins.json' }] }));
  const project = await detectProject(cwd);
  assert.deepEqual(project.sourceRoots, ['src/client/java']);
  assert.equal(project.javaFiles, 1);
  const validation = await validateProject(project);
  assert.equal(validation.ok, true);
  assert.ok(!validation.warnings.some((warning) => warning.includes('mixin class source not found')));
});

test('does not compare Java versions when the version profile has no requirement', async () => {
  const cwd = await fixture();
  await fs.writeFile(path.join(cwd, 'gradle.properties'), 'minecraft_version=snapshot\njava_version=1\n');
  const project = await detectProject(cwd);
  assert.equal(project.minecraftVersion, 'snapshot');
  assert.equal(project.versionProfile.java, undefined);
  assert.ok(project.warnings.some((warning) => warning.includes('not in the built-in version table')));
  const validation = await validateProject(project);
  assert.ok(!validation.warnings.some((warning) => warning.includes('may be too old')));
});

test('finds a Gradle project in a subdirectory of the working directory', async () => {
  const session = await fs.mkdtemp(path.join(os.tmpdir(), 'mcdev-session-'));
  const root = path.join(session, 'mods', 'example');
  await fs.mkdir(path.join(root, 'src/main/java'), { recursive: true });
  await fs.writeFile(path.join(root, 'settings.gradle'), "rootProject.name = 'example'\n");
  await fs.writeFile(path.join(root, 'gradle.properties'), 'minecraft_version=1.21.1\njava_version=21\n');
  const project = await detectProject(session);
  assert.equal(project.found, true);
  assert.equal(project.root, root);
  assert.equal(project.search.mode, 'descendant');
  assert.deepEqual(project.search.candidates, ['mods/example']);
  assert.ok(project.warnings.some((warning) => warning.includes('using mods/example')));
});

test('reports an empty working directory without searching endlessly', async () => {
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'mcdev-empty-'));
  const project = await detectProject(cwd);
  assert.equal(project.found, false);
  assert.equal(project.search.mode, 'none');
  assert.deepEqual(project.warnings, ['No Gradle project marker found; run from a Fabric/NeoForge/Forge project directory.']);
});

test('warns when several subdirectory projects are visible', async () => {
  const session = await fs.mkdtemp(path.join(os.tmpdir(), 'mcdev-multi-'));
  for (const name of ['alpha', 'beta']) {
    const root = path.join(session, name);
    await fs.mkdir(root, { recursive: true });
    await fs.writeFile(path.join(root, 'build.gradle'), "plugins { id 'java' }\n");
  }
  const project = await detectProject(session);
  assert.equal(project.found, true);
  assert.equal(project.search.ambiguous, true);
  assert.deepEqual(project.search.candidates, ['alpha', 'beta']);
  assert.ok(project.warnings.some((warning) => warning.includes('Multiple Gradle projects')));
});

test('does not treat a lone gradle.properties as a descendant project root', async () => {
  const session = await fs.mkdtemp(path.join(os.tmpdir(), 'mcdev-props-'));
  await fs.mkdir(path.join(session, 'docs'), { recursive: true });
  await fs.writeFile(path.join(session, 'docs', 'gradle.properties'), 'minecraft_version=1.21.1\n');
  const project = await detectProject(session);
  assert.equal(project.found, false);
  assert.equal(project.search.mode, 'none');
});

test('uses an explicit project root outside the working directory', async () => {
  const session = await fs.mkdtemp(path.join(os.tmpdir(), 'mcdev-session-'));
  const root = path.join(session, 'nested', 'mod');
  await fs.mkdir(root, { recursive: true });
  await fs.writeFile(path.join(root, 'settings.gradle'), "rootProject.name = 'mod'\n");
  await fs.writeFile(path.join(root, 'gradle.properties'), 'minecraft_version=1.21.1\njava_version=21\n');

  const absolute = await detectProjectFrom(session, root);
  assert.equal(absolute.found, true);
  assert.equal(absolute.root, root);

  const relative = await detectProjectFrom(session, path.join('nested', 'mod'));
  assert.equal(relative.root, root);

  await assert.rejects(() => detectProjectFrom(session, path.dirname(root)), /must be the Gradle project root/);
  await assert.rejects(() => detectProjectFrom(session, path.join('..', 'outside')), /path escapes/);
  await assert.rejects(() => detectProjectFrom(session, path.join(session, 'missing')), /not an existing directory/);
});
