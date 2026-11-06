import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { readTailLimited } from '../src/util.js';

test('reads only the tail of a huge log', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'mcdev-tail-'));
  const file = path.join(dir, 'latest.log');
  await fs.writeFile(file, 'A'.repeat(1000) + 'CRASH_MARKER');
  const result = await readTailLimited(file, 100);
  assert.equal(result.truncated, true);
  assert.equal(result.text.endsWith('CRASH_MARKER'), true);
  assert.equal(result.text.length, 100);
});
