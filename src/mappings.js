import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { detectProject } from './project.js';
import { exists, readTextLimited, relativeTo, resolveInside, walk } from './util.js';

const MAPPING_EXT = /\.(tiny|tsrg2?|mapping|map|txt)$/i;
const MAPPING_NAME = /(mapping|yarn|tsrg|mojang|official|intermediary|named|srg)/i;

async function candidateFiles(project) {
  const roots = [
    path.join(project.root, 'mappings'),
    path.join(project.root, '.gradle'),
    path.join(project.root, 'build'),
    path.join(project.root, 'run'),
    path.join(os.homedir(), '.gradle', 'caches', 'fabric-loom'),
    path.join(os.homedir(), '.gradle', 'caches', 'neoform'),
    path.join(os.homedir(), '.gradle', 'caches', 'modules-2', 'files-2.1', 'net.fabricmc'),
    path.join(os.homedir(), '.gradle', 'caches', 'modules-2', 'files-2.1', 'net.neoforged')
  ];
  const found = [];
  for (const dir of roots) {
    if (!(await exists(dir))) continue;
    const files = await walk(dir, { maxDepth: 7, maxFiles: 3500 });
    for (const file of files) if (MAPPING_EXT.test(file) && MAPPING_NAME.test(file)) found.push(file);
    if (found.length >= 40) break;
  }
  return [...new Set(found)].slice(0, 12);
}

function parseMappings(text, source) {
  const entries = [];
  let owner;
  const lines = String(text).split(/\r?\n/);
  for (const line of lines) {
    if (line === '' || line.startsWith('#')) continue;
    if (line.startsWith('c\t')) {
      const parts = line.split('\t').slice(1);
      if (parts.length >= 2) {
        owner = parts[0];
        entries.push({ kind: 'class', official: parts[0], named: parts[parts.length - 1], owner: parts[0], source });
      }
      continue;
    }
    if (line.startsWith('\tm\t') || line.startsWith('\tf\t')) {
      const kind = line[1] === 'm' ? 'method' : 'field';
      const parts = line.split('\t').slice(2);
      if (parts.length >= 3) {
        const descriptor = parts[0];
        const official = parts[1];
        const named = parts[parts.length - 1];
        entries.push({ kind, official, named, owner, descriptor, source });
      }
      continue;
    }
    const proguardClass = /^(\S+) -> (\S+):$/.exec(line);
    if (proguardClass !== null) {
      owner = proguardClass[1];
      entries.push({ kind: 'class', official: proguardClass[1], named: proguardClass[2].replace(/:$/, ''), owner: proguardClass[1], source });
      continue;
    }
    const proguardMember = /^\s+(.+?)\s+(\S+)\(([^)]*)\)\s+->\s+(\S+)$/.exec(line);
    if (proguardMember !== null && owner !== undefined) {
      entries.push({ kind: 'method', official: proguardMember[2], named: proguardMember[4], owner, descriptor: proguardMember[3], source });
      continue;
    }
    const proguardField = /^\s+(.+?)\s+(\S+)\s+->\s+(\S+)$/.exec(line);
    if (proguardField !== null && owner !== undefined) {
      entries.push({ kind: 'field', official: proguardField[2], named: proguardField[3], owner, source });
      continue;
    }
    if (!line.startsWith('\t')) {
      const tsrgClass = /^(\S+)\s+(\S+)$/.exec(line.trim());
      if (tsrgClass !== null && /[./]/.test(tsrgClass[1]) && !tsrgClass[1].startsWith('tsrg')) {
        owner = tsrgClass[1];
        entries.push({ kind: 'class', official: tsrgClass[1], named: tsrgClass[2], owner: tsrgClass[1], source });
        continue;
      }
    }
    if (line.startsWith('\t')) {
      const parts = line.trim().split(/\s+/);
      if (parts.length >= 2 && owner !== undefined) {
        const named = parts[parts.length - 1];
        const official = parts[parts.length - 2];
        const kind = /^\(/.test(parts[0]) || /\(.*\)/.test(parts.join(' ')) ? 'method' : 'field';
        if (official !== named) entries.push({ kind, official, named, owner, source });
      }
    }
  }
  return entries;
}

function score(entry, query) {
  const q = query.toLowerCase();
  const simple = entry.named.split(/[./]/).pop()?.toLowerCase() ?? '';
  const officialSimple = entry.official.split(/[./]/).pop()?.toLowerCase() ?? '';
  if (simple === q || officialSimple === q) return 100;
  if (simple.startsWith(q) || officialSimple.startsWith(q)) return 70;
  if (entry.named.toLowerCase().includes(q) || entry.official.toLowerCase().includes(q)) return 40;
  if (entry.owner?.toLowerCase().includes(q)) return 10;
  return 0;
}

/** Search local Tiny/TSRG/ProGuard mapping files for class, method, or field names. */
export async function runMappings(args, { cwd } = {}) {
  const query = args.query;
  if (typeof query !== 'string' || query.trim().length < 2) throw new Error('query must be at least 2 characters');
  const project = await detectProject(cwd);
  if (!project.found) throw new Error('no Gradle Minecraft project found from the session working directory');
  let files;
  if (typeof args.file === 'string' && args.file !== '') {
    files = [resolveInside(project.root, args.file)];
  } else {
    files = await candidateFiles(project);
  }
  if (files.length === 0) return { ok: false, query, mappings: [], message: 'No local mapping files found. Run genSources or point file at a Tiny/TSRG/ProGuard mapping file.' };
  const wanted = args.kind ?? 'auto';
  const limit = Math.min(30, Math.max(1, Number.isInteger(args.limit) ? args.limit : 20));
  const results = [];
  const parsed = [];
  for (const file of files) {
    if (!(await exists(file))) continue;
    const stat = await fs.stat(file);
    if (!stat.isFile() || stat.size > 120 * 1024 * 1024) continue;
    const { text } = await readTextLimited(file, 60 * 1024 * 1024);
    const entries = parseMappings(text, file);
    parsed.push({ file, count: entries.length });
    for (const entry of entries) {
      if (wanted !== 'auto' && entry.kind !== wanted) continue;
      const rank = score(entry, query.trim());
      if (rank > 0) results.push({ ...entry, rank, source: relativeTo(project.root, file) });
    }
  }
  results.sort((a, b) => b.rank - a.rank || a.kind.localeCompare(b.kind) || a.named.localeCompare(b.named));
  return {
    ok: true,
    query,
    kind: wanted,
    filesScanned: parsed.length,
    entriesScanned: parsed.reduce((sum, entry) => sum + entry.count, 0),
    mappings: results.slice(0, limit).map(({ rank: _rank, ...entry }) => entry)
  };
}
