import { runProject } from './tools/project.js';
import { runBuildTool } from './tools/build.js';
import { runAssets } from './tools/assets.js';
import { runData } from './tools/data.js';
import { runMappings } from './tools/mappings.js';
import { runMixin } from './tools/mixin.js';
import { runLog } from './tools/log.js';

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
    title: 'Mappings + mixins',
    summary: 'Search local Tiny/TSRG/ProGuard mappings for classes, methods and fields; validate mixin configs and list @Mixin targets.',
    tools: ['mcdev_mappings', 'mcdev_mixin'],
    hint: 'Use when writing mixins or porting code across mappings versions.'
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

const jsonText = (value) => [{ type: 'text', text: JSON.stringify(value) }];

export function controlTool({ activate, deactivate, status }) {
  return {
    name: 'mcdev_toolbox',
    description: 'Minecraft Java mod-development toolbox for Fabric, NeoForge, Forge and Architectury projects. Call action=activate with only the groups this task needs; the tools appear on the next step. Groups: project (project/loader/Gradle build), assets (models/blockstates/lang), data (recipes/tags/loot), code (mappings/mixins), diagnostics (crash logs). If the task is not Minecraft Java mod development, do not call this tool.',
    parameters: {
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
    },
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

function tool(name, description, parameters, execute) {
  return {
    name,
    description,
    parameters,
    output: { schema: outputObject, render: (_args, value) => jsonText(value) },
    execute
  };
}

export function groupTools({ ctx, config }) {
  const cwdOf = async (exec) => {
    if (exec.agent === undefined) throw new Error('Minecraft tools require an Agent Session');
    return ctx.workingDirectory.ensure(exec.agent, exec.signal);
  };
  return {
    project: [
      tool('mcdev_project', 'Inspect a Minecraft Java mod project: loader, Minecraft/Java versions, mod id, mappings, metadata files, mixins and Gradle wrapper. action=validate also checks metadata, pack.mcmeta, source roots and mixin configs. Read-only.', {
        action: { type: 'string', enum: ['inspect', 'validate'], description: 'inspect returns the project summary; validate adds structured errors and warnings.' }
      }, async (args, exec) => {
        const result = await runProject(args.action ?? 'inspect', await cwdOf(exec));
        return result;
      }),
      tool('mcdev_build', 'Run one Gradle task in the detected project with a hard timeout and bounded output. Prefer build, compileJava, processResources, runData, genSources, or runClient; do not use for shell commands.', {
        task: { type: 'string', required: true, description: 'Gradle task name such as build, compileJava, runData, genSources, or runClient.' },
        args: { type: 'array', items: { type: 'string' }, description: 'Optional Gradle arguments, at most 8, e.g. --stacktrace or --rerun-tasks.' },
        timeoutMs: { type: 'integer', description: 'Optional timeout from 5000 to 900000 ms; defaults to the plugin setting.' }
      }, async (args, exec) => {
        const timeoutMs = Math.min(900000, Math.max(5000, args.timeoutMs ?? config.gradleTimeoutMs));
        return runBuildTool({ task: args.task, args: args.args ?? [], timeoutMs, maxOutputChars: config.maxOutputChars, cwd: await cwdOf(exec) });
      })
    ],
    assets: [
      tool('mcdev_assets', 'Validate or create Minecraft asset JSON. validate checks models, blockstates and lang files for broken local references. item/block create model + blockstate + lang entries (and 1.21.4+ item model definitions). lang adds translation entries.', {
        action: { type: 'string', required: true, enum: ['validate', 'item', 'block', 'lang'], description: 'Operation to perform.' },
        namespace: { type: 'string', description: 'Asset namespace; defaults to the project mod id.' },
        name: { type: 'string', description: 'Item/block path for item or block, e.g. ruby or machine/grinder.' },
        texture: { type: 'string', description: 'Texture id; defaults to <namespace>:item/<name> or <namespace>:block/<name>.' },
        displayName: { type: 'string', description: 'English display name for the generated lang key.' },
        lang: { type: 'boolean', description: 'For item/block: update en_us.json (default true).' },
        locale: { type: 'string', description: 'For action=lang: locale file name, default en_us.' },
        entries: { type: 'object', additionalProperties: { type: 'string' }, description: 'For action=lang: translation key to text.' },
        overwrite: { type: 'boolean', description: 'Overwrite existing JSON files (default false).' }
      }, async (args, exec) => runAssets(args, { cwd: await cwdOf(exec), maxOutputChars: config.maxOutputChars }))
    ],
    data: [
      tool('mcdev_data', 'Generate or validate Minecraft data JSON. recipe writes shaped/shapeless/cooking/stonecutting/smithing recipes with version-correct result keys. tag and loot write datapack JSON. validate checks recipe/tag files without launching the game.', {
        action: { type: 'string', required: true, enum: ['recipe', 'tag', 'loot', 'validate'], description: 'Operation to perform.' },
        name: { type: 'string', description: 'Recipe/loot path name, e.g. ruby_block or gears/iron_gear.' },
        type: { type: 'string', enum: ['crafting_shaped', 'crafting_shapeless', 'smelting', 'blasting', 'smoking', 'campfire_cooking', 'stonecutting', 'smithing_transform', 'smithing_trim'], description: 'Recipe type for action=recipe.' },
        group: { type: 'string', description: 'Optional recipe group.' },
        category: { type: 'string', description: 'Optional recipe category, e.g. misc, building, equipment.' },
        pattern: { type: 'array', items: { type: 'string' }, description: 'Shaped recipe rows, 1-3 strings of 1-3 characters.' },
        key: { type: 'object', additionalProperties: true, description: 'Shaped recipe key: character to item id, #tag, or {item|tag}.' },
        ingredients: { type: 'array', items: { type: 'string' }, description: 'Shapeless ingredients; strings may be item ids or #tags.' },
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
        values: { type: 'array', items: { type: 'string' }, description: 'Tag values: item ids, #tag ids, or objects with id/required.' },
        replace: { type: 'boolean', description: 'Set replace:true for action=tag.' },
        item: { type: 'string', description: 'Loot drop item id for action=loot; defaults to <modid>:<name>.' },
        overwrite: { type: 'boolean', description: 'Overwrite existing files (default false).' }
      }, async (args, exec) => runData(args, { cwd: await cwdOf(exec) }))
    ],
    code: [
      tool('mcdev_mappings', 'Search local Tiny/TSRG/ProGuard mapping files for a class, method or field. Returns official and named names with owner/descriptor. Use when writing mixins or porting across mapping sets.', {
        query: { type: 'string', required: true, description: 'Class simple/full name, method name, or field name; at least 2 characters.' },
        kind: { type: 'string', enum: ['auto', 'class', 'method', 'field'], description: 'Restrict result kind; default auto.' },
        file: { type: 'string', description: 'Optional project-relative mapping file; otherwise likely Gradle caches are searched.' },
        limit: { type: 'integer', description: 'Maximum results 1-30, default 20.' }
      }, async (args, exec) => runMappings(args, { cwd: await cwdOf(exec) })),
      tool('mcdev_mixin', 'Validate mixin JSON configs and source classes, or list every @Mixin target in the project. Read-only; does not launch Minecraft.', {
        action: { type: 'string', enum: ['validate', 'list', 'targets'], description: 'validate configs/classes; list configs; targets lists @Mixin annotations.' }
      }, async (args, exec) => runMixin(args, { cwd: await cwdOf(exec) }))
    ],
    diagnostics: [
      tool('mcdev_log', 'Analyze a Minecraft launcher log or crash report and return known failure signatures with short excerpts and next actions. Defaults to run/logs/latest.log or the newest crash report.', {
        path: { type: 'string', description: 'Optional project-relative log/crash-report path.' }
      }, async (args, exec) => runLog(args, { cwd: await cwdOf(exec) }))
    ]
  };
}

export function allGroupTools() {
  return Object.values(GROUPS).flatMap((group) => group.tools);
}
