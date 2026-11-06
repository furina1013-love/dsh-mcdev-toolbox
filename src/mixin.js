import fs from 'node:fs/promises';
import path from 'node:path';
import { detectProject } from './project.js';
import { exists, readJson, readTextLimited, relativeTo, walk } from './util.js';

async function context(cwd) {
  const project = await detectProject(cwd);
  if (!project.found) throw new Error('no Gradle Minecraft project found from the session working directory');
  return project;
}

async function configs(project) {
  const resources = path.join(project.root, 'src/main/resources');
  const result = [];
  for (const name of [...new Set(project.mixinConfigs)]) {
    const file = path.join(resources, name);
    if (!(await exists(file))) { result.push({ name, missing: true }); continue; }
    let json;
    try { json = await readJson(file); } catch (error) { result.push({ name, invalid: error instanceof Error ? error.message : String(error) }); continue; }
    result.push({ name, file, json });
  }
  return result;
}

async function javaSources(project) {
  const root = path.join(project.root, 'src/main/java');
  if (!(await exists(root))) return [];
  return (await walk(root, { maxDepth: 12, maxFiles: 20000 })).filter((file) => file.endsWith('.java'));
}

function packagePath(packageName, className) {
  return [...String(packageName).split('.'), ...String(className).split('.')].filter(Boolean).join('/') + '.java';
}

/** Validate mixin configs and list @Mixin targets without launching the game. */
export async function runMixin(args, { cwd } = {}) {
  const project = await context(cwd);
  const action = args.action ?? 'validate';
  const configEntries = await configs(project);
  if (action === 'list') {
    return {
      ok: true,
      action,
      configs: configEntries.map((entry) => entry.invalid !== undefined
        ? { name: entry.name, invalid: entry.invalid }
        : { name: entry.name, missing: entry.missing === true, package: entry.json?.package, compatibilityLevel: entry.json?.compatibilityLevel, refmap: entry.json?.refmap, mixins: entry.json?.mixins?.length ?? 0, client: entry.json?.client?.length ?? 0, server: entry.json?.server?.length ?? 0 })
    };
  }
  if (action === 'targets') {
    const sources = await javaSources(project);
    const targets = [];
    for (const file of sources) {
      const text = (await readTextLimited(file, 800000)).text;
      const annotations = [...text.matchAll(/@Mixin\s*\(([^)]*)\)/g)];
      for (const annotation of annotations) {
        const classes = [...annotation[1].matchAll(/(?:targets\s*=\s*)?(?:\{\s*)?"([^"]+)"/g)].map((match) => match[1]);
        const literals = [...annotation[1].matchAll(/([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*)\.class/g)].map((match) => match[1]);
        targets.push({ file: relativeTo(project.root, file), targets: [...classes, ...literals] });
      }
    }
    return { ok: true, action, targets: targets.slice(0, 100), count: targets.length };
  }
  if (action !== 'validate') throw new Error('action must be validate, list, or targets');
  const errors = [];
  const warnings = [];
  const resources = path.join(project.root, 'src/main/resources');
  const javaRoot = path.join(project.root, 'src/main/java');
  for (const entry of configEntries) {
    if (entry.missing) { errors.push('mixin config not found: ' + entry.name); continue; }
    if (entry.invalid !== undefined) { errors.push(entry.name + ': invalid JSON: ' + entry.invalid); continue; }
    const json = entry.json;
    if (typeof json.package !== 'string' || !/^[A-Za-z_$][\w$]*(\.[A-Za-z_$][\w$]*)*$/.test(json.package)) errors.push(entry.name + ': package is invalid');
    if (json.refmap !== undefined && (typeof json.refmap !== 'string' || !(await exists(path.join(resources, json.refmap))))) warnings.push(entry.name + ': refmap file not found: ' + String(json.refmap));
    for (const key of ['mixins', 'client', 'server']) {
      const values = json[key];
      if (values === undefined) continue;
      if (!Array.isArray(values)) { errors.push(entry.name + ': ' + key + ' must be an array'); continue; }
      for (const className of values) {
        if (typeof className !== 'string') { errors.push(entry.name + ': ' + key + ' entries must be strings'); continue; }
        const rel = packagePath(json.package, className);
        if (!(await exists(path.join(javaRoot, rel)))) warnings.push(entry.name + ': mixin source not found: ' + rel);
      }
    }
  }
  const sources = await javaSources(project);
  const targetRows = [];
  for (const file of sources) {
    const text = (await readTextLimited(file, 800000)).text;
    if (!text.includes('@Mixin')) continue;
    const match = /@Mixin\s*\(([^)]*)\)/.exec(text);
    if (match === null) continue;
    const targets = [...match[1].matchAll(/"([^"]+)"/g)].map((item) => item[1]);
    if (targets.length === 0) {
      const literals = [...match[1].matchAll(/([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*)\.class/g)].map((item) => item[1]);
      targets.push(...literals);
    }
    targetRows.push({ file: relativeTo(project.root, file), targets });
  }
  return { ok: errors.length === 0, action, configs: configEntries.length, mixinClasses: targetRows.length, errors: errors.slice(0, 40), warnings: [...new Set(warnings)].slice(0, 40), targets: targetRows.slice(0, 40) };
}
