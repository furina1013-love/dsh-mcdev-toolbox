/**
 * A conversation is new when it has never sent a model request and was not
 * seeded from another session. Resumed sessions and forks keep their exact old
 * history; the plugin never adds prompt text or tools to them.
 */
export function isNewConversation(session, { includeSubagents = false, source } = {}) {
  if (session === undefined || session === null) return false;
  if (source !== undefined && source !== 'startup') return false;
  const header = session.header;
  if (header?.isSeeded === true) return false;
  if (header?.parentSession !== undefined) return false;
  if (header?.delegationDepth !== undefined) return false;
  if (session.inheritedEventCount !== undefined && session.inheritedEventCount !== 0) return false;
  if (!includeSubagents && header?.origin === 'subagent') return false;
  try {
    if (typeof session.requestHeader === 'function' && session.requestHeader() !== undefined) return false;
  } catch {
    return false;
  }
  let events = [];
  try {
    if (typeof session.snapshotEvents === 'function') events = session.snapshotEvents();
  } catch {
    return false;
  }
  if (events.some((event) => event.type === 'request/header' || event.type === 'turn/start' || event.type === 'assistant/message')) return false;
  try {
    if (session.surface?.nodes?.length > 0) return false;
  } catch {
    return false;
  }
  return true;
}
