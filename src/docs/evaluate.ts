// node src/docs/evaluate.ts [--passages data/passages.json] [--questions eval/questions.jsonc]
//                           [--cache data/embeddings.json] [--embed]
//                           [--rerank-cache data/reranks.json] [--rerank]
//
// Embeddings and rerankings come from their caches; only with --embed or --rerank does it send
// what is not cached to Voyage (VOYAGE_API_KEY), and without them a run says what it would send
// and leaves those rows out.
//
// How well each search finds the question set's sources among the passages `npm run chunk` wrote.
// A source is found when a passage it overlaps is in the top k: the answer is built from the top 5,
// and the top 30 is what a reranker would reorder. Unanswerable questions have no sources and are
// left to the evaluation of answers.

import { readFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { type AdrGraph, adrGraph } from './adr-links.ts';
import { adrStatuses, type Corpus, passagesOf, type Question, readQuestions } from './build.ts';
import type { Passage } from './chunk.ts';
import { EmbeddingCache, embedAll, MODEL, uncached } from './embed.ts';
import { RERANK_MODEL, RerankCache, rerank } from './rerank.ts';
import { createDenseSearch, createHybridSearch, createSearch, embeddingText, type Search, VARIANTS } from './search.ts';
import { mean } from '../eval/metrics.ts';

export const POOL = 30;

// Per question: for each source, the rank of its first passage in the results (Infinity if none).
export type Ranks = { question: Question; ranks: number[] };

export function sourceRanks(passages: Passage[], question: Question, results: Passage[]): number[] {
  const rank = new Map(results.map((p, i) => [p.id, i + 1]));
  return question.sources.map((s) =>
    Math.min(Infinity, ...passagesOf(passages, s.path, s.lines).map((p) => rank.get(p.id) ?? Infinity)),
  );
}

// The share of sources in the top k.
export const recall = (ranks: number[], k: number): number => mean(ranks.map((r) => (r <= k ? 1 : 0)));
// Whether every source is in the top k: what an answer needing all of them can use.
export const all = (ranks: number[], k: number): number => (ranks.every((r) => r <= k) ? 1 : 0);
// One over the rank of the first source found in the pool.
export const reciprocal = (ranks: number[]): number => {
  const first = Math.min(...ranks);
  return first <= POOL ? 1 / first : 0;
};

export type Row = { name: string; cases: Ranks[] };

// Embeddings, when given: each passage's vector in the order of `passages`, and each question's.
export type Dense = { model: string; vectors: Float32Array[]; queries: Map<string, Float32Array> };

export function answerable(questions: Question[]): Question[] {
  return questions.filter((q) => q.sources.length > 0);
}

// Reorders a question's pool, best first.
export type Reranker = { model: string; rerank: (question: string, pool: Passage[]) => Promise<Passage[]> };

export async function evaluateSearch(
  passages: Passage[],
  questions: Question[],
  graph: AdrGraph,
  dense?: Dense,
  reranker?: Reranker,
): Promise<Row[]> {
  const asked = answerable(questions);
  const row = async (name: string, search: (question: string) => Passage[] | Promise<Passage[]>): Promise<Row> => {
    const cases: Ranks[] = [];
    for (const q of asked) cases.push({ question: q, ranks: sourceRanks(passages, q, await search(q.question)) });
    return { name, cases };
  };
  const rows: Row[] = [];
  for (const variant of VARIANTS) rows.push(await row(`BM25 over ${variant}`, createSearch(passages, variant, graph)));
  if (!dense) return rows;
  const embedded = createDenseSearch(passages, dense.vectors, dense.queries);
  const fused = createHybridSearch([createSearch(passages, 'title and text'), embedded]);
  const firsts: [string, Search][] = [
    [`${dense.model} over title and text`, embedded],
    ['both, by reciprocal rank fusion', fused],
  ];
  for (const [name, search] of firsts) rows.push(await row(name, search));
  if (!reranker) return rows;
  // The top of each list reordered by the reranker; what follows the pool keeps its order.
  for (const [name, search] of firsts) {
    rows.push(
      await row(`${name}, top ${POOL} reranked by ${reranker.model}`, async (question) => {
        const list = search(question);
        return [...(await reranker.rerank(question, list.slice(0, POOL))), ...list.slice(POOL)];
      }),
    );
  }
  return rows;
}

const pct = (x: number): string => `${(x * 100).toFixed(1)}%`;

export function tables(corpus: Corpus, rows: Row[]): string {
  const cases = rows[0]?.cases ?? [];
  const sources = cases.reduce((n, c) => n + c.ranks.length, 0);
  const out = [
    `Search over ${corpus.passages.length} passages of Foedrum ${corpus.rev.slice(0, 8)} (${corpus.revDate.slice(0, 10)}): ` +
      `${cases.length} answerable questions, ${sources} sources.`,
    '',
    '| Search | Recall@5 | All@5 | Recall@30 | MRR@30 |',
    '|---|---|---|---|---|',
    ...rows.map((r) => {
      const m = (f: (ranks: number[]) => number) => mean(r.cases.map((c) => f(c.ranks)));
      return `| ${r.name} | ${pct(m((x) => recall(x, 5)))} | ${pct(m((x) => all(x, 5)))} | ${pct(m((x) => recall(x, POOL)))} | ${m(reciprocal).toFixed(2)} |`;
    }),
    '',
  ];
  // Recall@5 by kind, and for questions worded with few words of their source against the rest.
  const kinds = [...new Set(cases.map((c) => c.question.kind))];
  const groups: { name: string; has: (q: Question) => boolean }[] = [
    ...kinds.map((k) => ({ name: k, has: (q: Question) => q.kind === k })),
    { name: 'paraphrased', has: (q) => q.paraphrased },
    { name: 'not paraphrased', has: (q) => !q.paraphrased },
  ];
  const count = (g: (typeof groups)[number]) => cases.filter((c) => g.has(c.question)).length;
  out.push(
    `| Recall@5 | ${groups.map((g) => `${g.name} (${count(g)})`).join(' | ')} |`,
    `|---|${groups.map(() => '---|').join('')}`,
    ...rows.map((r) => {
      const of = (g: (typeof groups)[number]) => mean(r.cases.filter((c) => g.has(c.question)).map((c) => recall(c.ranks, 5)));
      return `| ${r.name} | ${groups.map((g) => pct(of(g))).join(' | ')} |`;
    }),
    '',
  );
  return out.join('\n');
}

if (import.meta.main) {
  const { values } = parseArgs({
    options: {
      passages: { type: 'string', default: 'data/passages.json' },
      questions: { type: 'string', default: 'eval/questions.jsonc' },
      cache: { type: 'string', default: 'data/embeddings.json' },
      embed: { type: 'boolean', default: false },
      'rerank-cache': { type: 'string', default: 'data/reranks.json' },
      rerank: { type: 'boolean', default: false },
    },
  });
  const corpus = JSON.parse(readFileSync(values.passages, 'utf8')) as Corpus;
  const questions = readQuestions(values.questions);
  const graph = adrGraph(adrStatuses(corpus.passages));
  const cache = new EmbeddingCache(values.cache);
  const docs = corpus.passages.map(embeddingText);
  const asked = answerable(questions).map((q) => q.question);
  const missing = [uncached(cache, MODEL, 'document', docs), uncached(cache, MODEL, 'query', asked)];
  const count = missing.reduce((n, m) => n + m.texts.length, 0);
  const tokens = missing.reduce((n, m) => n + m.tokens, 0);
  let dense: Dense | undefined;
  if (count === 0 || values.embed) {
    const apiKey = process.env.VOYAGE_API_KEY;
    const d = await embedAll(cache, docs, 'document', { apiKey });
    const q = await embedAll(cache, asked, 'query', { apiKey });
    if (count > 0) console.log(`Embedded ${count} texts with ${MODEL}: ${d.tokens + q.tokens} tokens.\n`);
    dense = { model: MODEL, vectors: d.vectors, queries: new Map(asked.map((t, i) => [t, q.vectors[i] as Float32Array])) };
  } else {
    console.log(
      `${MODEL} row left out: ${count} texts are not cached (about ${tokens.toLocaleString('en')} tokens). ` +
        'Run with --embed and VOYAGE_API_KEY set to embed them.\n',
    );
  }
  // A first pass that only reads the rerank cache counts what is missing; without --rerank a run
  // with anything missing leaves the reranked rows out and sends nothing.
  const reranks = new RerankCache(values['rerank-cache']);
  let misses = 0;
  let chars = 0;
  const probe: Reranker = {
    model: RERANK_MODEL,
    rerank: async (question, pool) => {
      const got = await rerank(reranks, question, pool, embeddingText, {}).catch(() => undefined);
      if (got) return got.items;
      misses++;
      chars += question.length * pool.length + pool.reduce((n, p) => n + embeddingText(p).length, 0);
      return pool;
    },
  };
  let rows = await evaluateSearch(corpus.passages, questions, graph, dense, dense ? probe : undefined);
  if (dense && misses > 0 && values.rerank) {
    let billed = 0;
    const live: Reranker = {
      model: RERANK_MODEL,
      rerank: async (question, pool) => {
        const got = await rerank(reranks, question, pool, embeddingText, { apiKey: process.env.VOYAGE_API_KEY });
        billed += got.tokens;
        return got.items;
      },
    };
    rows = await evaluateSearch(corpus.passages, questions, graph, dense, live);
    console.log(`Reranked ${misses} pools with ${RERANK_MODEL}: ${billed} tokens.\n`);
  } else if (dense && misses > 0) {
    rows = rows.filter((r) => !r.name.includes('reranked'));
    console.log(
      `Reranked rows left out: ${misses} pools are not cached (about ${Math.ceil(chars / 4).toLocaleString('en')} tokens ` +
        `billed). Run with --rerank and VOYAGE_API_KEY set to rerank them.\n`,
    );
  }
  console.log(tables(corpus, rows));
}
