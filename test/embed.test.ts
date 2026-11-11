import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import type { Passage } from '../src/docs/chunk.ts';
import { batches, cacheKey, EmbeddingCache, embedAll, type Fetch, requestEmbeddings, uncached } from '../src/docs/embed.ts';
import { createDenseSearch } from '../src/docs/search.ts';

type Call = { url: string; headers: Record<string, string>; body: { input: string[]; model: string; input_type: string } };

// A Voyage stand-in: each text's vector is [its length, 0], returned in reverse order to check
// that vectors are matched by index. `statuses` are answered first, one per call.
function fakeVoyage(statuses: number[] = [], failure = 'slow down') {
  const calls: Call[] = [];
  const f = (async (url: string, init: RequestInit) => {
    const body = JSON.parse(init.body as string) as Call['body'];
    calls.push({ url, headers: init.headers as Record<string, string>, body });
    const status = statuses.shift();
    if (status) return new Response(failure, { status });
    const data = body.input.map((t, index) => ({ object: 'embedding', embedding: [t.length, 0], index })).reverse();
    return Response.json({ object: 'list', data, model: body.model, usage: { total_tokens: body.input.length * 10 } });
  }) as unknown as Fetch;
  return { f, calls };
}

const noWait = async () => {};

test('requestEmbeddings sends the key and input type, and matches vectors by index, scaled to length 1', async () => {
  const { f, calls } = fakeVoyage();
  const got = await requestEmbeddings(['ab', 'abcd'], 'document', { apiKey: 'k', fetch: f });
  assert.deepEqual(
    got.vectors.map((v) => [...v]),
    [
      [1, 0],
      [1, 0],
    ],
  );
  assert.equal(got.tokens, 20);
  assert.equal(calls[0]?.url, 'https://api.voyageai.com/v1/embeddings');
  assert.equal(calls[0]?.headers.authorization, 'Bearer k');
  assert.deepEqual(calls[0]?.body, { input: ['ab', 'abcd'], model: 'voyage-4', input_type: 'document' });
});

test('requestEmbeddings waits and retries on 429, and throws on other failures', async () => {
  const retried = fakeVoyage([429, 429]);
  const waits: number[] = [];
  await requestEmbeddings(['a'], 'query', { apiKey: 'k', fetch: retried.f, wait: async (ms) => void waits.push(ms) });
  assert.deepEqual(waits, [1000, 2000]);
  await assert.rejects(requestEmbeddings(['a'], 'query', { apiKey: 'k', fetch: fakeVoyage([401]).f, wait: noWait }), /HTTP 401/);
  // The low limit of an account without a payment method is not waited out.
  const capped = fakeVoyage([429], 'You have not yet added your payment method in the billing page');
  await assert.rejects(requestEmbeddings(['a'], 'query', { apiKey: 'k', fetch: capped.f, wait: noWait }), /no payment method/);
  assert.equal(capped.calls.length, 1);
});

test('batches keeps each request under the text and size limits', () => {
  assert.deepEqual(
    batches(Array.from({ length: 300 }, () => 'x')).map((b) => b.length),
    [128, 128, 44],
  );
  assert.deepEqual(
    batches(['a'.repeat(200_000), 'b'.repeat(200_000), 'c']).map((b) => b.length),
    [1, 2],
  );
});

test('embedAll calls only for texts not cached, and the cache survives a reload', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'grainbill-'));
  try {
    const file = join(dir, 'embeddings.json');
    const { f, calls } = fakeVoyage();
    const cache = new EmbeddingCache(file);
    await embedAll(cache, ['one', 'two', 'one'], 'document', { apiKey: 'k', fetch: f });
    assert.deepEqual(calls[0]?.body.input, ['one', 'two']);
    const reloaded = new EmbeddingCache(file);
    assert.deepEqual([...(reloaded.get(cacheKey('voyage-4', 'document', 'two')) ?? [])], [1, 0]);
    // A query is embedded apart from the same text as a document.
    assert.equal(uncached(reloaded, 'voyage-4', 'query', ['one']).texts.length, 1);
    const again = await embedAll(reloaded, ['two', 'one'], 'document', { fetch: f });
    assert.equal(calls.length, 1);
    assert.equal(again.vectors.length, 2);
    await assert.rejects(embedAll(reloaded, ['three'], 'document', {}), /not cached and VOYAGE_API_KEY is not set/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('createDenseSearch ranks passages by cosine with the question', () => {
  const p = (id: string) => ({ id, path: id, kind: 'design', title: id, start: 1, end: 1, text: '' }) as Passage;
  const v = (x: number, y: number) => Float32Array.from([x, y]);
  const search = createDenseSearch([p('a'), p('b'), p('c')], [v(1, 0), v(0, 1), v(0.6, 0.8)], new Map([['q', v(0, 1)]]));
  assert.deepEqual(
    search('q').map((x) => x.id),
    ['b', 'c', 'a'],
  );
  assert.throws(() => search('other'), /no vector/);
});
