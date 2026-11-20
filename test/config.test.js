import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveConfig } from '../src/config.js';

test('config defaults and bounds', () => {
  const config = resolveConfig({});
  assert.equal(config.enabled, true);
  assert.equal(config.maxOutputChars, 12000);
  assert.equal(config.gradleTimeoutMs, 180000);
  assert.equal(config.includeExistingSessions, false);
  assert.equal(resolveConfig({ includeExistingSessions: true }).includeExistingSessions, true);
  assert.throws(() => resolveConfig({ maxOutputChars: 1 }), /maxOutputChars/);
  assert.throws(() => resolveConfig({ maxOutputChars: 16001 }), /maxOutputChars/);
  assert.throws(() => resolveConfig({ gradleTimeoutMs: 9999999 }), /gradleTimeoutMs/);
});

test('trustedRoots accepts project directories and rejects the filesystem root', () => {
  assert.deepEqual(resolveConfig({ trustedRoots: ['/srv/mods'] }).trustedRoots, ['/srv/mods']);
  assert.throws(() => resolveConfig({ trustedRoots: ['/'] }), /filesystem root/);
  assert.throws(() => resolveConfig({ trustedRoots: ['relative/path'] }), /absolute directory paths/);
  assert.throws(() => resolveConfig({ trustedRoots: Array.from({ length: 21 }, (unused, index) => '/srv/' + index) }), /at most 20/);
});
