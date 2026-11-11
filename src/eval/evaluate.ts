// The evaluation as a function: the time-split cases, the baseline, every retriever's scores.
// `npm run eval` prints it; the demo walks through it.

import type { Index } from '../cards.ts';
import { createImpact, VARIANTS } from '../impact.ts';
import { type Case, expectedModules } from './cases.ts';
import { f2At, hitAt1, mean, recallAt } from './metrics.ts';

export const INCLUDE = ['src/'];
export const EXT = ['.ts'];
export const DEPTH = 2;

export type EvalCase = Case & { expected: string[] };
export type Row = { name: string; hit1: number; recall3: number; recall5: number; f2at3: number };
export type Evaluation = { index: Index; evalSet: EvalCase[]; frequent: string[]; rows: Row[] };

export function withExpected(cases: Case[]): EvalCase[] {
  return cases
    .map((c) => ({ ...c, expected: expectedModules(c, INCLUDE, EXT, DEPTH) }))
    .filter((c) => c.expected.length > 0);
}

// The baseline needs no request: the modules changed most often before the index's commit.
export function mostChanged(cases: EvalCase[], before: string): string[] {
  const counts = new Map<string, number>();
  for (const c of cases.filter((c) => c.mergedAt < before)) {
    for (const m of c.expected) counts.set(m, (counts.get(m) ?? 0) + 1);
  }
  return [...counts].sort((a, b) => b[1] - a[1]).map(([m]) => m);
}

function score(name: string, cases: { expected: string[]; predicted: string[] }[]): Row {
  return {
    name,
    hit1: mean(cases.map((c) => hitAt1(c.expected, c.predicted))),
    recall3: mean(cases.map((c) => recallAt(c.expected, c.predicted, 3))),
    recall5: mean(cases.map((c) => recallAt(c.expected, c.predicted, 5))),
    f2at3: mean(cases.map((c) => f2At(c.expected, c.predicted, 3))),
  };
}

export function evaluate(index: Index, cases: Case[], evalCount: number): Evaluation {
  const all = withExpected(cases);
  const evalSet = all.slice(-evalCount);
  const frequent = mostChanged(all, index.revDate);
  const rows = [score('baseline: most changed modules', evalSet.map((c) => ({ expected: c.expected, predicted: frequent })))];
  for (const variant of VARIANTS) {
    const impact = createImpact(index, variant);
    rows.push(
      score(
        `BM25 over ${variant}`,
        evalSet.map((c) => ({ expected: c.expected, predicted: impact(c.request, { top: 5 }).map((h) => h.module) })),
      ),
    );
  }
  return { index, evalSet, frequent, rows };
}

const pct = (x: number): string => `${(x * 100).toFixed(1)}%`;

export function table(e: Evaluation): string {
  const modules = new Set(e.index.cards.map((c) => c.module)).size;
  return [
    `Evaluation: ${e.evalSet.length} issues closed by pull requests merged from ${e.evalSet[0]?.mergedAt.slice(0, 10)}, ` +
      `against an index of ${e.index.cards.length} files in ${modules} modules at ${e.index.rev.slice(0, 8)} ` +
      `(${e.index.revDate.slice(0, 10)}). Expected modules per case: ${mean(e.evalSet.map((c) => c.expected.length)).toFixed(2)} on average.`,
    '',
    '| Retriever | Hit@1 | Recall@3 | Recall@5 | F2@3 |',
    '|---|---|---|---|---|',
    ...e.rows.map((r) => `| ${r.name} | ${pct(r.hit1)} | ${pct(r.recall3)} | ${pct(r.recall5)} | ${pct(r.f2at3)} |`),
    '',
  ].join('\n');
}
