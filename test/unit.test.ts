import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Bm25 } from '../src/bm25.ts';
import { exportsOf, moduleOf, summaryOf } from '../src/cards.ts';
import { casesOf, expectedModules } from '../src/eval/cases.ts';
import { f2At, hitAt1, recallAt } from '../src/eval/metrics.ts';
import { createImpact } from '../src/impact.ts';
import { tokenize } from '../src/tokenize.ts';

test('tokenize splits identifiers, folds plurals and drops leading zeros', () => {
  assert.deepEqual(tokenize('handoverOf batches ADR 0249 HTTPServer'), [
    'handover',
    'batch',
    'adr',
    '249',
    'http',
    'server',
  ]);
});

test('moduleOf groups a file by its folder at the given depth', () => {
  assert.equal(moduleOf('src/engine/fold.ts', 2), 'src/engine');
  assert.equal(moduleOf('src/engine/deep/x.ts', 2), 'src/engine');
  assert.equal(moduleOf('src/main.ts', 2), 'src');
});

test('exportsOf and summaryOf read a file’s names and opening comment', () => {
  const source = '// Folds events into state.\n// Pure.\n\nexport function fold() {}\nexport type State = {};\n';
  assert.deepEqual(exportsOf(source), ['fold', 'State']);
  assert.equal(summaryOf(source), 'Folds events into state. Pure.');
});

test('BM25 ranks the document that holds the rarer query term first', () => {
  const bm25 = new Bm25([
    { id: 'a', tokens: ['push', 'gate', 'check'] },
    { id: 'b', tokens: ['check', 'check', 'test'] },
    { id: 'c', tokens: ['event', 'fold'] },
  ]);
  const scores = bm25.score(['gate', 'check']);
  assert.ok((scores.get('a') ?? 0) > (scores.get('b') ?? 0));
  assert.equal(scores.has('c'), false);
});

test('impact sums a module’s best files and keeps them as evidence', () => {
  const card = (path: string, summary: string) => ({
    path,
    module: moduleOf(path, 2),
    exports: [],
    summary,
    comments: '',
  });
  const impact = createImpact({
    repo: 'r',
    rev: 'abc',
    revDate: '2026-01-01',
    depth: 2,
    cards: [
      card('src/gate/push.ts', 'blocks a force push'),
      card('src/gate/read.ts', 'reads a push command'),
      card('src/engine/fold.ts', 'folds events'),
    ],
  });
  const [first] = impact('the gate should block another kind of push');
  assert.equal(first?.module, 'src/gate');
  assert.equal(first?.files.length, 2);
});

test('casesOf keeps pull requests that close exactly one known issue, oldest first', () => {
  const cases = casesOf(
    [
      { number: 2, mergedAt: '2026-02-01', files: [{ path: 'src/a/x.ts' }], closingIssuesReferences: [{ number: 10 }] },
      { number: 1, mergedAt: '2026-01-01', files: [{ path: 'src/b/y.ts' }], closingIssuesReferences: [{ number: 11 }] },
      { number: 3, mergedAt: '2026-03-01', files: [], closingIssuesReferences: [] },
    ],
    [
      { number: 10, title: 'T10', body: 'B10' },
      { number: 11, title: 'T11', body: 'B11' },
    ],
  );
  assert.deepEqual(cases.map((c) => c.pr), [1, 2]);
  assert.equal(cases[0]?.request, 'T11\n\nB11');
  assert.deepEqual(expectedModules(cases[1] as (typeof cases)[number], ['src/'], ['.ts'], 2), ['src/a']);
});

test('metrics: recall, hit@1 and an F2 that weighs recall over precision', () => {
  assert.equal(recallAt(['a', 'b'], ['a', 'x', 'y'], 3), 0.5);
  assert.equal(hitAt1(['a'], ['a', 'b']), 1);
  const recallHeavy = f2At(['a', 'b'], ['a', 'b', 'x'], 3);
  const precisionHeavy = f2At(['a', 'b', 'c', 'd'], ['a', 'x', 'y'], 3);
  assert.ok(recallHeavy > precisionHeavy);
});
