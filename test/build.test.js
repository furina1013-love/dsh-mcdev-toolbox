import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { assertGradleInvocation, runGradle } from '../src/build.js';

test('rejects Gradle arguments that can escape the project', async () => {
  await assert.rejects(() => runGradle({ cwd: '/tmp', task: 'build', args: ['--init-script=/tmp/evil.gradle'] }), /redirect the build root/);
  await assert.rejects(() => runGradle({ cwd: '/tmp', task: 'build', args: ['-I', '/tmp/evil.gradle'] }), /redirect the build root/);
});

test('accepts common and namespaced Gradle tasks', () => {
  assert.doesNotThrow(() => assertGradleInvocation('build'));
  assert.doesNotThrow(() => assertGradleInvocation(':fabric:runClient'));
  assert.doesNotThrow(() => assertGradleInvocation('runData', ['--stacktrace']));
});

test('rejects unknown tasks and property overrides', () => {
  assert.throws(() => assertGradleInvocation('publishEverywhere'), /allowed Gradle task list/);
  assert.throws(() => assertGradleInvocation('build', ['-Pfoo=bar']), /redirect the build root/);
  assert.throws(() => assertGradleInvocation('build', ['-Dfoo=bar']), /redirect the build root/);
  assert.throws(() => assertGradleInvocation('build', ['--project-dir=/tmp/evil']), /redirect the build root/);
});

test('defaults to the build task when none is supplied', async () => {
  if (process.platform === 'win32') return;
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'mcdev-build-'));
  await fs.writeFile(path.join(root, 'settings.gradle'), "rootProject.name = 'fixture'\n");
  const wrapper = path.join(root, 'gradlew');
  await fs.writeFile(wrapper, '#!/bin/sh\necho "BUILD SUCCESSFUL"\n');
  await fs.chmod(wrapper, 0o755);
  const result = await runGradle({ cwd: root, timeoutMs: 20000 });
  assert.equal(result.task, 'build');
  assert.equal(result.ok, true);
});
