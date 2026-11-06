import fs from 'node:fs/promises';
import path from 'node:path';
import { detectProject } from './project.js';
import { exists, readJson, relativeTo, resolveInside, walk } from './util.js';

const ID_PATTERN = /^[a-z0-9_.-]+:[a-z0-9_./-]+$/;
const TAG_PATTERN = /^[a-z0-9_.-]+:[a-z0-9_./-]+$/;
const NAME_PATTERN = /^[a-z0-9_./-]+$/;
const RECIPE_TYPES = new Set(['crafting_shaped', 'crafting_shapeless', 'smelting', 'blasting', 'smoking', 'campfire_cooking', 'stonecutting', 'smithing_transform', 'smithing_trim']);
const COOKING = new Set(['smelting', 'blasting', 'smoking', 'campfire_cooking']);

function clean(value, label) {
  if (typeof value !== 'string' || !NAME_PATTERN.test(value) || value.includes('..')) throw new Error(label + ' must match [a-z0-9_./-] and must not contain ..');
  return value.replace(/^\/+|\/+$/g, '');
}

function id(value, label) {
  if (typeof value !== 'string' || !ID_PATTERN.test(value)) throw new Error(label + ' must be a namespaced id such as modid:item');
  return value;
}

function ingredient(value, label) {
  if (typeof value === 'string') {
    if (value.startsWith('#')) {
      const tag = value.slice(1);
      if (!TAG_PATTERN.test(tag)) throw new Error(label + ' must be a valid tag id');
      return { tag };
    }
    return { item: id(value, label) };
  }
  if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
    const copy = {};
    if (typeof value.item === 'string') copy.item = id(value.item, label + '.item');
    else if (typeof value.tag === 'string') copy.tag = value.tag.replace(/^#/, '');
    else throw new Error(label + ' needs item or tag');
    if (!TAG_PATTERN.test(copy.item ?? copy.tag)) throw new Error(label + ' must be a namespaced id');
    return copy;
  }
  throw new Error(label + ' must be an item id, #tag, or {item|tag}');
}

function result(value, count, legacy) {
  if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
    const name = value.id ?? value.item;
    const amount = value.count ?? count ?? 1;
    if (!Number.isInteger(amount) || amount < 1 || amount > 99) throw new Error('result count must be 1..99');
    const key = legacy ? 'item' : 'id';
    return { [key]: id(name, 'result'), count: amount };
  }
  const amount = count ?? 1;
  if (!Number.isInteger(amount) || amount < 1 || amount > 99) throw new Error('result count must be 1..99');
  return { [legacy ? 'item' : 'id']: id(value, 'result'), count: amount };
}

async function context(cwd) {
  const project = await detectProject(cwd);
  if (!project.found) throw new Error('no Gradle Minecraft project found from the session working directory');
  return project;
}

function modern(project) {
  const match = /^1\.(\d+)/.exec(project.minecraftVersion ?? '');
  return match !== null && Number(match[1]) >= 21;
}

function dataPath(project, kind) {
  const base = path.join(project.root, 'src/main/resources/data');
  if (kind === 'recipe') return path.join(base, project.modId ?? 'minecraft', modern(project) ? 'recipe' : 'recipes');
  if (kind === 'loot') return path.join(base, project.modId ?? 'minecraft', modern(project) ? 'loot_table/blocks' : 'loot_tables/blocks');
  return base;
}

async function writeJson(file, value, overwrite) {
  if (!overwrite && (await exists(file))) return { path: file, status: 'exists' };
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, JSON.stringify(value, null, 2) + '\n', 'utf8');
  return { path: file, status: 'written' };
}

function validateIngredient(value, label, errors) {
  if (typeof value === 'string') {
    if (value.startsWith('#')) { if (!TAG_PATTERN.test(value.slice(1))) errors.push(label + ': invalid tag ' + value); }
    else if (!ID_PATTERN.test(value)) errors.push(label + ': invalid item id ' + value);
    return;
  }
  if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
    const name = value.item ?? value.tag;
    if (typeof name !== 'string' || !ID_PATTERN.test(name)) errors.push(label + ': needs a valid item or tag');
    return;
  }
  errors.push(label + ': must be an item id, #tag, or {item|tag}');
}

export async function runData(args, { cwd } = {}) {
  const project = await context(cwd);
  const action = args.action ?? 'validate';
  const ns = project.modId;
  if (typeof ns !== 'string') throw new Error('project mod id is unknown');
  const overwrite = Boolean(args.overwrite);
  if (action === 'validate') {
    const errors = [];
    const warnings = [];
    const dataRoot = path.join(project.root, 'src/main/resources/data');
    if (!(await exists(dataRoot))) return { ok: false, action, errors: ['data directory not found'], warnings };
    const files = await walk(dataRoot, { maxDepth: 8, maxFiles: 10000 });
    const recipeFiles = files.filter((file) => /\/(recipe|recipes)\//.test(file) && file.endsWith('.json'));
    for (const file of recipeFiles) {
      const rel = relativeTo(project.root, file);
      let json;
      try { json = await readJson(file); } catch { errors.push(rel + ': invalid JSON'); continue; }
      if (json === null || typeof json !== 'object' || Array.isArray(json)) { errors.push(rel + ': recipe must be an object'); continue; }
      const type = String(json.type ?? '').replace(/^minecraft:/, '');
      if (!RECIPE_TYPES.has(type)) { errors.push(rel + ': unknown recipe type ' + String(json.type)); continue; }
      if (type === 'crafting_shaped') {
        if (!Array.isArray(json.pattern) || json.pattern.length === 0 || json.pattern.length > 3 || json.pattern.some((row) => typeof row !== 'string' || row.length === 0 || row.length > 3)) errors.push(rel + ': pattern must be 1-3 rows of 1-3 characters');
        if (json.key === null || typeof json.key !== 'object' || Array.isArray(json.key)) errors.push(rel + ': key must be an object');
        else for (const [char, value] of Object.entries(json.key)) { if (char.length !== 1) errors.push(rel + ': key must be one character'); validateIngredient(value, rel + ' key ' + char, errors); }
      } else if (type === 'crafting_shapeless') {
        if (!Array.isArray(json.ingredients) || json.ingredients.length === 0) errors.push(rel + ': ingredients must be a non-empty array');
        else json.ingredients.forEach((value, index) => validateIngredient(value, rel + ' ingredient ' + index, errors));
      } else if (COOKING.has(type)) {
        validateIngredient(json.ingredient, rel + ' ingredient', errors);
      } else if (type === 'stonecutting') {
        validateIngredient(json.ingredient, rel + ' ingredient', errors);
      } else if (type === 'smithing_transform' || type === 'smithing_trim') {
        for (const key of ['template', 'base', 'addition']) validateIngredient(json[key], rel + ' ' + key, errors);
      }
      if (type !== 'smithing_trim') {
        const value = json.result?.id ?? json.result?.item;
        if (typeof value !== 'string' || !ID_PATTERN.test(value)) errors.push(rel + ': result id is missing or invalid');
      }
    }
    const tagFiles = files.filter((file) => /\/tags\//.test(file) && file.endsWith('.json'));
    for (const file of tagFiles) {
      const rel = relativeTo(project.root, file);
      let json;
      try { json = await readJson(file); } catch { errors.push(rel + ': invalid JSON'); continue; }
      if (!Array.isArray(json?.values)) errors.push(rel + ': values must be an array');
      else for (const [index, value] of json.values.entries()) {
        const name = typeof value === 'string' ? value : value?.id;
        if (typeof name !== 'string' || !(name.startsWith('#') ? TAG_PATTERN.test(name.slice(1)) : ID_PATTERN.test(name))) errors.push(rel + ': values[' + index + '] is not a valid id');
      }
    }
    return { ok: errors.length === 0, action, recipes: recipeFiles.length, tags: tagFiles.length, errors: errors.slice(0, 50), warnings };
  }

  if (action === 'tag') {
    const tagId = args.tag;
    if (typeof tagId !== 'string' || !TAG_PATTERN.test(tagId)) throw new Error('tag must be a namespaced id such as minecraft:planks');
    const [tagNs, ...tagPathParts] = tagId.split(':');
    const tagPath = tagPathParts.join(':');
    const kind = args.kind ?? 'item';
    if (!['item', 'block', 'entity_type', 'fluid', 'game_event', 'function'].includes(kind)) throw new Error('unsupported tag kind');
    if (!Array.isArray(args.values) || args.values.length === 0) throw new Error('values must be a non-empty array');
    const values = args.values.map((entry, index) => {
      if (typeof entry === 'string') {
        if (entry.startsWith('#')) return { id: entry, required: false };
        return id(entry, 'values[' + index + ']');
      }
      if (entry !== null && typeof entry === 'object' && typeof entry.id === 'string') return { id: entry.id, ...(entry.required === false ? { required: false } : {}) };
      throw new Error('values[' + index + '] must be an id or {id, required}');
    });
    const file = resolveInside(path.join(project.root, 'src/main/resources/data', tagNs, 'tags', kind), tagPath + '.json');
    return { ok: true, action, ...(await writeJson(file, { replace: Boolean(args.replace), values }, overwrite)) };
  }

  if (action === 'loot') {
    const name = clean(args.name, 'name');
    const item = args.item ?? ns + ':' + name;
    const file = path.join(dataPath(project, 'loot'), name + '.json');
    const table = {
      type: 'minecraft:block',
      pools: [{ rolls: 1, entries: [{ type: 'minecraft:item', name: id(item, 'item') }], conditions: [{ condition: 'minecraft:survives_explosion' }] }]
    };
    return { ok: true, action, ...(await writeJson(file, table, overwrite)) };
  }

  if (action !== 'recipe') throw new Error('action must be recipe, tag, loot, or validate');
  const name = clean(args.name, 'name');
  const type = String(args.type ?? '').replace(/^minecraft:/, '');
  if (!RECIPE_TYPES.has(type)) throw new Error('unsupported recipe type: ' + String(args.type));
  const legacy = !modern(project);
  const recipe = { type: 'minecraft:' + type };
  if (typeof args.group === 'string' && args.group !== '') recipe.group = args.group;
  if (typeof args.category === 'string' && args.category !== '') recipe.category = args.category;
  if (type === 'crafting_shaped') {
    if (!Array.isArray(args.pattern) || args.pattern.length === 0 || args.pattern.length > 3) throw new Error('pattern must have 1-3 rows');
    if (args.key === null || typeof args.key !== 'object' || Array.isArray(args.key)) throw new Error('key must be an object of character to ingredient');
    recipe.pattern = args.pattern;
    recipe.key = Object.fromEntries(Object.entries(args.key).map(([char, value]) => [char, ingredient(value, 'key.' + char)]));
    recipe.result = result(args.result, args.count, legacy);
  } else if (type === 'crafting_shapeless') {
    if (!Array.isArray(args.ingredients) || args.ingredients.length === 0) throw new Error('ingredients must be a non-empty array');
    recipe.ingredients = args.ingredients.map((value, index) => ingredient(value, 'ingredients[' + index + ']'));
    recipe.result = result(args.result, args.count, legacy);
  } else if (COOKING.has(type)) {
    recipe.ingredient = ingredient(args.ingredient, 'ingredient');
    recipe.result = result(args.result, args.count, legacy);
    recipe.experience = typeof args.experience === 'number' ? args.experience : 0.1;
    recipe.cookingtime = Number.isInteger(args.cookingTime) ? args.cookingTime : 200;
  } else if (type === 'stonecutting') {
    recipe.ingredient = ingredient(args.ingredient, 'ingredient');
    recipe.result = result(args.result, args.count, legacy);
  } else if (type === 'smithing_transform') {
    recipe.template = ingredient(args.template, 'template');
    recipe.base = ingredient(args.base, 'base');
    recipe.addition = ingredient(args.addition, 'addition');
    recipe.result = result(args.result, args.count, legacy);
  } else {
    recipe.template = ingredient(args.template, 'template');
    recipe.base = ingredient(args.base, 'base');
    recipe.addition = ingredient(args.addition, 'addition');
  }
  const file = path.join(dataPath(project, 'recipe'), name + '.json');
  return { ok: true, action, ...(await writeJson(file, recipe, overwrite)), recipe };
}
