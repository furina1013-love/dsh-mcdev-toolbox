import fs from 'node:fs/promises';
import path from 'node:path';
import { detectProject } from './project.js';
import { exists, readTextLimited, relativeTo, resolveInside, walk } from './util.js';

const SIGNATURES = [
  { kind: 'mixin', pattern: /Mixin apply failed|InvalidMixinException|MixinTransformerError|Mixin apply for mod/i, suggestion: 'Read the mixin config/class named in the excerpt; verify the target class and method descriptor against mappings for this exact Minecraft version.' },
  { kind: 'dependency', pattern: /ModResolutionException|Missing or unsupported mandatory dependencies|Mod file .* is missing|requires .* which is missing/i, suggestion: 'Check fabric.mod.json depends / mods.toml dependencies and the matching loader/Minecraft version.' },
  { kind: 'duplicate-mod', pattern: /Duplicate mods|duplicate mod|already registered/i, suggestion: 'Remove the duplicate jar from run/mods or the mods folder; keep one version.' },
  { kind: 'registry', pattern: /Registry remapping failed|RegistryObject.*not present|Unknown registry|Failed to create registry entry/i, suggestion: 'Check registry ids, registration order, and whether the block/item class is loaded on both sides.' },
  { kind: 'class-version', pattern: /UnsupportedClassVersionError|class file version/i, suggestion: 'Compile with the Java version required by this Minecraft version and run the matching JDK.' },
  { kind: 'missing-class', pattern: /NoClassDefFoundError|ClassNotFoundException/i, suggestion: 'Check the dependency scope and whether the class exists in the mapped Minecraft jar or a declared mod dependency.' },
  { kind: 'missing-member', pattern: /NoSuchMethodError|NoSuchFieldError/i, suggestion: 'A mapping or mod version mismatch: compare the called member with the current mappings and dependency versions.' },
  { kind: 'crash', pattern: /Description: |Caused by: |java\.lang\.[A-Za-z]+Exception|java\.lang\.[A-Za-z]+Error/i, suggestion: 'Read the first Caused by chain; fix the deepest cause before the wrapper exception.' }
];

async function latestFile(files) {
  let best;
  for (const file of files) {
    try {
      const stat = await fs.stat(file);
      if (stat.isFile() && (best === undefined || stat.mtimeMs > best.mtimeMs)) best = { file, mtimeMs: stat.mtimeMs };
    } catch { /* skip */ }
  }
  return best?.file;
}

export async function findLog(cwd, requested) {
  const project = await detectProject(cwd);
  const root = project.found ? project.root : cwd;
  if (typeof requested === 'string' && requested !== '') {
    return { root, file: resolveInside(root, requested) };
  }
  const direct = [
    path.join(root, 'run/logs/latest.log'),
    path.join(root, 'logs/latest.log'),
    path.join(root, 'run/logs/debug.log'),
    path.join(root, 'logs/debug.log')
  ];
  const file = await latestFile(direct);
  if (file !== undefined) return { root, file };
  const crashDirs = [path.join(root, 'run/crash-reports'), path.join(root, 'crash-reports')];
  const crashes = [];
  for (const dir of crashDirs) {
    if (!(await exists(dir))) continue;
    for (const entry of await walk(dir, { maxDepth: 2, maxFiles: 100 })) if (entry.endsWith('.txt')) crashes.push(entry);
  }
  const crash = await latestFile(crashes);
  if (crash !== undefined) return { root, file: crash };
  throw new Error('No log or crash report found. Looked for run/logs/latest.log, logs/latest.log, and crash-reports/*.txt.');
}

function excerptAround(lines, index, radius = 2) {
  const start = Math.max(0, index - radius);
  const end = Math.min(lines.length, index + radius + 1);
  return lines.slice(start, end).map((line) => line.trim()).filter(Boolean).join('\n').slice(0, 700);
}

/** Turn a launcher log or crash report into a short, actionable diagnosis. */
export async function analyzeLog(args, { cwd } = {}) {
  const { root, file } = await findLog(cwd, args.path);
  const { text, bytes, truncated } = await readTextLimited(file, 1_500_000);
  const lines = text.split(/\r?\n/);
  const findings = [];
  const seen = new Set();
  for (let index = 0; index < lines.length && findings.length < 20; index += 1) {
    const line = lines[index];
    for (const signature of SIGNATURES) {
      if (!signature.pattern.test(line)) continue;
      const excerpt = excerptAround(lines, index);
      const key = signature.kind + '|' + excerpt.slice(0, 180);
      if (seen.has(key)) continue;
      seen.add(key);
      findings.push({ kind: signature.kind, line: index + 1, excerpt, suggestion: signature.suggestion });
      break;
    }
  }
  const description = lines.find((line) => line.startsWith('Description: '))?.slice('Description: '.length).trim();
  const causedBy = [...new Set(lines.filter((line) => line.trim().startsWith('Caused by:')).map((line) => line.trim()).slice(0, 8))];
  const counts = findings.reduce((acc, item) => { acc[item.kind] = (acc[item.kind] ?? 0) + 1; return acc; }, {});
  return {
    ok: findings.length > 0,
    file: relativeTo(root, file),
    bytes,
    truncated,
    description,
    causedBy,
    counts,
    findings,
    note: findings.length === 0 ? 'No known failure signature matched. Read the last 80 log lines manually.' : undefined
  };
}
