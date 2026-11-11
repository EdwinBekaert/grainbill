import assert from 'node:assert/strict';
import { test } from 'node:test';
import { adrGraph } from '../src/docs/adr-links.ts';
import type { Question } from '../src/docs/build.ts';
import type { Passage } from '../src/docs/chunk.ts';
import { all, reciprocal, recall, sourceRanks } from '../src/docs/evaluate.ts';
import { createSearch, fuse } from '../src/docs/search.ts';

const passage = (path: string, start: number, end: number, title: string, text: string, adr?: string): Passage => ({
  id: `${path}:${start}-${end}`,
  path,
  kind: adr ? 'adr' : 'design',
  title,
  start,
  end,
  text,
  ...(adr ? { adr: { number: adr, status: 'Accepted' } } : {}),
});

const passages = [
  passage('docs/design/gate.md', 1, 4, 'gates › push gate', 'The push gate runs lint and the typecheck.'),
  passage('docs/design/lease.md', 1, 3, 'engine › leases', 'A lease expires when its driver dies.'),
  passage('docs/adr/0010-gate.md', 1, 5, 'ADR 0010 › Gate › Decision', 'Run every test before each push.', '0010'),
  passage('docs/adr/0020-gate.md', 1, 2, 'ADR 0020 › Gate › Context', 'Slow pipelines annoyed everyone.', '0020'),
  passage('docs/adr/0020-gate.md', 3, 6, 'ADR 0020 › Gate › Decision', 'Only lint and the typecheck run.', '0020'),
];

const statuses = new Map([
  ['0010', 'Accepted · Amended by [0020](0020-gate.md)'],
  ['0020', 'Accepted · Amends [0010](0010-gate.md)'],
]);

test('createSearch ranks by BM25 over the text, or the title and text', () => {
  const ids = (variant: Parameters<typeof createSearch>[1], q: string) => createSearch(passages, variant)(q).map((p) => p.id);
  assert.deepEqual(ids('text', 'when does a lease expire'), ['docs/design/lease.md:1-3']);
  // "engine" is only in a title.
  assert.deepEqual(ids('text', 'engine'), []);
  assert.deepEqual(ids('title and text', 'engine'), ['docs/design/lease.md:1-3']);
});

test('the later-ADR variant lists the best passage of each amending ADR after the one it amends', () => {
  const search = createSearch(passages, 'title and text, then later ADRs', adrGraph(statuses));
  // 0010 brings 0020's passage that holds a question word ("run"), ahead of the design page.
  assert.deepEqual(
    search('what does every test run before a push').map((p) => p.id),
    ['docs/adr/0010-gate.md:1-5', 'docs/adr/0020-gate.md:3-6', 'docs/design/gate.md:1-4'],
  );
  // With no question word in 0020, its first passage comes, and is not listed twice.
  assert.deepEqual(
    search('every test').map((p) => p.id),
    ['docs/adr/0010-gate.md:1-5', 'docs/adr/0020-gate.md:1-2'],
  );
});

test('sourceRanks finds each source by the passages its lines overlap, and the metrics read them', () => {
  const q: Question = {
    id: 'q',
    kind: 'design',
    question: '',
    paraphrased: false,
    sources: [
      { path: 'docs/adr/0020-gate.md', lines: '2-4' },
      { path: 'docs/design/lease.md', lines: '2' },
    ],
  };
  const results = [passages[0], passages[4], passages[2]] as Passage[];
  // The first source overlaps both of 0020's passages; the second is not in the results.
  const ranks = sourceRanks(passages, q, results);
  assert.deepEqual(ranks, [2, Infinity]);
  assert.equal(recall(ranks, 5), 0.5);
  assert.equal(all(ranks, 5), 0);
  assert.equal(all([1, 3], 3), 1);
  assert.equal(reciprocal(ranks), 0.5);
  assert.equal(reciprocal([31]), 0);
});

test('fuse ranks by the sum of 1 / (k + rank) over the lists, ties by id', () => {
  const [a, b, c, d] = passages as [Passage, Passage, Passage, Passage];
  // b: 2/62, c: 2/63, a and d: 1/61 each, tied, so by id (docs/adr/… before docs/design/…).
  assert.deepEqual(
    fuse([
      [a, b, c],
      [d, b, c],
    ]).map((p) => p.id),
    [b.id, c.id, d.id, a.id],
  );
  // With k = 0: b 1/2 + 1, a 1 + 1/3, c 1, d 1/2.
  assert.deepEqual(
    fuse([[a, b], [b], [c, d, a]], 0).map((p) => p.id),
    [b.id, a.id, c.id, d.id],
  );
});
