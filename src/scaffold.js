import fs from 'node:fs/promises';
import path from 'node:path';
import { exists, resolveInside } from './util.js';
import { locateProject } from './project.js';
import { versionProfile } from './version.js';

const MOD_ID = /^[a-z][a-z0-9_-]{0,63}$/;
const MC_VERSION = /^\d+\.\d+(?:\.\d+)?$/;
const LOADER_VERSION = /^[0-9][0-9A-Za-z.+_-]{1,39}$/;
const LOOM_VERSION = /^[0-9][0-9A-Za-z.+_-]{1,39}$/;
const D = '$';

function pascal(value) {
  return value.split(/[^A-Za-z0-9]+/).filter(Boolean).map((part) => part[0].toUpperCase() + part.slice(1)).join('') || 'Example';
}

async function assertRealInside(cwd, target) {
  const realCwd = await fs.realpath(cwd);
  let probe = target;
  while (!(await exists(probe))) {
    const parent = path.dirname(probe);
    if (parent === probe) break;
    probe = parent;
  }
  const realProbe = await fs.realpath(probe);
  const rel = path.relative(realCwd, realProbe);
  if (rel.startsWith('..') || path.isAbsolute(rel)) throw new Error('path escapes the session working directory through a symbolic link');
}

function packageFor(modId, requested) {
  if (requested !== undefined) {
    if (typeof requested !== 'string' || !/^[a-z_][a-z0-9_]*(\.[a-z_][a-z0-9_]*)*$/.test(requested)) {
      throw new Error('packageName must be a lowercase Java package, for example com.example.ruby');
    }
    return requested;
  }
  const segment = modId.replace(/[^a-z0-9_]/g, '_').replace(/^[^a-z]+/, 'mod');
  return 'com.example.' + segment;
}

export async function initProject(options, cwd) {
  if (options.loader !== undefined && options.loader !== 'fabric') throw new Error('only Fabric scaffolding is supported; create a NeoForge/Forge project from its MDK or pass loader=fabric');
  const modId = options.modId;
  if (typeof modId !== 'string' || !MOD_ID.test(modId)) throw new Error('modId must match [a-z][a-z0-9_-]{0,63}');
  const minecraftVersion = options.minecraftVersion;
  if (typeof minecraftVersion !== 'string' || !MC_VERSION.test(minecraftVersion)) throw new Error('minecraftVersion is required, for example 1.21.1');
  const profile = versionProfile(minecraftVersion);
  const javaVersion = String(options.javaVersion ?? profile.java ?? 21);
  if (!/^(?:8|11|16|17|21|22|23|24|25)$/.test(javaVersion)) throw new Error('javaVersion must be a supported Java version such as 17 or 21');
  const loaderVersion = String(options.loaderVersion ?? '0.16.9');
  const loomVersion = String(options.loomVersion ?? '1.9.2');
  if (!LOADER_VERSION.test(loaderVersion)) throw new Error('loaderVersion is not a valid Fabric loader version');
  if (!LOOM_VERSION.test(loomVersion)) throw new Error('loomVersion is not a valid Fabric Loom version');
  const root = resolveInside(cwd, options.directory ?? '.');
  const packageName = packageFor(modId, options.packageName);
  const baseClass = pascal(modId);
  const className = /Mod$/.test(baseClass) ? baseClass : baseClass + 'Mod';
  if (options.name !== undefined && (typeof options.name !== 'string' || options.name.trim() === '')) throw new Error('name must be a non-empty string');
  const displayName = options.name ?? modId;
  if (displayName.length > 80 || /[\r\n]/.test(displayName)) throw new Error('name must be one line of at most 80 characters');
  if (displayName.includes('$')) throw new Error('name must not contain "$" because Gradle processResources expands it');
  const outer = (await locateProject(cwd)).root;
  if (outer !== undefined && outer !== root) {
    const shownOuter = path.relative(cwd, outer) || '.';
    throw new Error('refusing to create a nested project inside existing project "' + shownOuter + '"; set the session working directory to the intended project or an empty directory outside it');
  }
  if (outer === root) {
    for (const marker of ['settings.gradle.kts', 'build.gradle.kts']) {
      if (await exists(path.join(root, marker))) throw new Error('refusing to initialize over an existing Kotlin DSL project (' + marker + '); use that project or choose an empty directory');
    }
  }
  await assertRealInside(cwd, root);
  const packFormat = profile.resourcePack ?? 34;
  const warnings = [];
  if (!profile.known) warnings.push('Minecraft ' + minecraftVersion + ' is not in the built-in version table; Java ' + javaVersion + ' and pack_format ' + packFormat + ' use fallback defaults.');
  const overwrite = options.overwrite === true;
  const files = new Map();
  files.set('settings.gradle', "pluginManagement {\n    repositories {\n        maven { name = 'Fabric'; url = 'https://maven.fabricmc.net/' }\n        mavenCentral()\n        gradlePluginPortal()\n    }\n}\n\nrootProject.name = '" + modId + "'\n");
  files.set('gradle.properties', [
    'org.gradle.jvmargs=-Xmx1G',
    'org.gradle.parallel=true',
    'minecraft_version=' + minecraftVersion,
    'loader_version=' + loaderVersion,
    'loom_version=' + loomVersion,
    'mod_version=1.0.0',
    'maven_group=' + packageName,
    'archives_base_name=' + modId,
    'java_version=' + javaVersion,
    ''
  ].join('\n'));
  files.set('build.gradle', [
    'plugins {',
    "    id 'fabric-loom' version \"" + D + "{loom_version}\"",
    '}',
    '',
    'version = project.mod_version',
    'group = project.maven_group',
    '',
    'base {',
    '    archivesName = project.archives_base_name',
    '}',
    '',
    'repositories {',
    '    mavenCentral()',
    '}',
    '',
    'dependencies {',
    '    minecraft "com.mojang:minecraft:' + D + '{project.minecraft_version}"',
    '    mappings loom.officialMojangMappings()',
    '    modImplementation "net.fabricmc:fabric-loader:' + D + '{project.loader_version}"',
    '}',
    '',
    'processResources {',
    '    inputs.property "version", project.version',
    '    filesMatching("fabric.mod.json") {',
    '        expand "version": project.version',
    '    }',
    '}',
    '',
    'tasks.withType(JavaCompile).configureEach {',
    '    options.release = project.java_version as int',
    '}',
    '',
    'java {',
    '    withSourcesJar()',
    '    toolchain {',
    '        languageVersion = JavaLanguageVersion.of(project.java_version as int)',
    '    }',
    '}',
    ''
  ].join('\n'));
  const entrypoint = packageName + '.' + className;
  files.set('src/main/resources/fabric.mod.json', JSON.stringify({
    schemaVersion: 1,
    id: modId,
    version: D + '{version}',
    name: displayName,
    description: 'A Minecraft Fabric mod.',
    authors: [],
    license: 'MIT',
    environment: '*',
    entrypoints: { main: [entrypoint] },
    depends: { fabricloader: '>=' + loaderVersion, minecraft: '>=' + minecraftVersion, java: '>=' + javaVersion }
  }, null, 2) + '\n');
  files.set('src/main/resources/pack.mcmeta', JSON.stringify({ pack: { pack_format: packFormat, description: displayName + ' resources' } }, null, 2) + '\n');
  files.set('src/main/java/' + packageName.split('.').join('/') + '/' + className + '.java', [
    'package ' + packageName + ';',
    '',
    'import net.fabricmc.api.ModInitializer;',
    '',
    'public class ' + className + ' implements ModInitializer {',
    '    public static final String MOD_ID = "' + modId + '";',
    '',
    '    @Override',
    '    public void onInitialize() {',
    '    }',
    '}',
    ''
  ].join('\n'));
  files.set('.gitignore', ['.gradle/', 'build/', 'run/', 'out/', '*.iml', '.idea/', '.vscode/', ''].join('\n'));
  const targets = [...files.keys()];
  const existing = [];
  for (const relative of targets) {
    const target = path.join(root, relative);
    const stat = await fs.lstat(target).catch(() => undefined);
    if (stat?.isSymbolicLink()) throw new Error('refusing to write through a symbolic link: ' + relative);
    if (stat !== undefined) existing.push(relative);
  }
  if (existing.length > 0 && !overwrite) {
    throw new Error('refusing to overwrite existing files: ' + existing.join(', ') + '; pass overwrite=true only when you intend to replace them');
  }
  await fs.mkdir(root, { recursive: true });
  for (const [relative, content] of files) {
    const target = path.join(root, relative);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, content, 'utf8');
  }
  const relativeRoot = path.relative(cwd, root) || '.';
  const shownRoot = relativeRoot.split(path.sep).join('/');
  return {
    ok: true,
    root,
    directory: shownRoot,
    files: targets,
    minecraftVersion,
    javaVersion,
    loader: 'fabric',
    warnings,
    nextSteps: [
      'Run \'gradle wrapper --gradle-version 8.11\' once in ' + shownRoot + ' to create the Gradle wrapper required by mcdev_build.',
      'Run mcdev_build task=build to compile and remap the mod.',
      'Run mcdev_assets action=item name=<item> to add the first item.'
    ]
  };
}
