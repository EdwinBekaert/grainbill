import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import type { Fetch } from '../src/docs/embed.ts';
import { RerankCache, requestRerank, rerank } from '../src/docs/rerank.ts';

type Body = { query: string; documents: string[]; model: string };

// A Voyage reranker stand-in: a document scores the number of the query's letters it holds, and the
// list comes back under `key`, sorted as Voyage sorts it.
function fakeRerank(key: 'data' | 'results' = 'data') {
  const calls: Body[] = [];
  const f = (async (_url: string, init: RequestInit) => {
    const body = JSON.parse(init.body as string) as Body;
    calls.push(body);
    const scored = body.documents
      .map((d, index) => ({ index, relevance_score: [...new Set(body.query)].filter((c) => d.includes(c)).length }))
      .sort((a, b) => b.relevance_score - a.relevance_score);
    return Response.json({ object: 'list', [key]: scored, model: body.model, usage: { total_tokens: 7 } });
  }) as unknown as Fetch;
  return { f, calls };
}

test('requestRerank sends the query and pool, and reads the order from data or results', async () => {
  const { f, calls } = fakeRerank();
  const got = await requestRerank('abc', ['x', 'ab', 'abc'], { apiKey: 'k', fetch: f });
  assert.deepEqual(got, { order: [2, 1, 0], tokens: 7 });
  assert.deepEqual(calls[0], { query: 'abc', documents: ['x', 'ab', 'abc'], model: 'rerank-3-lite' });
  const other = await requestRerank('abc', ['ab', 'abc'], { apiKey: 'k', fetch: fakeRerank('results').f });
  assert.deepEqual(other.order, [1, 0]);
});

test('rerank reorders a pool, caches it, and needs a key only for what is not cached', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'grainbill-'));
  try {
    const file = join(dir, 'reranks.json');
    const { f, calls } = fakeRerank();
    const pool = [{ t: 'x' }, { t: 'ab' }];
    const first = await rerank(new RerankCache(file), 'ab', pool, (p) => p.t, { apiKey: 'k', fetch: f });
    assert.deepEqual(first.items, [{ t: 'ab' }, { t: 'x' }]);
    const again = await rerank(new RerankCache(file), 'ab', pool, (p) => p.t, { fetch: f });
    assert.deepEqual(again, { items: [{ t: 'ab' }, { t: 'x' }], tokens: 0 });
    assert.equal(calls.length, 1);
    await assert.rejects(rerank(new RerankCache(file), 'other', pool, (p) => p.t, {}), /not cached and VOYAGE_API_KEY/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
