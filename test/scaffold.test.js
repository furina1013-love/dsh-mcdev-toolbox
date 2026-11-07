import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { initProject } from '../src/scaffold.js';
import { detectProject, validateProject } from '../src/project.js';

test('initializes a minimal Fabric project that can be detected and validated', async () => {
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'mcdev-scaffold-'));
  const result = await initProject({ modId: 'ruby', name: 'Ruby Mod', minecraftVersion: '1.21.1' }, cwd);
  assert.equal(result.ok, true);
  assert.equal(result.loader, 'fabric');
  assert.equal(result.javaVersion, '21');
  assert.ok(result.files.includes('build.gradle'));
  assert.ok(result.files.includes('src/main/resources/fabric.mod.json'));
  assert.ok(result.files.includes('src/main/java/com/example/ruby/RubyMod.java'));
  assert.deepEqual(result.warnings, []);
  const project = await detectProject(cwd);
  assert.equal(project.found, true);
  assert.equal(project.loader, 'fabric');
  assert.equal(project.minecraftVersion, '1.21.1');
  assert.equal(project.modId, 'ruby');
  const validation = await validateProject(project);
  assert.equal(validation.ok, true);
  assert.equal(validation.errors.length, 0);
});

test('refuses to overwrite an existing scaffold without overwrite=true', async () => {
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'mcdev-scaffold-'));
  await initProject({ modId: 'ruby', minecraftVersion: '1.21.1' }, cwd);
  await assert.rejects(() => initProject({ modId: 'ruby', minecraftVersion: '1.21.1' }, cwd), /refusing to overwrite/);
  const again = await initProject({ modId: 'ruby', minecraftVersion: '1.21.1', overwrite: true }, cwd);
  assert.equal(again.ok, true);
});

test('keeps init inside the working directory and validates versions', async () => {
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'mcdev-scaffold-'));
  await assert.rejects(() => initProject({ modId: 'ruby', minecraftVersion: '1.21.1', directory: '../escape' }, cwd), /escapes the project root/);
  await assert.rejects(() => initProject({ modId: 'Ruby', minecraftVersion: '1.21.1' }, cwd), /modId must match/);
  await assert.rejects(() => initProject({ modId: 'bad.id', minecraftVersion: '1.21.1' }, cwd), /modId must match/);
  await assert.rejects(() => initProject({ modId: 'ruby', name: '', minecraftVersion: '1.21.1' }, cwd), /name must be/);
  await assert.rejects(() => initProject({ modId: 'ruby', minecraftVersion: 'latest' }, cwd), /minecraftVersion is required/);
});

test('refuses to create a project nested inside an existing project', async () => {
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'mcdev-scaffold-'));
  await fs.writeFile(path.join(cwd, 'settings.gradle'), "rootProject.name = 'outer'\n");
  await assert.rejects(() => initProject({ modId: 'ruby', minecraftVersion: '1.21.1', directory: 'mods/ruby' }, cwd), /nested project/);
});

test('refuses to add Groovy build files to an existing Kotlin DSL project', async () => {
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'mcdev-scaffold-'));
  await fs.writeFile(path.join(cwd, 'settings.gradle.kts'), 'rootProject.name = "kotlin"\n');
  await fs.writeFile(path.join(cwd, 'build.gradle.kts'), 'plugins { java }\n');
  await assert.rejects(() => initProject({ modId: 'ruby', minecraftVersion: '1.21.1', overwrite: true }, cwd), /Kotlin DSL/);
});

test('does not write through a symbolic link that escapes the working directory', async () => {
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'mcdev-scaffold-'));
  const outside = await fs.mkdtemp(path.join(os.tmpdir(), 'mcdev-outside-'));
  await fs.symlink(outside, path.join(cwd, 'link'), 'dir');
  await assert.rejects(() => initProject({ modId: 'ruby', minecraftVersion: '1.21.1', directory: 'link' }, cwd), /symbolic link|escapes/);
});
