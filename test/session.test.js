import test from 'node:test';
import assert from 'node:assert/strict';
import { isNewConversation } from '../src/session.js';

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
test('turn history without a header is treated as old', () => {
  assert.equal(isNewConversation({ header: {}, requestHeader: () => undefined, snapshotEvents: () => [{ type: 'turn/start' }] }), false);
});
