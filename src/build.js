import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { detectProject } from './project.js';
import { boundText, exists, relativeTo, walk } from './util.js';

const TASK_PATTERN = /^[A-Za-z0-9_:-]{1,80}$/;
const ALLOWED_TASKS = new Set([
  'assemble', 'build', 'buildEnvironment', 'check', 'classes', 'clean',
  'compileJava', 'compileTestJava', 'dependencies', 'eclipse', 'genEclipseRuns',
  'genIntellijRuns', 'genSources', 'help', 'idea', 'jar', 'javadoc', 'projects',
  'processResources', 'processTestResources', 'publishToMavenLocal', 'remapJar',
  'remapSourcesJar', 'runClient', 'runClientData', 'runData', 'runDatagen',
  'runGameTestServer', 'runServer', 'runServerData', 'sourcesJar', 'tasks', 'test',
  'testClasses', 'wrapper'
]);
const ARG_PATTERN = /^[A-Za-z0-9_.:=/+-]{1,160}$/;
const DANGEROUS_ARG = /^(?:--(?:project-dir|init-script|build-file|settings-file|gradle-user-home|include-build|project-prop|system-prop)(?:=|$)|-[IbcgPD])/;
const ERROR_PATTERN = /^(?:e: |error: |FAILURE:|Caused by:|Execution failed for task |> Task .* FAILED|\d+ tests? failed|Exception in thread|A failure occurred)/i;

/** Validate the task/argument surface before any process is spawned. */
export function assertGradleInvocation(task, args = []) {
  if (typeof task !== 'string' || !TASK_PATTERN.test(task)) {
    throw new Error('task must be a Gradle task name such as build, compileJava, runData, or runClient');
  }
  const segments = task.replace(/^:+/, '').split(':').filter(Boolean);
  if (segments.length === 0 || !ALLOWED_TASKS.has(segments[segments.length - 1])) {
    throw new Error('task is not in the allowed Gradle task list: ' + task);
  }
  if (!Array.isArray(args) || args.length > 8) throw new Error('args must be an array of at most 8 Gradle arguments');
  for (const arg of args) {
    if (typeof arg !== 'string' || !ARG_PATTERN.test(arg)) throw new Error('unsupported Gradle argument: ' + String(arg));
    if (DANGEROUS_ARG.test(arg)) throw new Error('argument can redirect the build root or load an external script: ' + arg);
  }
}

function commandFor(root) {
  const wrapper = path.join(root, process.platform === 'win32' ? 'gradlew.bat' : 'gradlew');
  return wrapper;
}

function killTree(child) {
  if (child.pid === undefined) return;
  try {
    if (process.platform === 'win32') child.kill();
    else process.kill(-child.pid, 'SIGTERM');
  } catch {
    try { child.kill('SIGTERM'); } catch { /* already gone */ }
  }
  setTimeout(() => {
    try {
      if (process.platform === 'win32') child.kill('SIGKILL');
      else process.kill(-child.pid, 'SIGKILL');
    } catch { /* already gone */ }
  }, 1500).unref?.();
}

function collectErrors(stdout, stderr, limit = 20) {
  const lines = (stdout + '\n' + stderr).split(/\r?\n/);
  const picked = [];
  for (let index = 0; index < lines.length && picked.length < limit; index += 1) {
    const line = lines[index].trimEnd();
    if (line === '' || !ERROR_PATTERN.test(line.trim())) continue;
    const next = lines[index + 1]?.trim();
    const detail = next !== undefined && next !== '' && !ERROR_PATTERN.test(next) ? line + '\n  ' + next : line;
    picked.push(detail.slice(0, 900));
  }
  return [...new Set(picked)];
}

async function listArtifacts(root) {
  const libs = path.join(root, 'build/libs');
  if (!(await exists(libs))) return [];
  const files = await walk(libs, { maxDepth: 2, maxFiles: 40 });
  const artifacts = [];
  for (const file of files) {
    if (!/\.(jar|zip)$/.test(file)) continue;
    const stat = await fs.stat(file);
    artifacts.push({ path: relativeTo(root, file), bytes: stat.size });
  }
  return artifacts.sort((a, b) => a.path.localeCompare(b.path)).slice(0, 12);
}

/** Run one Gradle task with bounded capture and a hard timeout. */
export async function runGradle({ cwd, task = 'build', args = [], timeoutMs = 180000, maxOutputChars = 12000 }) {
  assertGradleInvocation(task, args);
  const project = await detectProject(cwd);
  if (!project.found) throw new Error('no Gradle project found from the session working directory');
  const wrapper = commandFor(project.root);
  if (!(await exists(wrapper))) throw new Error('Gradle wrapper not found: ' + wrapper);
  const started = Date.now();
  const child = spawn(wrapper, [task, '--console=plain', '--no-daemon', ...args], {
    cwd: project.root,
    env: { ...process.env, CI: 'true' },
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: process.platform !== 'win32'
  });
  let stdout = '';
  let stderr = '';
  let timedOut = false;
  const timer = setTimeout(() => { timedOut = true; killTree(child); }, timeoutMs);
  timer.unref?.();
  child.stdout?.on('data', (chunk) => { if (stdout.length < 400000) stdout += chunk.toString('utf8'); });
  child.stderr?.on('data', (chunk) => { if (stderr.length < 400000) stderr += chunk.toString('utf8'); });
  const outcome = await new Promise((resolve) => {
    child.on('error', (error) => resolve({ code: -1, signal: undefined, error }));
    child.on('close', (code, signal) => resolve({ code, signal }));
  });
  clearTimeout(timer);
  const durationMs = Date.now() - started;
  const combined = stdout + '\n' + stderr;
  const success = !timedOut && outcome.code === 0 && /BUILD SUCCESSFUL/i.test(combined);
  const bounded = boundText(combined.trim(), Math.min(maxOutputChars, 16000));
  const artifacts = await listArtifacts(project.root);
  return {
    ok: success,
    task,
    project: project.root,
    exitCode: outcome.code,
    timedOut,
    durationMs,
    summary: success ? 'BUILD SUCCESSFUL' : timedOut ? 'timed out' : 'BUILD FAILED',
    errors: collectErrors(stdout, stderr),
    tail: bounded.text,
    truncated: bounded.truncated,
    artifacts
  };
}
