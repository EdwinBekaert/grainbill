// node src/docs/evaluate.ts [--passages data/passages.json] [--questions eval/questions.jsonc]
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
import { createSearch, VARIANTS } from './search.ts';
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

export function evaluateSearch(passages: Passage[], questions: Question[], graph: AdrGraph): Row[] {
  const answerable = questions.filter((q) => q.sources.length > 0);
  return VARIANTS.map((variant) => {
    const search = createSearch(passages, variant, graph);
    return {
      name: `BM25 over ${variant}`,
      cases: answerable.map((q) => ({ question: q, ranks: sourceRanks(passages, q, search(q.question)) })),
    };
  });
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
    },
  });
  const corpus = JSON.parse(readFileSync(values.passages, 'utf8')) as Corpus;
  const graph = adrGraph(adrStatuses(corpus.passages));
  console.log(tables(corpus, evaluateSearch(corpus.passages, readQuestions(values.questions), graph)));
}
