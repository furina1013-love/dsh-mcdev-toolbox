import crypto from 'node:crypto';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { detectProject } from './project.js';
import { openJar, readEntry, readEntryText, parseManifest, findJarCandidates, canonicalEntryName, JAR_EXTENSION } from './jar.js';
import { parseClass, classEntryName } from './classfile.js';
import { boundText, exists, oneLine, relativeTo, resolveInside } from './util.js';

const MAX_TEXT_ENTRY_BYTES = 512 * 1024;
const MAX_CLASS_BYTES = 8 * 1024 * 1024;

async function selectJar(cwd, jarArg) {
  const project = await detectProject(cwd);
  if (!project.found) throw new Error('no Gradle project found from the session working directory');
  if (jarArg !== undefined && String(jarArg).trim() !== '') {
    const file = resolveInside(project.root, String(jarArg).trim());
    if (!JAR_EXTENSION.test(file)) throw new Error('path must point to a .jar or .zip file');
    if (!(await exists(file))) throw new Error('archive not found: ' + String(jarArg));
    return { project, file };
  }
  const candidates = await findJarCandidates(project.root);
  if (candidates.length === 0) {
    throw new Error('no jar found; pass path to a project-relative .jar (checked build/libs, build/devlibs, run/mods, libs)');
  }
  if (candidates.length > 1) {
    const names = candidates.slice(0, 10).map((candidate) => relativeTo(project.root, candidate.file));
    throw new Error('multiple jars found; pass path explicitly: ' + names.join(', ') + (candidates.length > 10 ? ', ...' : ''));
  }
  return { project, file: candidates[0].file };
}

function manifestSummary(manifest) {
  const out = {};
  for (const [key, value] of Object.entries(manifest).slice(0, 30)) out[key] = oneLine(value, 300);
  return out;
}

function fabricSummary(data) {
  if (data === null || typeof data !== 'object' || Array.isArray(data)) return data;
  const out = {};
  for (const key of ['id', 'name', 'version', 'environment', 'accessWidener']) {
    if (data[key] !== undefined) out[key] = data[key];
  }
  if (data.entrypoints !== null && typeof data.entrypoints === 'object' && !Array.isArray(data.entrypoints)) {
    out.entrypoints = Object.keys(data.entrypoints).slice(0, 30);
  }
  if (data.mixins !== undefined) out.mixins = data.mixins;
  if (data.depends !== undefined) out.depends = data.depends;
  return out;
}

function tomlSummary(text) {
  const modIds = [];
  for (const match of String(text).matchAll(/^\s*modId\s*=\s*["']([^"']+)["']/gm)) modIds.push(match[1]);
  const bounded = boundText(text, 4000);
  return {
    modIds: [...new Set(modIds)].slice(0, 20),
    text: bounded.text,
    truncated: bounded.truncated
  };
}

async function metadataEntries(index) {
  const metadata = [];
  const jsonEntries = [['fabric.mod.json', 'fabric']];
  for (const [entryName, format] of jsonEntries) {
    if (!index.entries.has(entryName)) continue;
    try {
      const { text } = readEntryText(index, entryName, { maxBytes: 256 * 1024 });
      metadata.push({ path: entryName, format, data: fabricSummary(JSON.parse(text)) });
    } catch (error) {
      metadata.push({ path: entryName, format, error: error instanceof Error ? error.message : String(error) });
    }
  }
  for (const [entryName, format] of [['META-INF/mods.toml', 'forge-toml'], ['META-INF/neoforge.mods.toml', 'neoforge-toml']]) {
    if (!index.entries.has(entryName)) continue;
    try {
      const { text } = readEntryText(index, entryName, { maxBytes: 256 * 1024 });
      metadata.push({ path: entryName, format, ...tomlSummary(text) });
    } catch (error) {
      metadata.push({ path: entryName, format, error: error instanceof Error ? error.message : String(error) });
    }
  }
  if (index.entries.has('pack.mcmeta')) {
    try {
      const { text } = readEntryText(index, 'pack.mcmeta', { maxBytes: 256 * 1024 });
      metadata.push({ path: 'pack.mcmeta', format: 'json', data: JSON.parse(text) });
    } catch (error) {
      metadata.push({ path: 'pack.mcmeta', format: 'json', error: error instanceof Error ? error.message : String(error) });
    }
  }
  return metadata;
}

/** Summarize archive metadata without extracting it. */
export async function inspectJar({ cwd, jar } = {}) {
  const selected = await selectJar(cwd, jar);
  const index = await openJar(selected.file);
  const entries = [...index.entries.values()];
  const classes = entries.filter((entry) => !entry.directory && entry.path.endsWith('.class'));
  const resources = entries.filter((entry) => !entry.directory && !entry.path.endsWith('.class'));
  const packageCounts = new Map();
  for (const entry of classes) {
    if (entry.unsafe) continue;
    const dir = entry.path.split('/').slice(0, -1).join('/');
    const name = dir === '' ? '(default)' : dir;
    packageCounts.set(name, (packageCounts.get(name) ?? 0) + 1);
  }
  const packages = [...packageCounts.entries()]
    .map(([name, count]) => ({ name, classes: count }))
    .sort((a, b) => b.classes - a.classes || a.name.localeCompare(b.name))
    .slice(0, 20);
  let manifest = {};
  try {
    manifest = manifestSummary(parseManifest(readEntryText(index, 'META-INF/MANIFEST.MF', { maxBytes: 256 * 1024 }).text));
  } catch { /* unsigned or malformed manifest */ }
  return {
    ok: true,
    jar: relativeTo(selected.project.root, selected.file),
    bytes: index.bytes,
    sha256: crypto.createHash('sha256').update(index.buffer).digest('hex'),
    totalEntries: index.totalEntries,
    uniqueEntries: index.entries.size,
    classes: classes.length,
    resources: resources.length,
    packages,
    classSamples: classes.slice(0, 15).map((entry) => entry.path),
    nestedJars: entries.filter((entry) => !entry.directory && /\.jar$/i.test(entry.path)).slice(0, 20).map((entry) => entry.path),
    manifest,
    metadata: await metadataEntries(index),
    duplicateEntries: index.duplicates.length,
    unsafeEntries: index.unsafe.length
  };
}

/** List archive entries, optionally filtered by a directory or file prefix. */
export async function listJar({ cwd, jar, prefix, limit } = {}) {
  const selected = await selectJar(cwd, jar);
  const index = await openJar(selected.file);
  const max = Math.min(1000, Math.max(1, Number(limit) || 200));
  let prefixPath = '';
  if (prefix !== undefined && String(prefix).trim() !== '') prefixPath = canonicalEntryName(String(prefix).trim());
  const matches = [...index.entries.values()]
    .filter((entry) => prefixPath === '' || entry.path === prefixPath || entry.path.startsWith(prefixPath + '/'))
    .sort((a, b) => a.path.localeCompare(b.path));
  return {
    ok: true,
    jar: relativeTo(selected.project.root, selected.file),
    total: index.entries.size,
    matched: matches.length,
    limit: max,
    truncated: matches.length > max,
    entries: matches.slice(0, max).map((entry) => ({
      path: entry.path,
      directory: entry.directory,
      bytes: entry.uncompressedSize,
      compressedBytes: entry.compressedSize,
      method: entry.method === 0 ? 'stored' : entry.method === 8 ? 'deflated' : 'method-' + entry.method,
      ...(entry.unsafe ? { unsafe: true } : {})
    }))
  };
}

/** Read one UTF-8 entry, rejecting binary content. */
export async function readJarEntry({ cwd, jar, entry, maxOutputChars } = {}) {
  if (entry === undefined || String(entry).trim() === '') throw new Error('entry is required for action=read');
  const selected = await selectJar(cwd, jar);
  const index = await openJar(selected.file);
  const read = readEntryText(index, String(entry).trim(), { maxBytes: MAX_TEXT_ENTRY_BYTES });
  const limit = Math.min(16000, Math.max(2000, Number(maxOutputChars) || 12000));
  const bounded = boundText(read.text, limit);
  return {
    ok: true,
    jar: relativeTo(selected.project.root, selected.file),
    entry: read.entry.path,
    bytes: read.bytes,
    text: bounded.text,
    truncated: bounded.truncated,
    omitted: bounded.omitted
  };
}

/** Parse a class entry without a JDK. */
export async function classInfo({ cwd, jar, className } = {}) {
  if (className === undefined || String(className).trim() === '') throw new Error('class is required for action=class');
  const selected = await selectJar(cwd, jar);
  const index = await openJar(selected.file);
  const entryName = classEntryName(className);
  const read = readEntry(index, entryName, { maxBytes: MAX_CLASS_BYTES });
  return {
    ok: true,
    jar: relativeTo(selected.project.root, selected.file),
    entry: read.entry.path,
    ...parseClass(read.data)
  };
}

async function javapCommand() {
  const executable = process.platform === 'win32' ? 'javap.exe' : 'javap';
  if (process.env.JAVA_HOME) {
    const candidate = path.join(process.env.JAVA_HOME, 'bin', executable);
    if (await exists(candidate)) return candidate;
  }
  return executable;
}

function runCommand(command, args, options) {
  const timeoutMs = options.timeoutMs ?? 20000;
  return new Promise((resolve) => {
    let child;
    try { child = spawn(command, args, { cwd: options.cwd, stdio: ['ignore', 'pipe', 'pipe'] }); }
    catch (error) { resolve({ code: -1, signal: undefined, timedOut: false, stdout: '', stderr: '', error }); return; }
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    let spawnError;
    const timer = setTimeout(() => {
      timedOut = true;
      try { child.kill('SIGKILL'); } catch { /* already gone */ }
    }, timeoutMs);
    timer.unref?.();
    child.stdout?.on('data', (chunk) => { if (stdout.length < 400000) stdout += chunk.toString('utf8'); });
    child.stderr?.on('data', (chunk) => { if (stderr.length < 400000) stderr += chunk.toString('utf8'); });
    child.on('error', (error) => { spawnError = error; });
    child.on('close', (code, signal) => {
      clearTimeout(timer);
      resolve({ code, signal, timedOut, stdout, stderr, error: spawnError });
    });
  });
}

/** Run javap on one class when a JDK is available. */
export async function disassembleJar({ cwd, jar, className, maxOutputChars } = {}) {
  if (className === undefined || String(className).trim() === '') throw new Error('class is required for action=disassemble');
  const selected = await selectJar(cwd, jar);
  const index = await openJar(selected.file);
  const entryName = classEntryName(className);
  if (!index.entries.has(entryName)) throw new Error('class not found in archive: ' + className);
  const dottedName = entryName.slice(0, -'.class'.length).replace(/\//g, '.');
  const command = await javapCommand();
  const outcome = await runCommand(command, ['-p', '-c', '-classpath', selected.file, dottedName], { cwd: selected.project.root, timeoutMs: 20000 });
  if (outcome.error?.code === 'ENOENT') {
    throw new Error('javap not found; install a JDK and put javap on PATH or set JAVA_HOME (action=class uses the built-in parser instead)');
  }
  const combined = (outcome.stdout + '\n' + outcome.stderr).trim();
  const bounded = boundText(combined, Math.min(16000, Math.max(2000, Number(maxOutputChars) || 12000)));
  return {
    ok: !outcome.timedOut && outcome.code === 0,
    jar: relativeTo(selected.project.root, selected.file),
    class: dottedName,
    tool: 'javap',
    exitCode: outcome.code,
    timedOut: outcome.timedOut,
    output: bounded.text,
    truncated: bounded.truncated,
    ...(outcome.error && outcome.error.code !== 'ENOENT' ? { error: outcome.error.message } : {})
  };
}
