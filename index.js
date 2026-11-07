import { resolveConfig } from './src/config.js';
import { isNewConversation } from './src/session.js';
import { CONTROL_TOOL, PLUGIN_NAME, SECTION_NAME } from './src/names.js';
import { GROUPS, GROUP_NAMES, controlTool, groupTools } from './src/tool-defs.js';

/** Stable Loader identity. */
export const name = PLUGIN_NAME;
/** Host services required by this plugin. */
export const inject = ['tools', 'systemPrompt', 'workingDirectory', 'agents'];

const GUIDANCE_ORDER = 10050;

function guidanceText() {
  return [
    '## Minecraft Java mod development',
    'If the user asks to create, modify, debug, or port a Minecraft Java Edition mod (Fabric, NeoForge, Forge, or Architectury), call ' + CONTROL_TOOL + ' with action "activate" and only the groups the task needs: ' + GROUP_NAMES.join(', ') + '. The selected tools appear on the next step.',
    'Do not call it for unrelated tasks. Once active, prefer mcdev_project before broad file reads, mcdev_build instead of shell Gradle runs, mcdev_assets/mcdev_data for generated JSON, mcdev_jar for archive contents, and mcdev_log before reading a whole log. Call action "deactivate" when a group is no longer useful.',
    'If the session working directory is not the Gradle project root, pass projectDir to any project-aware tool instead of changing the session; it accepts an absolute path or a path relative to the working directory.'
  ].join('\n');
}

function installScoped(scoped, config, logger) {
  const definitions = groupTools({ ctx: scoped, config });
  const active = new Map();

  const listNames = () => [...active.keys()];
  const listTools = () => [...active.values()].flatMap((entry) => entry.tools);

  function status() {
    return {
      ok: true,
      activeGroups: listNames(),
      activeTools: listTools(),
      availableGroups: GROUP_NAMES.map((name) => ({ name, title: GROUPS[name].title, tools: GROUPS[name].tools })),
      message: listNames().length === 0 ? 'No Minecraft tools active yet. Activate only the groups needed for this task.' : 'Active Minecraft groups are callable now.'
    };
  }

  function activate(groups) {
    const requested = [...new Set(groups)];
    for (const group of requested) if (!GROUP_NAMES.includes(group)) throw new Error('unknown group "' + group + '"; choose ' + GROUP_NAMES.join(', '));
    const activated = [];
    const already = [];
    const registered = [];
    try {
      for (const group of requested) {
        if (active.has(group)) { already.push(group); continue; }
        const disposers = [];
        for (const definition of definitions[group]) {
          const dispose = scoped.tools.register(definition);
          disposers.push(dispose);
          registered.push(dispose);
        }
        active.set(group, { tools: GROUPS[group].tools, disposers });
        activated.push(group);
      }
    } catch (error) {
      for (const dispose of registered.reverse()) { try { dispose(); } catch { /* best effort */ } }
      for (const group of activated) active.delete(group);
      throw error;
    }
    if (activated.length > 0) logger?.info?.('mcdev-toolbox: activated ' + activated.join(', ') + ' tools=' + listTools().join(','));
    return {
      ok: true,
      activated,
      alreadyActive: already,
      ...status(),
      message: activated.length === 0 ? 'Those groups were already active.' : 'Activated on the next step. Call the tools directly; they stay active for this conversation.'
    };
  }

  function deactivate(groups) {
    const requested = [...new Set(groups)];
    for (const group of requested) if (!GROUP_NAMES.includes(group)) throw new Error('unknown group "' + group + '"; choose ' + GROUP_NAMES.join(', '));
    const deactivated = [];
    for (const group of requested) {
      const entry = active.get(group);
      if (entry === undefined) continue;
      for (const dispose of [...entry.disposers].reverse()) { try { dispose(); } catch { /* best effort */ } }
      active.delete(group);
      deactivated.push(group);
    }
    if (deactivated.length > 0) logger?.info?.('mcdev-toolbox: deactivated ' + deactivated.join(', '));
    return { ok: true, deactivated, ...status(), message: deactivated.length === 0 ? 'Those groups were not active.' : 'Deactivated; their schemas leave the next request.' };
  }

  const control = controlTool({ activate, deactivate, status });
  const controlDispose = scoped.tools.register(control);
  const sectionDispose = scoped.systemPrompt.section({
    name: SECTION_NAME,
    order: GUIDANCE_ORDER,
    text: guidanceText()
  });

  scoped.effect(() => () => {
    for (const entry of active.values()) for (const dispose of [...entry.disposers].reverse()) { try { dispose(); } catch { /* best effort */ } }
    active.clear();
    try { controlDispose(); } catch { /* already disposed */ }
    try { sectionDispose(); } catch { /* already disposed */ }
  }, PLUGIN_NAME + ' scoped cleanup');
}

/**
 * Host plugin: new conversations get one small control tool and a short
 * guidance section. Selected group tools are registered during the tool call,
 * so DSH records a developer/message tool-addition at the end of history on the
 * next request. Resumed and seeded sessions never receive either contribution.
 */
export async function apply(ctx, rawConfig) {
  const config = resolveConfig(rawConfig ?? {});
  if (!config.enabled) { ctx.logger?.info?.('mcdev-toolbox: disabled'); return; }
  const logger = {
    info: (message) => ctx.logger?.info?.(typeof message === 'function' ? message() : message),
    warn: (message) => ctx.logger?.warn?.(typeof message === 'function' ? message() : message)
  };
  const installs = new Map();

  function install(agent, source) {
    if (!isNewConversation(agent.session, { includeSubagents: config.includeSubagents, source })) return;
    if (installs.has(agent)) return;
    const fiber = agent.ctx.inject(['tools', 'systemPrompt', 'workingDirectory'], (scoped) => {
      installScoped(scoped, config, logger);
    });
    installs.set(agent, fiber);
  }

  ctx.on('agent/created', async ({ agent, source }) => {
    try { install(agent, source); }
    catch (error) { logger.warn('mcdev-toolbox: failed to install on new Agent: ' + (error instanceof Error ? error.message : String(error))); }
  });
  ctx.on('agent/disposed', ({ agent }) => {
    const fiber = installs.get(agent);
    if (fiber === undefined) return;
    installs.delete(agent);
    Promise.resolve(fiber.dispose?.()).catch((error) => logger.warn('mcdev-toolbox: scoped dispose failed: ' + String(error)));
  });
  try {
    for (const agent of ctx.agents.list()) {
      try { install(agent, undefined); }
      catch (error) { logger.warn('mcdev-toolbox: reconcile skip: ' + (error instanceof Error ? error.message : String(error))); }
    }
  } catch (error) {
    logger.warn('mcdev-toolbox: startup reconcile failed: ' + (error instanceof Error ? error.message : String(error)));
  }
  ctx.effect(() => () => {
    for (const fiber of installs.values()) { try { Promise.resolve(fiber.dispose?.()).catch(() => {}); } catch { /* best effort */ } }
    installs.clear();
  }, PLUGIN_NAME + ' host cleanup');
  logger.info('mcdev-toolbox: ready; waiting for new conversations');
}
