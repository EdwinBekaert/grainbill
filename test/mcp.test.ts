import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Index } from '../src/cards.ts';
import { createHandler } from '../src/mcp/protocol.ts';
import { impactTool } from '../src/mcp/server.ts';

const index: Index = {
  repo: 'r',
  rev: 'abcdef123',
  revDate: '2026-01-01',
  depth: 2,
  cards: [
    { path: 'src/gate/push.ts', module: 'src/gate', exports: ['gate'], summary: 'blocks a force push', comments: '' },
    { path: 'src/engine/fold.ts', module: 'src/engine', exports: ['fold'], summary: 'folds events', comments: '' },
  ],
};
const handle = createHandler({ name: 'grainbill', version: '0' }, [impactTool(index)]);
const call = (method: string, params?: unknown) => handle(JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }));

test('initialize answers the version the client asked for when it is known, else the newest', () => {
  assert.deepEqual(call('initialize', { protocolVersion: '2025-06-18' }), {
    jsonrpc: '2.0',
    id: 1,
    result: { protocolVersion: '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: 'grainbill', version: '0' } },
  });
  const other = call('initialize', { protocolVersion: '1999-01-01' }) as { result: { protocolVersion: string } };
  assert.equal(other.result.protocolVersion, '2025-11-25');
});

test('a notification gets no answer', () => {
  assert.equal(handle(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' })), undefined);
});

test('tools/list names the impact tool with its input schema', () => {
  const r = call('tools/list') as { result: { tools: { name: string; inputSchema: { required: string[] } }[] } };
  assert.equal(r.result.tools[0]?.name, 'impact');
  assert.deepEqual(r.result.tools[0]?.inputSchema.required, ['request']);
});

test('tools/call ranks modules, and bad arguments come back as a tool error', () => {
  const r = call('tools/call', { name: 'impact', arguments: { request: 'block another push' } }) as {
    result: { content: { text: string }[] };
  };
  assert.match(r.result.content[0]?.text ?? '', /1\. src\/gate/);
  const bad = call('tools/call', { name: 'impact', arguments: { request: '' } }) as { result: { isError: boolean } };
  assert.equal(bad.result.isError, true);
});

test('protocol errors: unknown method, unknown tool, unparsable line', () => {
  assert.deepEqual((call('nope') as { error: { code: number } }).error.code, -32601);
  assert.deepEqual((call('tools/call', { name: 'x' }) as { error: { code: number } }).error.code, -32602);
  assert.deepEqual((handle('{') as { error: { code: number } }).error.code, -32700);
});
