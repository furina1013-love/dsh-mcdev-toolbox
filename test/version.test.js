import test from 'node:test';
import assert from 'node:assert/strict';
import { versionProfile } from '../src/version.js';

test('version profiles switch Java at 1.20.5', () => {
  assert.equal(versionProfile('1.20.4').java, 17);
  assert.equal(versionProfile('1.20.5').java, 21);
  assert.equal(versionProfile('1.21.1').java, 21);
});
test('recipe result key and data folders switch at the correct versions', () => {
  assert.equal(versionProfile('1.20.4').resultKey, 'item');
  assert.equal(versionProfile('1.20.4').ingredientStyle, 'object');
  assert.equal(versionProfile('1.20.5').ingredientStyle, 'string');
  assert.equal(versionProfile('1.20.5').resultKey, 'id');
  assert.equal(versionProfile('1.20.4').dataDirStyle, 'plural');
  assert.equal(versionProfile('1.21.0').dataDirStyle, 'singular');
});
test('item model definitions only start at 1.21.4', () => {
  assert.equal(versionProfile('1.21.3').itemDefinitions, false);
  assert.equal(versionProfile('1.21.4').itemDefinitions, true);
});
test('unknown versions degrade safely', () => {
  assert.equal(versionProfile('2.0.0').known, false);
});

test('uses pack formats and Java levels from older version rows', () => {
  assert.equal(versionProfile('1.19.2').resourcePack, 9);
  assert.equal(versionProfile('1.19.3').resourcePack, 12);
  assert.equal(versionProfile('1.17.1').java, 16);
  assert.equal(versionProfile('1.17.1').resourcePack, 7);
  assert.equal(versionProfile('1.16.5').java, 8);
  assert.equal(versionProfile('1.16.5').resourcePack, 6);
});
