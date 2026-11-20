import test from 'node:test';
import assert from 'node:assert/strict';
import { versionProfile, versionCaveat } from '../src/version.js';

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
  assert.equal(versionProfile('snapshot').parsed, false);
  assert.equal(versionProfile('snapshot').resourcePack, undefined);
  assert.match(versionCaveat(versionProfile('snapshot')), /could not be parsed/);
});

test('versions newer than the table are flagged instead of silently reused', () => {
  const newer = versionProfile('1.21.5');
  assert.equal(newer.known, false);
  assert.equal(newer.newer, true);
  assert.equal(newer.supported, true);
  assert.equal(newer.resourcePack, 55);
  assert.match(versionCaveat(newer), /newer than this build supports/);
  const unknown = versionProfile('1.22.0');
  assert.equal(unknown.resourcePack, undefined, 'a guessed pack format must never be returned');
  assert.match(versionCaveat(unknown), /pack_format is unknown/);
  assert.equal(versionProfile('1.21.4').known, true);
  assert.equal(versionCaveat(versionProfile('1.21.4')), undefined);
});

test('versions older than the table are unsupported with fallback conventions', () => {
  const legacy = versionProfile('1.12.2');
  assert.equal(legacy.supported, true);
  assert.equal(legacy.resourcePack, 3);
  assert.equal(legacy.java, 8);
  const ancient = versionProfile('1.6.4');
  assert.equal(ancient.supported, false);
  assert.equal(ancient.newer, false);
  assert.equal(ancient.resourcePack, undefined);
  assert.match(versionCaveat(ancient), /outside the supported range/);
});

test('uses pack formats and Java levels from older version rows', () => {
  assert.equal(versionProfile('1.19.2').resourcePack, 9);
  assert.equal(versionProfile('1.19.3').resourcePack, 12);
  assert.equal(versionProfile('1.17.1').java, 16);
  assert.equal(versionProfile('1.17.1').resourcePack, 7);
  assert.equal(versionProfile('1.16.5').java, 8);
  assert.equal(versionProfile('1.16.5').resourcePack, 6);
});
