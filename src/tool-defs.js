import { runProject } from './tools/project.js';
import { runBuildTool } from './tools/build.js';
import { runAssets } from './tools/assets.js';
import { runData } from './tools/data.js';
import { runMappings } from './tools/mappings.js';
import { runMixin } from './tools/mixin.js';
import { runJar } from './tools/jar.js';
import { runLog } from './tools/log.js';
import { boundText } from './util.js';
import { detectProjectFrom } from './project.js';

export const GROUP_NAMES = ['project', 'assets', 'data', 'code', 'diagnostics'];

export const GROUPS = {
  project: {
    title: 'Project + Gradle',
    summary: 'Inspect loader/Minecraft/mappings metadata, validate mod files, and run whitelisted Gradle tasks with bounded output.',
    tools: ['mcdev_project', 'mcdev_build'],
    hint: 'Start here for an unfamiliar project; mcdev_build runs build/compileJava/runData/runClient.'
  },
  assets: {
    title: 'Models + language',
    summary: 'Validate or create item/block models, blockstates and en_us language entries, including 1.21.4 item model definitions.',
    tools: ['mcdev_assets'],
    hint: 'Use after adding a block/item or when a model/texture reference is broken.'
  },
  data: {
    title: 'Recipes + tags + loot',
    summary: 'Generate and validate recipe, item/block tag and simple block loot-table JSON with version-correct folder and result keys.',
    tools: ['mcdev_data'],
    hint: 'Use for datapack content; validates recipes and tags without launching Minecraft.'
  },
  code: {
    title: 'Mappings, mixins + jars',
    summary: 'Search local Tiny/TSRG/ProGuard mappings; validate mixin configs; inspect, read and reverse-engineer local JARs.',
    tools: ['mcdev_mappings', 'mcdev_mixin', 'mcdev_jar'],
    hint: 'Use when writing mixins, porting code across mappings versions, or learning from a built/dependency jar.'
  },
  diagnostics: {
    title: 'Crash + log analysis',
    summary: 'Summarize run/logs/latest.log or crash reports into known failure signatures with next actions.',
    tools: ['mcdev_log'],
    hint: 'Use before reading a huge log by hand; it returns only the highest-signal excerpts.'
  }
};

const outputObject = {
  type: 'object',
  additionalProperties: true
};

/** Compile the author-facing per-property spec into raw JSON Schema. */
function compileValue(spec) {
  if (spec === null || typeof spec !== 'object' || Array.isArray(spec)) return spec;
  const output = { ...spec };
  delete output.required;
  if (output.items !== undefined) output.items = compileValue(output.items);
  // oneOf branches are already raw JSON Schema; preserve their own required arrays.
  if (Array.isArray(output.oneOf)) output.oneOf = output.oneOf.map((entry) => (entry !== null && typeof entry === 'object' && !Array.isArray(entry) ? { ...entry } : entry));
  if (output.properties !== undefined && output.properties !== null && typeof output.properties === 'object' && !Array.isArray(output.properties)) {
    output.properties = Object.fromEntries(Object.entries(output.properties).map(([name, entry]) => [name, compileValue(entry)]));
  }
  return output;
}

export function compileParameters(spec) {
  const properties = {};
  const required = [];
  for (const [name, value] of Object.entries(spec)) {
    properties[name] = compileValue(value);
    if (value?.required === true) required.push(name);
  }
  return { type: 'object', properties, ...(required.length === 0 ? {} : { required }), additionalProperties: false };
}

const jsonText = (value, limit = 12000) => {
  let text;
  try { text = JSON.stringify(value); }
  catch { text = '{"error":"tool result is not serializable"}'; }
  return [{ type: 'text', text: boundText(text ?? '', limit).text }];
};

export function controlTool({ activate, deactivate, status }) {
  return {
    name: 'mcdev_toolbox',
    description: 'Minecraft Java mod-development toolbox for Fabric, NeoForge, Forge and Architectury projects. Call action=activate with only the groups this task needs; the tools appear on the next step. Groups: project (project/loader/Gradle build), assets (models/blockstates/lang), data (recipes/tags/loot), code (mappings/mixins/jars), diagnostics (crash logs). If the task is not Minecraft Java mod development, do not call this tool.',
    parameters: compileParameters({
      action: {
        type: 'string',
        required: true,
        enum: ['activate', 'deactivate', 'status'],
        description: 'activate adds the selected group tools for this conversation; deactivate removes them; status lists current groups.'
      },
      groups: {
        type: 'array',
        items: { type: 'string', enum: GROUP_NAMES },
        description: 'Groups to activate or deactivate. Required for action=activate/deactivate; use all five only when the task needs them.'
      },
      reason: {
        type: 'string',
        description: 'One short line: why this is a Minecraft Java modding task and which work you are about to do.'
      }
    }),
    output: { schema: outputObject, render: (_args, value) => jsonText(value) },
    async execute(args) {
      if (args.action === 'status') return status();
      if (args.action === 'activate') {
        if (!Array.isArray(args.groups) || args.groups.length === 0) throw new Error('groups is required for activate');
        return activate(args.groups);
      }
      if (args.action === 'deactivate') {
        if (!Array.isArray(args.groups) || args.groups.length === 0) throw new Error('groups is required for deactivate');
        return deactivate(args.groups);
      }
      throw new Error('action must be activate, deactivate, or status');
    }
  };
}

function tool(name, description, parameters, execute, maxOutputChars = 12000) {
  return {
    name,
    description,
    parameters: compileParameters(parameters),
    output: { schema: outputObject, render: (_args, value) => jsonText(value, Math.min(maxOutputChars, 16000)) },
    execute
  };
}

export function groupTools({ ctx, config }) {
  const cwdOf = async (exec, projectDir) => {
    if (exec.agent === undefined) throw new Error('Minecraft tools require an Agent Session');
    const cwd = await ctx.workingDirectory.ensure(exec.agent, exec.signal);
    if (projectDir === undefined || projectDir === null || projectDir === '') return cwd;
    return (await detectProjectFrom(cwd, projectDir)).root;
  };
  const maxOutputChars = Math.max(2000, Math.min(Number(config?.maxOutputChars) || 12000, 16000));
  const createTool = (name, description, parameters, execute) => tool(name, description, parameters, execute, maxOutputChars);
  return {
    project: [
      createTool('mcdev_project', 'Inspect or validate a Minecraft Java mod project, or initialize a new Fabric project in an empty directory. inspect reports loader, Minecraft/Java versions, mod id, mappings, metadata files, mixins and the Gradle wrapper. validate adds structured errors and warnings. init writes a minimal Fabric project (settings.gradle, build.gradle, gradle.properties, fabric.mod.json, pack.mcmeta and an entrypoint class); it only supports Fabric and never overwrites files unless overwrite=true.', {
        action: { type: 'string', enum: ['inspect', 'validate', 'init'], description: 'inspect (default), validate, or init a new Fabric project.' },
        projectDir: { type: 'string', description: 'For inspect/validate: optional Gradle project root, absolute or relative to the session working directory. Use when the session cwd is not the mod project; ignored for init.' },
        directory: { type: 'string', description: 'For init: project directory relative to the session working directory; default .; must stay inside it.' },
        modId: { type: 'string', description: 'For init: mod id, for example ruby.' },
        name: { type: 'string', description: 'For init: display name; defaults to modId.' },
        packageName: { type: 'string', description: 'For init: Java package; defaults to com.example.<modId>.' },
        minecraftVersion: { type: 'string', description: 'For init: Minecraft version, for example 1.21.1.' },
        loader: { type: 'string', enum: ['fabric'], description: 'For init: only Fabric is supported; use a loader MDK for NeoForge/Forge.' },
        loaderVersion: { type: 'string', description: 'For init: Fabric loader version; default 0.16.9.' },
        loomVersion: { type: 'string', description: 'For init: Fabric Loom plugin version; default 1.9.2.' },
        javaVersion: { type: 'string', description: 'For init: Java release, normally 17 or 21; defaults from the Minecraft version.' },
        overwrite: { type: 'boolean', description: 'For init: replace generated files if they already exist (default false).' }
      }, async (args, exec) => {
        const cwd = await cwdOf(exec, args.action === 'init' ? undefined : args.projectDir);
        return runProject(args.action ?? 'inspect', cwd, args);
      }),
      createTool('mcdev_build', 'Run one Gradle task in the detected project with a hard timeout and bounded output. Prefer build, compileJava, processResources, runData, genSources, or runClient; do not use for shell commands.', {
        projectDir: { type: 'string', description: 'Optional Gradle project root, absolute or relative to the session working directory. Use when the session cwd is not the mod project.' },
        task: { type: 'string', description: 'Gradle task name such as build, compileJava, runData, genSources, or runClient; defaults to build.' },
        args: { type: 'array', items: { type: 'string' }, description: 'Optional Gradle arguments, at most 8, e.g. --stacktrace or --rerun-tasks.' },
        timeoutMs: { type: 'integer', description: 'Optional timeout from 5000 to 900000 ms; defaults to the plugin setting.' }
      }, async (args, exec) => {
        const timeoutMs = Math.min(900000, Math.max(5000, args.timeoutMs ?? config.gradleTimeoutMs));
        return runBuildTool({ task: args.task ?? 'build', args: args.args ?? [], timeoutMs, maxOutputChars: config.maxOutputChars, cwd: await cwdOf(exec, args.projectDir) });
      })
    ],
    assets: [
      createTool('mcdev_assets', 'Validate or create Minecraft asset JSON. validate checks models, blockstates and lang files for broken local references. item/block create model + blockstate + lang entries (and 1.21.4+ item model definitions). lang adds translation entries.', {
        action: { type: 'string', required: true, enum: ['validate', 'item', 'block', 'lang'], description: 'Operation to perform.' },
        projectDir: { type: 'string', description: 'Optional Gradle project root, absolute or relative to the session working directory. Use when the session cwd is not the mod project.' },
        namespace: { type: 'string', description: 'Asset namespace; defaults to the project mod id.' },
        name: { type: 'string', description: 'Item/block path for item or block, e.g. ruby or machine/grinder.' },
        texture: { type: 'string', description: 'Texture id; defaults to <namespace>:item/<name> or <namespace>:block/<name>.' },
        displayName: { type: 'string', description: 'English display name for the generated lang key.' },
        lang: { type: 'boolean', description: 'For item/block: update en_us.json (default true).' },
        locale: { type: 'string', description: 'For action=lang: locale file name, default en_us.' },
        entries: { type: 'object', additionalProperties: true, description: 'For action=lang: an object mapping translation keys to strings.' },
        overwrite: { type: 'boolean', description: 'Overwrite existing JSON files (default false).' }
      }, async (args, exec) => runAssets(args, { cwd: await cwdOf(exec, args.projectDir), maxOutputChars: config.maxOutputChars }))
    ],
    data: [
      createTool('mcdev_data', 'Generate or validate Minecraft data JSON. recipe writes shaped/shapeless/cooking/stonecutting/smithing recipes with version-correct result keys. tag and loot write datapack JSON. validate checks recipe/tag files without launching the game.', {
        action: { type: 'string', required: true, enum: ['recipe', 'tag', 'loot', 'validate'], description: 'Operation to perform.' },
        projectDir: { type: 'string', description: 'Optional Gradle project root, absolute or relative to the session working directory. Use when the session cwd is not the mod project.' },
        name: { type: 'string', description: 'Recipe/loot path name, e.g. ruby_block or gears/iron_gear.' },
        type: { type: 'string', enum: ['crafting_shaped', 'crafting_shapeless', 'smelting', 'blasting', 'smoking', 'campfire_cooking', 'stonecutting', 'smithing', 'smithing_transform', 'smithing_trim'], description: 'Recipe type for action=recipe.' },
        group: { type: 'string', description: 'Optional recipe group.' },
        category: { type: 'string', description: 'Optional recipe category, e.g. misc, building, equipment.' },
        pattern: { type: 'array', items: { type: 'string' }, description: 'Shaped recipe rows, 1-3 strings of 1-3 characters.' },
        key: { type: 'object', additionalProperties: true, description: 'Shaped recipe key: character to item id, #tag, or {item|tag}.' },
        ingredients: {
          type: 'array',
          description: 'Shapeless ingredients; item ids, #tags, or {item|tag} objects.',
          items: {
            oneOf: [
              { type: 'string', description: 'Item id, or #tag for a tag.' },
              {
                type: 'object',
                properties: { item: { type: 'string' }, tag: { type: 'string' } },
                additionalProperties: false
              }
            ]
          }
        },
        ingredient: { type: 'string', description: 'Single ingredient for cooking/stonecutting recipes.' },
        result: { type: 'string', description: 'Result item id.' },
        count: { type: 'integer', description: 'Result count 1-99.' },
        experience: { type: 'number', description: 'Cooking experience, default 0.1.' },
        cookingTime: { type: 'integer', description: 'Cooking time in ticks, default 200.' },
        template: { type: 'string', description: 'Smithing template ingredient.' },
        base: { type: 'string', description: 'Smithing base ingredient.' },
        addition: { type: 'string', description: 'Smithing addition ingredient.' },
        tag: { type: 'string', description: 'Namespaced tag id for action=tag, e.g. minecraft:planks.' },
        kind: { type: 'string', enum: ['item', 'block', 'entity_type', 'fluid', 'game_event', 'function'], description: 'Tag kind for action=tag, default item.' },
        values: {
          type: 'array',
          description: 'Tag values: item ids or #tag ids; optionally {id, required} objects.',
          items: {
            oneOf: [
              { type: 'string', description: 'Item id or #tag id.' },
              {
                type: 'object',
                properties: { id: { type: 'string' }, required: { type: 'boolean' } },
                required: ['id'],
                additionalProperties: false
              }
            ]
          }
        },
        replace: { type: 'boolean', description: 'Set replace:true for action=tag.' },
        item: { type: 'string', description: 'Loot drop item id for action=loot; defaults to <modid>:<name>.' },
        overwrite: { type: 'boolean', description: 'Overwrite existing files (default false).' }
      }, async (args, exec) => runData(args, { cwd: await cwdOf(exec, args.projectDir) }))
    ],
    code: [
      createTool('mcdev_mappings', 'Search local Tiny/TSRG/ProGuard mapping files for a class, method or field. Returns official and named names with owner/descriptor. Use when writing mixins or porting across mapping sets.', {
        projectDir: { type: 'string', description: 'Optional Gradle project root, absolute or relative to the session working directory. Use when the session cwd is not the mod project.' },
        query: { type: 'string', required: true, description: 'Class simple/full name, method name, or field name; at least 2 characters.' },
        kind: { type: 'string', enum: ['auto', 'class', 'method', 'field'], description: 'Restrict result kind; default auto.' },
        file: { type: 'string', description: 'Optional project-relative mapping file; otherwise likely Gradle caches are searched.' },
        limit: { type: 'integer', description: 'Maximum results 1-30, default 20.' }
      }, async (args, exec) => runMappings(args, { cwd: await cwdOf(exec, args.projectDir) })),
      createTool('mcdev_mixin', 'Validate mixin JSON configs and source classes, or list every @Mixin target in the project. Read-only; does not launch Minecraft.', {
        action: { type: 'string', enum: ['validate', 'list', 'targets'], description: 'validate configs/classes; list configs; targets lists @Mixin annotations.' },
        projectDir: { type: 'string', description: 'Optional Gradle project root, absolute or relative to the session working directory. Use when the session cwd is not the mod project.' }
      }, async (args, exec) => runMixin(args, { cwd: await cwdOf(exec, args.projectDir) })),
      createTool('mcdev_jar', 'Inspect and reverse-engineer a local JAR without extracting it. action=inspect summarizes manifest, fabric/Forge/NeoForge metadata, classes, resources and nested jars; list filters entries; read returns one text entry; class parses fields, methods, signatures, string constants and references without a JDK; disassemble runs javap when a JDK is available. Read-only; never executes the jar.', {
        action: { type: 'string', enum: ['inspect', 'list', 'read', 'class', 'disassemble'], description: 'inspect is the default; list/read/class/disassemble inspect one archive.' },
        projectDir: { type: 'string', description: 'Optional Gradle project root, absolute or relative to the session working directory. Use when the session cwd is not the mod project.' },
        path: { type: 'string', description: 'Project-relative .jar/.zip path. When omitted, uses the only jar under build/libs, build/devlibs, run/mods, or libs.' },
        entry: { type: 'string', description: 'For action=read: exact entry path, e.g. fabric.mod.json or META-INF/MANIFEST.MF.' },
        class: { type: 'string', description: 'For action=class/disassemble: dotted or slashed class name, e.g. com.example.Foo or com/example/Foo.' },
        prefix: { type: 'string', description: 'For action=list: only entries equal to this path or under this directory.' },
        limit: { type: 'integer', description: 'For action=list: maximum entries 1-1000, default 200.' }
      }, async (args, exec) => runJar(args, { cwd: await cwdOf(exec, args.projectDir), maxOutputChars: config.maxOutputChars }))
    ],
    diagnostics: [
      createTool('mcdev_log', 'Analyze a Minecraft launcher log or crash report and return known failure signatures with short excerpts and next actions. Defaults to run/logs/latest.log or the newest crash report.', {
        path: { type: 'string', description: 'Optional project-relative log/crash-report path.' },
        projectDir: { type: 'string', description: 'Optional Gradle project root, absolute or relative to the session working directory. Use when the session cwd is not the mod project.' }
      }, async (args, exec) => runLog(args, { cwd: await cwdOf(exec, args.projectDir) }))
    ]
  };
}

export function allGroupTools() {
  return Object.values(GROUPS).flatMap((group) => group.tools);
}
