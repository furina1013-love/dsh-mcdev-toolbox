import fs from 'node:fs/promises';
import path from 'node:path';
import { detectProject } from './project.js';
import { exists, readJson, relativeTo, resolveInside, walk } from './util.js';
import { versionProfile } from './version.js';

const NAME_PATTERN = /^[a-z0-9_./-]+$/;
const NAMESPACE_PATTERN = /^[a-z0-9_.-]{2,64}$/;
const LOCALE_PATTERN = /^[a-z][a-z0-9_]{1,20}$/;

function cleanName(value, label = 'name') {
  if (typeof value !== 'string' || !NAME_PATTERN.test(value) || value.includes('..')) {
    throw new Error(label + ' must match [a-z0-9_./-] and must not contain ..');
  }
  return value.replace(/^\/+|\/+$/g, '');
}

function namespaceOf(project, override) {
  const id = override ?? project.modId;
  if (typeof id !== 'string' || !NAMESPACE_PATTERN.test(id)) throw new Error('namespace must match [a-z0-9_.-]{2,64}');
  return id;
}

function humanName(name) {
  return name.split(/[\/._-]+/).filter(Boolean).map((part) => part[0].toUpperCase() + part.slice(1)).join(' ');
}

async function projectContext(cwd) {
  const project = await detectProject(cwd);
  if (!project.found) throw new Error('no Gradle Minecraft project found from the session working directory');
  return project;
}

async function writeJson(file, value, overwrite) {
  if (!overwrite && (await exists(file))) return { path: file, status: 'exists' };
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, JSON.stringify(value, null, 2) + '\n', 'utf8');
  return { path: file, status: 'written' };
}

async function updateLang(file, entries, overwriteLang) {
  let current = {};
  if (await exists(file)) {
    try { current = await readJson(file); } catch { current = {}; }
  }
  let changed = 0;
  for (const [key, value] of Object.entries(entries)) {
    if (overwriteLang || current[key] === undefined) { current[key] = value; changed += 1; }
  }
  if (changed > 0) {
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, JSON.stringify(current, null, 2) + '\n', 'utf8');
  }
  return changed;
}

function itemDefinition(model, ns, name) {
  return { model: { type: 'minecraft:model', model: ns + ':item/' + name } };
}

function blockItemDefinition(model, ns, name) {
  return { model: { type: 'minecraft:model', model: ns + ':block/' + name } };
}

/** Validate models, blockstates and language files; create item/block assets on request. */
export async function runAssets(args, { cwd, maxOutputChars = 12000 } = {}) {
  const project = await projectContext(cwd);
  const ns = namespaceOf(project, args.namespace);
  const resources = path.join(project.root, 'src/main/resources');
  const assetsRoot = path.join(resources, 'assets', ns);
  const dataRoot = path.join(resources, 'assets', ns, 'lang');
  const action = args.action ?? 'validate';

  if (action === 'validate') {
    const errors = [];
    const warnings = [];
    const files = await walk(assetsRoot, { maxDepth: 6, maxFiles: 8000 });
    const jsonFiles = files.filter((file) => file.endsWith('.json'));
    const models = new Map();
    for (const file of jsonFiles) {
      let value;
      try { value = await readJson(file); }
      catch (error) { errors.push(relativeTo(resources, file) + ': invalid JSON'); continue; }
      if (file.includes('/models/')) models.set(relativeTo(assetsRoot, file).replace(/^models\//, '').replace(/\.json$/, ''), { file, value });
    }
    const refExists = (ref, kind) => {
      const [refNs, ...rest] = String(ref).split(':');
      if (refNs === 'minecraft' || refNs === 'forge' || refNs === 'neoforge') return true;
      const rel = rest.join(':');
      if (rel === '') return false;
      return kind === 'model'
        ? exists(path.join(resources, 'assets', refNs, 'models', rel + '.json'))
        : exists(path.join(resources, 'assets', refNs, 'textures', rel + '.png'));
    };
    const requiredSlots = new Map([
      ['minecraft:item/generated', ['layer0']],
      ['minecraft:item/handheld', ['layer0']],
      ['minecraft:item/handheld_rod', ['layer0']],
      ['minecraft:block/cube_all', ['all']],
      ['minecraft:block/cube', ['down', 'up', 'north', 'south', 'east', 'west']],
      ['minecraft:block/cube_bottom_top', ['bottom', 'top', 'side']],
      ['minecraft:block/orientable', ['front', 'side', 'top']],
      ['minecraft:block/cross', ['cross']],
      ['minecraft:block/cube_column', ['side', 'end']],
      ['minecraft:block/button', ['texture']],
      ['minecraft:block/fence_post', ['texture']],
      ['minecraft:block/fence_side', ['texture']],
      ['minecraft:block/wall_post', ['wall']],
      ['minecraft:block/template_wall_post', ['wall']]
    ]);
    for (const [key, { file, value }] of models) {
      const rel = relativeTo(resources, file);
      if (typeof value !== 'object' || value === null || Array.isArray(value)) { errors.push(rel + ': model must be an object'); continue; }
      const parent = value.parent;
      if (parent !== undefined && (typeof parent !== 'string' || parent === '')) errors.push(rel + ': parent must be a non-empty string');
      else if (parent !== undefined && !(await refExists(parent, 'model'))) warnings.push(rel + ': parent model not found locally: ' + parent);
      if (value.textures !== undefined) {
        if (typeof value.textures !== 'object' || value.textures === null || Array.isArray(value.textures)) errors.push(rel + ': textures must be an object');
        else {
          for (const [slot, ref] of Object.entries(value.textures)) {
            if (typeof ref !== 'string' || ref === '') errors.push(rel + ': texture ' + slot + ' must be a non-empty string');
            else if (!(await refExists(ref, 'texture'))) warnings.push(rel + ': texture not found locally: ' + ref);
          }
          if (parent === 'minecraft:item/generated' && value.textures.layer0 === undefined) errors.push(rel + ': item/generated model needs textures.layer0');
        }
      }
      if (typeof parent === 'string') {
        const seen = new Set([key]);
        let cursor = parent.startsWith(ns + ':') ? parent.slice(ns.length + 1) : parent;
        for (let depth = 0; depth < 32; depth += 1) {
          if (cursor.startsWith('minecraft:')) break;
          if (seen.has(cursor)) { errors.push(rel + ': parent cycle: ' + [...seen, cursor].join(' -> ')); break; }
          seen.add(cursor);
          const parentEntry = models.get(cursor);
          if (parentEntry === undefined) break;
          const next = parentEntry.value?.parent;
          if (typeof next !== 'string') break;
          cursor = next.startsWith(ns + ':') ? next.slice(ns.length + 1) : next;
        }
        const slots = requiredSlots.get(parent);
        if (slots !== undefined && value.textures !== undefined && typeof value.textures === 'object' && !Array.isArray(value.textures)) {
          for (const slot of slots) if (value.textures[slot] === undefined) warnings.push(rel + ': parent ' + parent + ' usually needs textures.' + slot);
        }
      }
      if (key.startsWith('block/') && value.parent === undefined && value.textures === undefined) warnings.push(rel + ': block model has no parent and no textures');
    }
    for (const file of jsonFiles.filter((entry) => entry.includes('/blockstates/'))) {
      const rel = relativeTo(resources, file);
      let value;
      try { value = await readJson(file); } catch { continue; }
      if (typeof value !== 'object' || value === null) { errors.push(rel + ': blockstate must be an object'); continue; }
      if (value.variants === undefined && value.multipart === undefined) errors.push(rel + ': needs variants or multipart');
      if (value.variants !== undefined && (typeof value.variants !== 'object' || value.variants === null)) errors.push(rel + ': variants must be an object');
      const refs = [];
      if (value.variants && typeof value.variants === 'object') for (const variant of Object.values(value.variants)) {
        if (variant?.model !== undefined) refs.push(variant.model);
        if (Array.isArray(variant)) for (const item of variant) if (item?.model !== undefined) refs.push(item.model);
      }
      for (const ref of refs) if (typeof ref !== 'string' || !(await refExists(ref, 'model'))) warnings.push(rel + ': model not found locally: ' + String(ref));
    }
    for (const file of jsonFiles.filter((entry) => entry.includes('/lang/'))) {
      const rel = relativeTo(resources, file);
      try { const value = await readJson(file); if (typeof value !== 'object' || value === null || Array.isArray(value)) errors.push(rel + ': lang must be an object'); }
      catch { errors.push(rel + ': invalid JSON'); }
    }
    if (versionProfile(project.minecraftVersion).itemDefinitions) {
      const itemDefinitions = jsonFiles.filter((entry) => entry.includes('/items/'));
      for (const file of itemDefinitions) {
        const rel = relativeTo(resources, file);
        let value;
        try { value = await readJson(file); } catch { continue; }
        if (value === null || typeof value !== 'object' || Array.isArray(value)) { errors.push(rel + ': item definition must be an object'); continue; }
        if (value.model === undefined) warnings.push(rel + ': item definition has no model');
        else if (value.model?.type === 'minecraft:model' && typeof value.model.model === 'string' && !(await refExists(value.model.model, 'model'))) warnings.push(rel + ': model not found locally: ' + value.model.model);
      }
      for (const key of models.keys()) {
        if (!key.startsWith('item/')) continue;
        const definition = resolveInside(assetsRoot, 'items/' + key.slice('item/'.length) + '.json');
        if (!(await exists(definition))) warnings.push('1.21.4+ item model definition missing: assets/' + ns + '/items/' + key.slice('item/'.length) + '.json');
      }
    }
    if (!(await exists(assetsRoot))) warnings.push('assets namespace not found: assets/' + ns);
    return { ok: errors.length === 0, action, namespace: ns, models: models.size, jsonFiles: jsonFiles.length, errors: errors.slice(0, 40), warnings: warnings.slice(0, 40) };
  }

  if (action === 'lang') {
    if (args.entries === undefined || typeof args.entries !== 'object' || Array.isArray(args.entries)) throw new Error('entries must be an object of translation key to text');
    const locale = args.locale ?? 'en_us';
    if (typeof locale !== 'string' || !LOCALE_PATTERN.test(locale)) throw new Error('locale must look like en_us: lowercase letters, digits and underscore, 2-21 characters');
    const file = resolveInside(dataRoot, locale + '.json');
    const entries = {};
    for (const [key, value] of Object.entries(args.entries)) {
      if (typeof key !== 'string' || key.length === 0 || typeof value !== 'string') throw new Error('lang entries must map non-empty keys to strings');
      entries[key] = value;
    }
    const changed = await updateLang(file, entries, Boolean(args.overwrite));
    return { ok: true, action, path: relativeTo(resources, file), changed, total: Object.keys(entries).length };
  }

  if (action !== 'item' && action !== 'block') throw new Error('action must be validate, item, block, or lang');
  const name = cleanName(args.name, 'name');
  const overwrite = Boolean(args.overwrite);
  const withLang = args.lang !== false;
  const langKey = (action === 'item' ? 'item.' : 'block.') + ns + '.' + name.replace(/\//g, '.');
  const files = [];
  if (action === 'item') {
    const texture = typeof args.texture === 'string' && args.texture !== '' ? args.texture : ns + ':item/' + name;
    const modelPath = resolveInside(assetsRoot, 'models/item/' + name + '.json');
    files.push(await writeJson(modelPath, { parent: 'minecraft:item/generated', textures: { layer0: texture } }, overwrite));
    if (versionProfile(project.minecraftVersion).itemDefinitions) {
      files.push(await writeJson(resolveInside(assetsRoot, 'items/' + name + '.json'), itemDefinition(name, ns, name), overwrite));
    }
  } else {
    const texture = typeof args.texture === 'string' && args.texture !== '' ? args.texture : ns + ':block/' + name;
    files.push(await writeJson(resolveInside(assetsRoot, 'models/block/' + name + '.json'), { parent: 'minecraft:block/cube_all', textures: { all: texture } }, overwrite));
    files.push(await writeJson(resolveInside(assetsRoot, 'blockstates/' + name + '.json'), { variants: { '': { model: ns + ':block/' + name } } }, overwrite));
    files.push(await writeJson(resolveInside(assetsRoot, 'models/item/' + name + '.json'), { parent: ns + ':block/' + name }, overwrite));
    if (versionProfile(project.minecraftVersion).itemDefinitions) {
      files.push(await writeJson(resolveInside(assetsRoot, 'items/' + name + '.json'), blockItemDefinition(name, ns, name), overwrite));
    }
  }
  let langChanged;
  if (withLang) langChanged = await updateLang(path.join(dataRoot, 'en_us.json'), { [langKey]: args.displayName ?? humanName(name) }, overwrite);
  const warnings = [];
  if (action === 'item' && !(await exists(path.join(resources, 'assets', ns, 'textures/item', name + '.png')))) warnings.push('texture not found: assets/' + ns + '/textures/item/' + name + '.png');
  if (action === 'block' && !(await exists(path.join(resources, 'assets', ns, 'textures/block', name + '.png')))) warnings.push('texture not found: assets/' + ns + '/textures/block/' + name + '.png');
  return {
    ok: true,
    action,
    namespace: ns,
    files: files.map((entry) => ({ path: relativeTo(resources, entry.path), status: entry.status })),
    lang: { key: langKey, changed: langChanged },
    warnings
  };
}
