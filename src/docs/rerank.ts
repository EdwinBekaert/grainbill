// Voyage's reranker over `fetch`: a cross-encoder reads the question with each passage of a pool
// and scores them together, where an embedding scores each alone. Answers are cached by model,
// question and pool, so a run that has them sends nothing.

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type { Fetch } from './embed.ts';

export const RERANK_MODEL = 'rerank-3-lite';

export const rerankKey = (model: string, query: string, documents: string[]): string =>
  createHash('sha256').update(JSON.stringify([model, query, documents])).digest('hex');

// Key to the pool's indexes, best first.
export class RerankCache {
  readonly #file: string | undefined;
  readonly #orders: Map<string, number[]>;

  constructor(file?: string) {
    this.#file = file;
    this.#orders = new Map(
      file && existsSync(file) ? Object.entries(JSON.parse(readFileSync(file, 'utf8')) as Record<string, number[]>) : [],
    );
  }

  get(key: string): number[] | undefined {
    return this.#orders.get(key);
  }

  set(key: string, order: number[]): void {
    this.#orders.set(key, order);
    if (!this.#file) return;
    mkdirSync(dirname(this.#file), { recursive: true });
    writeFileSync(this.#file, `${JSON.stringify(Object.fromEntries(this.#orders))}\n`);
  }
}

type Response = { data?: { index: number; relevance_score: number }[]; results?: Response['data'] };

// The pool's indexes, best first, and the tokens billed. The documentation names the list `data`
// in one place and `results` in another; either is read.
export async function requestRerank(
  query: string,
  documents: string[],
  opts: { apiKey: string; model?: string; fetch?: Fetch },
): Promise<{ order: number[]; tokens: number }> {
  const res = await (opts.fetch ?? fetch)('https://api.voyageai.com/v1/rerank', {
    method: 'POST',
    headers: { authorization: `Bearer ${opts.apiKey}`, 'content-type': 'application/json' },
    body: JSON.stringify({ query, documents, model: opts.model ?? RERANK_MODEL }),
  });
  if (!res.ok) throw new Error(`Voyage rerank: HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const body = (await res.json()) as Response & { usage: { total_tokens: number } };
  const scored = body.data ?? body.results ?? [];
  if (scored.length !== documents.length) throw new Error(`Voyage rerank: ${scored.length} scores for ${documents.length} documents`);
  const order = [...scored].sort((a, b) => b.relevance_score - a.relevance_score || a.index - b.index).map((s) => s.index);
  return { order, tokens: body.usage.total_tokens };
}

// Reorders a pool from the cache, or from Voyage when a key is given; without either it throws.
export async function rerank<T>(
  cache: RerankCache,
  query: string,
  pool: T[],
  text: (item: T) => string,
  opts: { apiKey?: string; model?: string; fetch?: Fetch },
): Promise<{ items: T[]; tokens: number }> {
  const documents = pool.map(text);
  const key = rerankKey(opts.model ?? RERANK_MODEL, query, documents);
  let order = cache.get(key);
  let tokens = 0;
  if (!order) {
    if (!opts.apiKey) throw new Error('the reranking is not cached and VOYAGE_API_KEY is not set');
    const got = await requestRerank(query, documents, { ...opts, apiKey: opts.apiKey });
    order = got.order;
    tokens = got.tokens;
    cache.set(key, order);
  }
  return { items: order.map((i) => pool[i] as T), tokens };
}
