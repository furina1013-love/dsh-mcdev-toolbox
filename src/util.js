import fs from 'node:fs/promises';
import path from 'node:path';

/** Bound text by characters, preserving the beginning and the end. */
export function boundText(text, limit = 12000) {
  const value = String(text ?? '');
  if (value.length <= limit) return { text: value, truncated: false, omitted: 0 };
  const head = Math.floor(limit * 0.68);
  const tail = Math.max(0, limit - head - 24);
  const omitted = value.length - head - tail;
  return {
    text: value.slice(0, head) + '\n… [' + omitted + ' chars omitted] …\n' + value.slice(value.length - tail),
    truncated: true,
    omitted
  };
}

/** Read a UTF-8 text file without loading more than maxBytes. */
export async function readTextLimited(file, maxBytes = 1500000) {
  const stat = await fs.stat(file);
  if (!stat.isFile()) throw new Error('not a file: ' + file);
  const handle = await fs.open(file, 'r');
  try {
    const length = Math.min(stat.size, maxBytes);
    const buffer = Buffer.alloc(length);
    await handle.read(buffer, 0, length, 0);
    return { text: buffer.toString('utf8'), bytes: stat.size, truncated: stat.size > maxBytes };
  } finally {
    await handle.close();
  }
}

/** Read the tail of a UTF-8 file without loading more than maxBytes. */
export async function readTailLimited(file, maxBytes = 1500000) {
  const stat = await fs.stat(file);
  if (!stat.isFile()) throw new Error('not a file: ' + file);
  const length = Math.min(stat.size, maxBytes);
  const start = Math.max(0, stat.size - length);
  const handle = await fs.open(file, 'r');
  try {
    const buffer = Buffer.alloc(length);
    await handle.read(buffer, 0, length, start);
    return { text: buffer.toString('utf8'), bytes: stat.size, truncated: stat.size > maxBytes };
  } finally {
    await handle.close();
  }
}

export async function readJson(file) {
  const { text } = await readTextLimited(file, 4000000);
  return JSON.parse(text.replace(/^\uFEFF/, ''));
}

export async function exists(file) {
  try { await fs.access(file); return true; } catch { return false; }
}

export async function statKind(file) {
  try {
    const s = await fs.stat(file);
    return s.isDirectory() ? 'dir' : s.isFile() ? 'file' : 'other';
  } catch { return undefined; }
}

/** Resolve a user path under a root; reject absolute and escaping paths. */
export function resolveInside(root, relative) {
  if (typeof relative !== 'string' || relative.trim() === '') throw new Error('path must be a non-empty relative path');
  const normalized = path.normalize(relative);
  if (path.isAbsolute(normalized)) throw new Error('path must be relative to the project root');
  const target = path.resolve(root, normalized);
  const rel = path.relative(root, target);
  if (rel.startsWith('..') || path.isAbsolute(rel)) throw new Error('path escapes the project root');
  return target;
}

/** Convert an absolute path to a project-relative slash path when possible. */
export function relativeTo(root, file) {
  const rel = path.relative(root, file);
  return rel === '' ? '.' : rel.split(path.sep).join('/');
}

/** Walk a directory tree without following symlinks, with hard bounds. */
export async function walk(root, { maxDepth = 6, maxFiles = 4000, skip = [] } = {}) {
  const result = [];
  const queue = [{ dir: root, depth: 0 }];
  const ignored = new Set(skip);
  while (queue.length > 0 && result.length < maxFiles) {
    const { dir, depth } = queue.shift();
    let entries;
    try { entries = await fs.readdir(dir, { withFileTypes: true }); } catch { continue; }
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      if (ignored.has(entry.name)) continue;
      const file = path.join(dir, entry.name);
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) {
        if (depth < maxDepth && entry.name !== '.git' && entry.name !== 'node_modules' && entry.name !== 'build' && entry.name !== '.gradle') {
          queue.push({ dir: file, depth: depth + 1 });
        }
      } else if (entry.isFile()) {
        result.push(file);
        if (result.length >= maxFiles) break;
      }
    }
  }
  return result;
}

export function oneLine(value, max = 500) {
  const text = String(value ?? '').replace(/\s+/g, ' ').trim();
  return text.length <= max ? text : text.slice(0, max - 1) + '…';
}

export function parseKeyValueProperties(text) {
  const map = new Map();
  for (const raw of String(text).split(/\r?\n/)) {
    const line = raw.trim();
    if (line === '' || line.startsWith('#') || line.startsWith('!')) continue;
    const match = /^([^=:\s]+)\s*[=:]\s*(.*)$/.exec(line);
    if (match) map.set(match[1], match[2].trim().replace(/^['"]|['"]$/g, ''));
  }
  return map;
}

export function unique(values) {
  return [...new Set(values)];
}
