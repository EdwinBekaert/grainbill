// The passages an answer is built from: BM25 and voyage-4 fused, the top 30 reranked by
// rerank-3-lite, the first 5 kept (the best row of the search evaluation). Vectors and orders
// come from their caches; Voyage is called only when a key is given.

import type { Passage } from './chunk.ts';
import { EmbeddingCache, embedAll, type Fetch, MODEL } from './embed.ts';
import { RerankCache, rerank } from './rerank.ts';
import { createDenseSearch, createHybridSearch, createSearch, embeddingText } from './search.ts';

export const POOL = 30;
export const TOP = 5;

export type Retriever = (question: string) => Promise<Passage[]>;

export async function createRetriever(
  passages: Passage[],
  caches: { embeddings: EmbeddingCache; reranks: RerankCache },
  opts: { apiKey?: string; fetch?: Fetch } = {},
): Promise<Retriever> {
  const vectors = (await embedAll(caches.embeddings, passages.map(embeddingText), 'document', opts)).vectors;
  const keyword = createSearch(passages, 'title and text');
  return async (question) => {
    const [q] = (await embedAll(caches.embeddings, [question], 'query', opts)).vectors;
    const dense = createDenseSearch(passages, vectors, new Map([[question, q as Float32Array]]));
    const pool = createHybridSearch([keyword, dense])(question).slice(0, POOL);
    return (await rerank(caches.reranks, question, pool, embeddingText, opts)).items.slice(0, TOP);
  };
}
