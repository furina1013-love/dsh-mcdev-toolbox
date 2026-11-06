import test from 'node:test';
import assert from 'node:assert/strict';
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
