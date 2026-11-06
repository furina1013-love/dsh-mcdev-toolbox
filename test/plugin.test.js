import test from 'node:test';
import assert from 'node:assert/strict';
import { apply } from '../index.js';

function fakeCtx() {
  const handlers = new Map();
  const cleanups = [];
  return {
    handlers,
    cleanups,
    logger: { info() {}, warn() {} },
    on(event, handler) { handlers.set(event, handler); },
    effect(factory) { const dispose = factory(); cleanups.push(dispose); return dispose; }
  };
}

function fakeAgent({ old = false, subagent = false } = {}) {
  const registered = new Map();
  const sections = [];
  const fiber = { disposed: false, dispose() { this.disposed = true; } };
  const scoped = {
    tools: {
      register(definition) {
        assert.ok(!registered.has(definition.name), 'duplicate tool ' + definition.name);
        registered.set(definition.name, definition);
        return () => registered.delete(definition.name);
      }
    },
    systemPrompt: { section(section) { sections.push(section); return () => {}; } },
    workingDirectory: { ensure: async () => process.cwd() },
    effect(factory) { factory(); }
  };
  const agent = {
    session: {
      header: { origin: subagent ? 'subagent' : undefined },
      inheritedEventCount: 0,
      surface: { nodes: [] },
      requestHeader: () => old ? ({ config: {} }) : undefined,
      snapshotEvents: () => []
    },
    ctx: { inject(_deps, callback) { callback(scoped); return fiber; } }
  };
  return { agent, registered, sections, fiber };
}

test('installs control tool and guidance on a new session only', async () => {
  const ctx = fakeCtx();
  await apply(ctx, {});
  const fresh = fakeAgent();
  await ctx.handlers.get('agent/created')({ agent: fresh.agent, source: 'startup' });
  assert.ok(fresh.registered.has('mcdev_toolbox'));
  assert.equal(fresh.sections.length, 1);

  const old = fakeAgent({ old: true });
  await ctx.handlers.get('agent/created')({ agent: old.agent, source: 'resume' });
  assert.equal(old.registered.size, 0);
  assert.equal(old.sections.length, 0);

  const sub = fakeAgent({ subagent: true });
  await ctx.handlers.get('agent/created')({ agent: sub.agent, source: 'startup' });
  assert.equal(sub.registered.size, 0);
});

test('activate registers group tools and deactivate removes them', async () => {
  const ctx = fakeCtx();
  await apply(ctx, {});
  const fresh = fakeAgent();
  await ctx.handlers.get('agent/created')({ agent: fresh.agent, source: 'startup' });
  const control = fresh.registered.get('mcdev_toolbox');
  const result = await control.execute({ action: 'activate', groups: ['project'] }, { agent: fresh.agent, signal: new AbortController().signal });
  assert.deepEqual(result.activated, ['project']);
  assert.ok(fresh.registered.has('mcdev_project'));
  assert.ok(fresh.registered.has('mcdev_build'));
  const removed = await control.execute({ action: 'deactivate', groups: ['project'] }, { agent: fresh.agent, signal: new AbortController().signal });
  assert.deepEqual(removed.deactivated, ['project']);
  assert.equal(fresh.registered.has('mcdev_project'), false);
  assert.equal(fresh.registered.has('mcdev_build'), false);
});
