import fs from 'node:fs/promises';
import path from 'node:path';
import { exists, parseKeyValueProperties, readJson, readTextLimited, relativeTo, resolveInside, walk } from './util.js';
import { versionProfile } from './version.js';

const BUILD_FILES = ['build.gradle', 'build.gradle.kts'];
const SETTINGS_FILES = ['settings.gradle', 'settings.gradle.kts'];
const PROJECT_MARKERS = [...SETTINGS_FILES, ...BUILD_FILES, 'gradle.properties'];

async function firstExisting(root, names) {
  for (const name of names) {
    const file = path.join(root, name);
    if (await exists(file)) return file;
  }
  return undefined;
}

export async function findProjectRoot(cwd) {
  let current = path.resolve(cwd);
  for (let depth = 0; depth < 8; depth += 1) {
    for (const marker of PROJECT_MARKERS) {
      if (await exists(path.join(current, marker))) return current;
    }
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return undefined;
}

function detectLoader({ buildText, fabricMeta, neoforgeMeta, modsMeta }) {
  const text = buildText.toLowerCase();
  if (fabricMeta !== undefined || text.includes('fabric-loom') || text.includes('net.fabricmc')) return 'fabric';
  if (neoforgeMeta !== undefined || text.includes('net.neoforged') || text.includes('neoform')) return 'neoforge';
  if (modsMeta !== undefined || text.includes('net.minecraftforge')) return 'forge';
  if (text.includes('architectury')) return 'architectury';
  return 'unknown';
}

function firstMatch(text, patterns) {
  for (const pattern of patterns) {
    const match = pattern.exec(text);
    if (match !== null) return match[1].trim();
  }
  return undefined;
}

function inferJavaVersion(minecraftVersion) {
  return versionProfile(minecraftVersion).java === undefined ? undefined : String(versionProfile(minecraftVersion).java);
}

function parseFabricMeta(json) {
  return {
    schemaVersion: json.schemaVersion,
    id: json.id,
    version: json.version,
    name: json.name,
    entrypoints: json.entrypoints ?? {},
    mixins: json.mixins ?? [],
    depends: json.depends ?? {}
  };
}

function parseModsToml(text) {
  const modBlock = /\[\[mods\]\]([\s\S]*?)(?=\n\[\[|\s*$)/.exec(text)?.[1] ?? '';
  const values = {};
  for (const match of modBlock.matchAll(/^\s*(modId|version|displayName|description|authors|license)\s*=\s*"([^"]*)"/gm)) {
    values[match[1]] = match[2];
  }
  return values;
}

async function readOptional(file) {
  if (file === undefined || !(await exists(file))) return undefined;
  return readTextLimited(file, 600000);
}

export async function detectProject(cwd) {
  const root = await findProjectRoot(cwd);
  if (root === undefined) {
    return { found: false, cwd, warnings: ['No Gradle project marker found; run from a Fabric/NeoForge/Forge project directory.'] };
  }
  const buildFile = await firstExisting(root, BUILD_FILES);
  const settingsFile = await firstExisting(root, SETTINGS_FILES);
  const propertiesFile = path.join(root, 'gradle.properties');
  const build = await readOptional(buildFile);
  const properties = await readOptional(propertiesFile);
  const props = parseKeyValueProperties(properties?.text ?? '');
  const buildText = build?.text ?? '';
  const resources = path.join(root, 'src/main/resources');
  const fabricFile = path.join(resources, 'fabric.mod.json');
  const neoforgeFile = path.join(resources, 'META-INF/neoforge.mods.toml');
  const modsFile = path.join(resources, 'META-INF/mods.toml');
  let fabricMeta;
  let fabricRaw;
  if (await exists(fabricFile)) {
    try { fabricRaw = await readJson(fabricFile); fabricMeta = parseFabricMeta(fabricRaw); } catch { fabricMeta = { invalid: true }; }
  }
  const neoforgeText = (await readOptional(neoforgeFile))?.text;
  const modsText = (await readOptional(modsFile))?.text;
  const loader = detectLoader({ buildText, fabricMeta, neoforgeMeta: neoforgeText, modsMeta: modsText });
  const minecraftVersion = props.get('minecraft_version')
    ?? props.get('minecraftVersion')
    ?? props.get('minecraft.version')
    ?? firstMatch(buildText, [
      /com\.mojang:minecraft:([^'"\s)]+)/,
      /minecraft\s+["']com\.mojang:minecraft:([^"']+)["']/,
      /minecraft_version\s*=\s*["']([^"']+)["']/
    ]);
  const mappings = props.get('yarn_mappings')
    ?? props.get('mappings')
    ?? (buildText.includes('officialMojangMappings()') ? 'mojang-official' : undefined)
    ?? firstMatch(buildText, [/net\.fabricmc:yarn:([^'"\s)]+)/, /parchment_mappings\s*=\s*["']([^"']+)["']/]);
  const javaVersion = props.get('java_version')
    ?? props.get('javaVersion')
    ?? firstMatch(buildText, [
      /JavaLanguageVersion\.of\((\d+)\)/,
      /sourceCompatibility\s*=\s*JavaVersion\.VERSION_(\d+)/,
      /targetCompatibility\s*=\s*JavaVersion\.VERSION_(\d+)/
    ])
    ?? inferJavaVersion(minecraftVersion);
  const modsMeta = neoforgeText ?? modsText;
  const tomlMod = modsMeta === undefined ? {} : parseModsToml(modsMeta);
  const modId = fabricMeta?.id ?? tomlMod.modId;
  const sourceRoots = [];
  let javaFiles = 0;
  for (const relative of ['src/main/java', 'src/client/java']) {
    const sourceRoot = path.join(root, relative);
    if (!(await exists(sourceRoot))) continue;
    sourceRoots.push(relative);
    const files = await walk(sourceRoot, { maxDepth: 8, maxFiles: 6000 });
    javaFiles += files.filter((file) => file.endsWith('.java')).length;
  }
  const mixinConfigs = [];
  for (const entry of Array.isArray(fabricMeta?.mixins) ? fabricMeta.mixins : []) {
    const name = typeof entry === 'string' ? entry : entry?.config;
    if (typeof name === 'string') mixinConfigs.push(name);
  }
  if (await exists(resources)) {
    for (const file of await walk(resources, { maxDepth: 4, maxFiles: 2000 })) {
      if (file.endsWith('.mixins.json') || file.endsWith('.mixin.json')) mixinConfigs.push(relativeTo(resources, file));
    }
  }
  const metadataFiles = [];
  for (const file of [fabricFile, neoforgeFile, modsFile]) {
    if (await exists(file)) metadataFiles.push(relativeTo(root, file));
  }
  const profile = versionProfile(minecraftVersion);
  const warnings = [];
  if (loader === 'unknown') warnings.push('Could not identify Fabric/NeoForge/Forge from build files or metadata.');
  if (minecraftVersion === undefined) warnings.push('Could not read the Minecraft version.');
  else if (!profile.known) warnings.push('Unknown Minecraft version profile: ' + minecraftVersion + '; version-specific checks may be approximate.');
  if (modId === undefined) warnings.push('Could not read the mod id.');
  if (loader === 'neoforge' && profile.neoforgeMeta === null) warnings.push('NeoForge is not available for Minecraft 1.20.1; use Forge or a newer Minecraft version.');
  if (loader === 'neoforge' && profile.neoforgeMeta !== undefined && modsMeta !== undefined && neoforgeText === undefined && profile.neoforgeMeta === 'neoforge.mods.toml') warnings.push('NeoForge on this Minecraft version expects META-INF/neoforge.mods.toml, not mods.toml.');
  if (loader === 'neoforge' && neoforgeText !== undefined && profile.neoforgeMeta === 'mods.toml') warnings.push('NeoForge on this Minecraft version expects META-INF/mods.toml, not neoforge.mods.toml.');
  return {
    found: true,
    root,
    loader,
    minecraftVersion,
    mappings,
    javaVersion,
    versionProfile: profile,
    modId,
    buildFile: buildFile === undefined ? undefined : relativeTo(root, buildFile),
    settingsFile: settingsFile === undefined ? undefined : relativeTo(root, settingsFile),
    gradleWrapper: await exists(path.join(root, process.platform === 'win32' ? 'gradlew.bat' : 'gradlew')),
    metadataFiles,
    mixinConfigs: [...new Set(mixinConfigs)],
    sourceRoots,
    javaFiles,
    properties: Object.fromEntries(props),
    warnings
  };
}

function validateFabric(raw, errors, warnings) {
  if (raw === undefined) return;
  if (!Number.isInteger(raw.schemaVersion)) errors.push('fabric.mod.json: schemaVersion must be an integer');
  if (typeof raw.id !== 'string' || !/^[a-z0-9_.-]{2,64}$/.test(raw.id)) errors.push('fabric.mod.json: id must match [a-z0-9_.-]{2,64}');
  if (typeof raw.version !== 'string' || raw.version.length === 0) errors.push('fabric.mod.json: version must be a non-empty string');
  if (raw.entrypoints !== undefined && (raw.entrypoints === null || typeof raw.entrypoints !== 'object' || Array.isArray(raw.entrypoints))) errors.push('fabric.mod.json: entrypoints must be an object');
  if (raw.depends !== undefined && (raw.depends === null || typeof raw.depends !== 'object' || Array.isArray(raw.depends))) errors.push('fabric.mod.json: depends must be an object');
  if (raw.depends?.minecraft === undefined) warnings.push('fabric.mod.json: depends.minecraft is missing');
  if (raw.depends?.fabricloader === undefined) warnings.push('fabric.mod.json: depends.fabricloader is missing');
}

function validateToml(text, errors, warnings) {
  if (text === undefined) return;
  if (!/^\s*modLoader\s*=\s*"javafml"/m.test(text)) errors.push('mods.toml: modLoader="javafml" is required');
  if (!/^\s*loaderVersion\s*=/m.test(text)) warnings.push('mods.toml: loaderVersion is missing');
  if (!/\[\[mods\]\]/.test(text)) errors.push('mods.toml: [[mods]] block is missing');
  if (!/^\s*modId\s*=\s*"/m.test(text)) errors.push('mods.toml: modId is missing');
  if (!/^\s*displayName\s*=\s*"/m.test(text)) warnings.push('mods.toml: displayName is missing');
}

async function validateMixins(root, project, errors, warnings) {
  const resources = path.join(root, 'src/main/resources');
  const configs = [...new Set(project.mixinConfigs)];
  for (const name of configs) {
    let file;
    try { file = resolveInside(resources, name); }
    catch { errors.push('mixin config escapes resources: ' + name); continue; }
    if (!(await exists(file))) {
      errors.push('mixin config not found: ' + name);
      continue;
    }
    let json;
    try { json = await readJson(file); } catch (error) { errors.push(name + ': invalid JSON (' + (error instanceof Error ? error.message : String(error)) + ')'); continue; }
    if (typeof json.package !== 'string' || !/^[a-zA-Z_$][\w$]*(\.[a-zA-Z_$][\w$]*)*$/.test(json.package)) errors.push(name + ': package must be a Java package');
    for (const key of ['mixins', 'client', 'server']) {
      if (json[key] === undefined) continue;
      if (!Array.isArray(json[key])) { errors.push(name + ': ' + key + ' must be an array'); continue; }
      for (const className of json[key]) {
        if (typeof className !== 'string') { errors.push(name + ': ' + key + ' entries must be strings'); continue; }
        const relative = (json.package + '.' + className).split('.').join('/') + '.java';
        let found = false;
        for (const sourceRoot of project.sourceRoots ?? ['src/main/java']) {
          if (await exists(path.join(root, sourceRoot, relative))) { found = true; break; }
        }
        if (!found) warnings.push(name + ': mixin class source not found: ' + json.package + '.' + className);
      }
    }
  }
}

export async function validateProject(project) {
  const errors = [];
  const warnings = [...project.warnings];
  if (!project.found) return { ok: false, errors: ['not a Gradle project'], warnings };
  const root = project.root;
  const resources = path.join(root, 'src/main/resources');
  const fabricFile = path.join(resources, 'fabric.mod.json');
  if (await exists(fabricFile)) {
    try { validateFabric(await readJson(fabricFile), errors, warnings); }
    catch (error) { errors.push('fabric.mod.json: invalid JSON (' + (error instanceof Error ? error.message : String(error)) + ')'); }
  }
  const modsFile = path.join(resources, 'META-INF/mods.toml');
  const neoforgeFile = path.join(resources, 'META-INF/neoforge.mods.toml');
  if (await exists(modsFile)) validateToml((await readTextLimited(modsFile)).text, errors, warnings);
  if (await exists(neoforgeFile)) validateToml((await readTextLimited(neoforgeFile)).text, errors, warnings);
  const packFile = path.join(resources, 'pack.mcmeta');
  if (await exists(packFile)) {
    try {
      const pack = await readJson(packFile);
      if (!Number.isInteger(pack.pack?.pack_format)) warnings.push('pack.mcmeta: pack.pack_format must be an integer');
      else {
        const expected = project.versionProfile?.resourcePack;
        const supported = Array.isArray(pack.pack.supported_formats) ? pack.pack.supported_formats : [];
        if (expected !== undefined && pack.pack.pack_format !== expected && !supported.includes(expected)) warnings.push('pack.mcmeta: pack_format ' + pack.pack.pack_format + ' does not match Minecraft ' + String(project.minecraftVersion) + ' (expected ' + expected + ')');
      }
    } catch (error) { errors.push('pack.mcmeta: invalid JSON (' + (error instanceof Error ? error.message : String(error)) + ')'); }
  } else if (project.loader !== 'unknown') {
    warnings.push('src/main/resources/pack.mcmeta is missing');
  }
  if (project.sourceRoots.length === 0) errors.push('no Java source root found (src/main/java or src/client/java)');
  if (project.loader !== 'unknown' && project.minecraftVersion !== undefined && project.javaVersion !== undefined) {
    const required = versionProfile(project.minecraftVersion).java;
    if (required !== undefined && Number(project.javaVersion) < required) {
      warnings.push('Java ' + project.javaVersion + ' may be too old for Minecraft ' + project.minecraftVersion + ' (expected Java ' + required + ')');
    }
  }
  await validateMixins(root, project, errors, warnings);
  return { ok: errors.length === 0, errors, warnings };
}
