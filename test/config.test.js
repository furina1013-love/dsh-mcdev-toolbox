import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveConfig } from '../src/config.js';

test('config defaults and bounds', () => {
  const config = resolveConfig({});
  assert.equal(config.enabled, true);
  assert.equal(config.maxOutputChars, 12000);
  assert.equal(config.gradleTimeoutMs, 180000);
  assert.throws(() => resolveConfig({ maxOutputChars: 1 }), /maxOutputChars/);
  assert.throws(() => resolveConfig({ maxOutputChars: 16001 }), /maxOutputChars/);
  assert.throws(() => resolveConfig({ gradleTimeoutMs: 9999999 }), /gradleTimeoutMs/);
});
