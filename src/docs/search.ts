// Search over passages: BM25, the same scorer as M1's code search, where a passage's breadcrumb
// title can be searched with its text and an ADR found can bring the later ADRs that changed it;
// and Voyage embeddings, ranked by cosine.

import { Bm25 } from '../bm25.ts';
import { tokenize } from '../tokenize.ts';
import type { AdrGraph } from './adr-links.ts';
import type { Passage } from './chunk.ts';
import { dot } from './embed.ts';

export const VARIANTS = ['text', 'title and text', 'title and text, then later ADRs'] as const;
export type Variant = (typeof VARIANTS)[number];

// Every passage holding a word of the question, best first; ties by id, so a run repeats.
export type Search = (question: string) => Passage[];

export function createSearch(passages: Passage[], variant: Variant, graph?: AdrGraph): Search {
  const withTitle = variant !== 'text';
  const bm25 = new Bm25(passages.map((p) => ({ id: p.id, tokens: tokenize(withTitle ? `${p.title}\n${p.text}` : p.text) })));
  const byId = new Map(passages.map((p) => [p.id, p]));
  const byAdr = new Map<string, Passage[]>();
  for (const p of passages) if (p.adr) byAdr.set(p.adr.number, [...(byAdr.get(p.adr.number) ?? []), p]);
  return (question) => {
    const scores = bm25.score(tokenize(question));
    const ranked = [...scores]
      .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))
      .map(([id]) => byId.get(id) as Passage);
    if (variant !== 'title and text, then later ADRs' || !graph) return ranked;
    return withLaterAdrs(ranked, graph, byAdr, (p) => scores.get(p.id) ?? 0);
  };
}

// After each ADR passage, the best passage of every ADR that changed that ADR, and of those that
// changed them in turn, unless already listed: an amended decision is read next to its amendment.
// An ADR none of whose passages holds a word of the question brings its first passage.
export function withLaterAdrs(
  ranked: Passage[],
  graph: AdrGraph,
  byAdr: Map<string, Passage[]>,
  score: (p: Passage) => number,
): Passage[] {
  const out: Passage[] = [];
  const listed = new Set<string>();
  const expanded = new Set<string>();
  const add = (p: Passage) => {
    if (listed.has(p.id)) return;
    listed.add(p.id);
    out.push(p);
    const n = p.adr?.number;
    if (n === undefined || expanded.has(n)) return;
    expanded.add(n);
    for (const link of graph.later.get(n) ?? []) {
      const theirs = byAdr.get(link.from) ?? [];
      const best = theirs.reduce<Passage | undefined>((a, q) => (a === undefined || score(q) > score(a) ? q : a), undefined);
      if (best) add(best);
    }
  };
  for (const p of ranked) add(p);
  return out;
}

// What a passage is embedded as: its breadcrumb title and its text, as BM25 searches them.
export const embeddingText = (p: Passage): string => `${p.title}\n${p.text}`;

// Every passage by the cosine of its vector with the question's, best first. Vectors have length 1
// and follow the order of `passages`; `queries` holds each question's vector.
export function createDenseSearch(passages: Passage[], vectors: Float32Array[], queries: Map<string, Float32Array>): Search {
  return (question) => {
    const q = queries.get(question);
    if (!q) throw new Error(`no vector for the question "${question}"`);
    return passages
      .map((p, i) => ({ p, s: dot(q, vectors[i] as Float32Array) }))
      .sort((a, b) => b.s - a.s || (a.p.id < b.p.id ? -1 : 1))
      .map((x) => x.p);
  };
}
