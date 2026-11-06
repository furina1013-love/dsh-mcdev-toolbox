import test from 'node:test';
import assert from 'node:assert/strict';
import { GROUP_NAMES, GROUPS, controlTool, groupTools, allGroupTools } from '../src/tool-defs.js';

test('group catalog is complete and unique', () => {
  assert.deepEqual(GROUP_NAMES, ['project', 'assets', 'data', 'code', 'diagnostics']);
  const names = allGroupTools();
  assert.equal(new Set(names).size, names.length);
  assert.deepEqual(names.sort(), ['mcdev_assets', 'mcdev_build', 'mcdev_data', 'mcdev_log', 'mcdev_mappings', 'mcdev_mixin', 'mcdev_project'].sort());
  for (const group of GROUP_NAMES) assert.ok(GROUPS[group].tools.length > 0);
});

test('control tool exposes only small control schema', () => {
  const tool = controlTool({ activate: () => ({}), deactivate: () => ({}), status: () => ({}) });
  assert.equal(tool.name, 'mcdev_toolbox');
  assert.deepEqual(Object.keys(tool.parameters).sort(), ['action', 'groups', 'reason']);
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
  }
});
