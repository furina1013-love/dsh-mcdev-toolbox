import test from 'node:test';
import assert from 'node:assert/strict';
import { isNewConversation, shouldInstallTools } from '../src/session.js';

test('fresh session is new', () => {
  assert.equal(isNewConversation({ header: {}, requestHeader: () => undefined, snapshotEvents: () => [] }), true);
});
test('session with a model request is old', () => {
  assert.equal(isNewConversation({ header: {}, requestHeader: () => ({ config: {} }), snapshotEvents: () => [] }), false);
});
test('seeded fork and subagent sessions are skipped', () => {
  assert.equal(isNewConversation({ header: { isSeeded: true }, requestHeader: () => undefined, snapshotEvents: () => [] }), false);
  assert.equal(isNewConversation({ header: { origin: 'subagent' }, requestHeader: () => undefined, snapshotEvents: () => [] }), false);
  assert.equal(isNewConversation({ header: { origin: 'subagent' }, requestHeader: () => undefined, snapshotEvents: () => [] }, { includeSubagents: true }), true);
});
test('resume source is always old, even with an empty log', () => {
  assert.equal(isNewConversation({ header: {}, inheritedEventCount: 0, surface: { nodes: [] }, requestHeader: () => undefined, snapshotEvents: () => [] }, { source: 'resume' }), false);
});
test('surface history is treated as old', () => {
  assert.equal(isNewConversation({ header: {}, surface: { nodes: [{}] }, requestHeader: () => undefined, snapshotEvents: () => [] }), false);
});
test('turn history without a header is treated as old', () => {
  assert.equal(isNewConversation({ header: {}, requestHeader: () => undefined, snapshotEvents: () => [{ type: 'turn/start' }] }), false);
});

test('clear source is treated as new when history is empty', () => {
  const empty = { header: {}, requestHeader: () => undefined, snapshotEvents: () => [] };
  assert.equal(isNewConversation(empty, { source: 'clear' }), true);
  assert.equal(isNewConversation({ ...empty, requestHeader: () => ({ config: {} }) }, { source: 'clear' }), false);
  assert.equal(isNewConversation(empty, { source: 'compact' }), false);
});

test('parent and delegation checks are gated by includeSubagents', () => {
  const child = { header: { parentSession: 'parent', delegationDepth: 1 }, requestHeader: () => undefined, snapshotEvents: () => [] };
  assert.equal(isNewConversation(child), false);
  assert.equal(isNewConversation(child, { includeSubagents: true }), true);
});

test('existing sessions install only when explicitly enabled', () => {
  const old = { header: {}, requestHeader: () => ({ config: {} }), snapshotEvents: () => [] };
  assert.equal(shouldInstallTools(old), false);
  assert.equal(shouldInstallTools(old, { includeExistingSessions: true }), true);
  assert.equal(shouldInstallTools(old, { includeExistingSessions: true, source: 'resume' }), true);

  const subagent = { header: { origin: 'subagent' }, requestHeader: () => undefined, snapshotEvents: () => [] };
  assert.equal(shouldInstallTools(subagent, { includeExistingSessions: true }), false);
  assert.equal(shouldInstallTools(subagent, { includeExistingSessions: true, includeSubagents: true }), true);
});
