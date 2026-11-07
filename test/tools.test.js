import test from 'node:test';
import assert from 'node:assert/strict';
import { GROUP_NAMES, GROUPS, controlTool, groupTools, allGroupTools } from '../src/tool-defs.js';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

test('group catalog is complete and unique', () => {
  assert.deepEqual(GROUP_NAMES, ['project', 'assets', 'data', 'code', 'diagnostics']);
  const names = allGroupTools();
  assert.equal(new Set(names).size, names.length);
  assert.deepEqual(names.sort(), ['mcdev_assets', 'mcdev_build', 'mcdev_data', 'mcdev_jar', 'mcdev_log', 'mcdev_mappings', 'mcdev_mixin', 'mcdev_project'].sort());
  for (const group of GROUP_NAMES) assert.ok(GROUPS[group].tools.length > 0);
});

test('control tool exposes compiled small control schema', () => {
  const tool = controlTool({ activate: () => ({}), deactivate: () => ({}), status: () => ({}) });
  assert.equal(tool.name, 'mcdev_toolbox');
  assert.equal(tool.parameters.type, 'object');
  assert.deepEqual(Object.keys(tool.parameters.properties).sort(), ['action', 'groups', 'reason']);
  assert.deepEqual(tool.parameters.required, ['action']);
  assert.equal(tool.parameters.properties.action.type, 'string');
  assert.equal(tool.parameters.properties.action.required, undefined);
  assert.deepEqual(tool.parameters.properties.action.enum, ['activate', 'deactivate', 'status']);
});

test('group tool factories produce unique valid definitions', () => {
  const ctx = { workingDirectory: { ensure: async () => process.cwd() } };
  const definitions = groupTools({ ctx, config: { maxOutputChars: 12000, gradleTimeoutMs: 180000 } });
  const all = Object.values(definitions).flat();
  assert.equal(new Set(all.map((tool) => tool.name)).size, all.length);
  for (const tool of all) {
    assert.equal(typeof tool.name, 'string');
    assert.equal(typeof tool.description, 'string');
    assert.equal(typeof tool.execute, 'function');
    assert.equal(typeof tool.output.schema, 'object');
    assert.equal(tool.parameters.type, 'object');
    assert.equal(typeof tool.parameters.properties, 'object');
    assert.equal(tool.parameters.additionalProperties, false);
    for (const [name, property] of Object.entries(tool.parameters.properties)) {
      assert.equal(typeof property, 'object', name);
      assert.equal(property.required, undefined, name + ' must not retain author-only required');
      assert.ok(typeof property.description === 'string' || property.type !== undefined, name);
    }
  }
  const data = all.find((tool) => tool.name === 'mcdev_data');
  assert.equal(data.parameters.properties.ingredients.items.oneOf.length, 2);
  assert.equal(data.parameters.properties.ingredients.items.oneOf[0].type, 'string');
  assert.deepEqual(data.parameters.properties.values.items.oneOf[1].required, ['id']);
  const jar = all.find((tool) => tool.name === 'mcdev_jar');
  assert.deepEqual(jar.parameters.properties.action.enum, ['inspect', 'list', 'read', 'class', 'disassemble']);
  assert.equal(jar.parameters.properties.action.required, undefined);
  assert.equal(jar.parameters.properties.path.type, 'string');
});

test('project tool can initialize a Fabric project through its execute surface', async () => {
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'mcdev-tool-init-'));
  const ctx = { workingDirectory: { ensure: async () => cwd } };
  const definitions = groupTools({ ctx, config: { maxOutputChars: 12000, gradleTimeoutMs: 180000 } });
  const projectTool = definitions.project.find((tool) => tool.name === 'mcdev_project');
  const result = await projectTool.execute({ action: 'init', modId: 'ruby', minecraftVersion: '1.21.1' }, { agent: {} });
  assert.equal(result.ok, true);
  assert.ok(result.files.includes('settings.gradle'));
  await assert.rejects(() => projectTool.execute({ action: 'init', modId: 'ruby', minecraftVersion: '1.21.1' }, { agent: {} }), /refusing to overwrite/);
});

test('projectDir selects a project outside the session working directory', async () => {
  const session = await fs.mkdtemp(path.join(os.tmpdir(), 'mcdev-tool-root-'));
  const root = path.join(session, 'actual-mod');
  await fs.mkdir(root, { recursive: true });
  await fs.writeFile(path.join(root, 'settings.gradle'), "rootProject.name = 'actual'\n");
  await fs.writeFile(path.join(root, 'gradle.properties'), 'minecraft_version=1.21.1\njava_version=21\n');
  const ctx = { workingDirectory: { ensure: async () => session } };
  const definitions = groupTools({ ctx, config: { maxOutputChars: 12000, gradleTimeoutMs: 180000 } });
  const projectTool = definitions.project.find((tool) => tool.name === 'mcdev_project');
  const result = await projectTool.execute({ action: 'inspect', projectDir: root }, { agent: {} });
  assert.equal(result.found, true);
  assert.equal(result.root, root);
  assert.equal(result.minecraftVersion, '1.21.1');
});
