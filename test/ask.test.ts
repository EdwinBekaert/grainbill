import assert from 'node:assert/strict';
import { test } from 'node:test';
import { type DocsSnapshot, type Entry, renderAnswer, snapshotAsk } from '../src/docs/ask.ts';
import { docsTable, pickAnswers, wrap } from '../src/demo.ts';
import { createHandler } from '../src/mcp/protocol.ts';
import { askTool } from '../src/mcp/server.ts';

const verdict = { correct: 'yes', faithful: 'yes', unsupported: [], current: 'n/a', refused: 'no', reason: '' } as const;

const entry = (id: string, kind: string, extra: Partial<Entry> = {}): Entry => ({
  id,
  kind,
  question: `What about ${id}?`,
  paraphrased: false,
  sourceHit: true,
  answer: `About ${id} [1].`,
  passages: [{ path: 'docs/design/gate.md', start: 1, end: 4, title: 'gates › push gate' }],
  verdict: { ...verdict, unsupported: [] },
  ...extra,
});

const snapshot: DocsSnapshot = {
  foedrum: { rev: '2d64a6e3904c', revDate: '2026-11-11' },
  answerModel: 'claude-haiku-5-5',
  judgeModel: 'claude-sonnet-5-5',
  entries: [
    entry('design-01', 'design'),
    entry('amended-01', 'amended', { verdict: { ...verdict, unsupported: [], current: 'yes' } }),
    entry('design-02', 'design', { sourceHit: false, verdict: { ...verdict, unsupported: [], correct: 'no', faithful: 'no' } }),
    entry('unanswerable-01', 'unanswerable', { sourceHit: false, answer: 'NOT COVERED: no dates.', verdict: { ...verdict, unsupported: [], refused: 'yes' } }),
  ],
};

test('renderAnswer lists the passages the answer cites, with the commit', () => {
  assert.equal(
    renderAnswer(snapshot.entries[0] as Entry, snapshot.foedrum.rev),
    'About design-01 [1].\n\nPassages, from Foedrum at 2d64a6e3:\n[1] gates › push gate (docs/design/gate.md:1-4)',
  );
});

test('snapshotAsk finds a question of the set whatever its spacing and case, and nothing else', () => {
  const ask = snapshotAsk(snapshot);
  assert.equal(ask('  what ABOUT   design-01? ')?.answer, 'About design-01 [1].');
  assert.equal(ask('something else?'), undefined);
});

test('the ask tool answers from the snapshot, and a question outside it is a tool error', async () => {
  const handle = createHandler({ name: 'g', version: '0' }, [askTool({ rev: snapshot.foedrum.rev, ask: snapshotAsk(snapshot) }, false)]);
  const call = async (question: unknown) =>
    (await handle(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'ask', arguments: { question } } }))) as {
      result: { content: { text: string }[]; isError?: boolean };
    };
  assert.match((await call('What about amended-01?')).result.content[0]?.text ?? '', /^About amended-01 \[1\]\.\n\nPassages, from Foedrum at 2d64a6e3:/);
  const outside = await call('Who wrote Foedrum?');
  assert.equal(outside.result.isError, true);
  assert.match(outside.result.content[0]?.text ?? '', /not in the snapshot/);
  assert.equal((await call('')).result.isError, true);
  // A live answer that fails comes back as a tool error, not a crash.
  const failing = createHandler({ name: 'g', version: '0' }, [
    askTool({ rev: 'r', ask: async () => { throw new Error('VOYAGE_API_KEY is not set'); } }, true),
  ]);
  const failed = (await failing(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'ask', arguments: { question: 'q' } } }))) as {
    result: { content: { text: string }[]; isError: boolean };
  };
  assert.equal(failed.result.isError, true);
  assert.match(failed.result.content[0]?.text ?? '', /could not answer: VOYAGE_API_KEY is not set/);
});

test('the demo picks an amended answer that is right, and tables the verdicts by source hit', () => {
  const picked = pickAnswers(snapshot);
  assert.equal(picked.get('amended')?.id, 'amended-01');
  // design-01 is right; design-02 is wrong and not shown.
  assert.equal(picked.get('design')?.id, 'design-01');
  assert.equal(picked.get('unanswerable')?.id, 'unanswerable-01');
  assert.equal(picked.has('recipe'), false);
  assert.deepEqual(docsTable(snapshot), [
    '| Questions | Correct | Partly | Wrong | Faithful |',
    '|---|---|---|---|---|',
    '| answerable (3) | 66.7% | 0.0% | 33.3% | 66.7% |',
    '| a source among the 5 passages (2) | 100.0% | 0.0% | 0.0% | 100.0% |',
    '| no source among them (1) | 0.0% | 0.0% | 100.0% | 0.0% |',
    '| unanswerable, refused (1) | 100.0% | | | |',
  ]);
});

test('wrap breaks at word boundaries and keeps paragraphs apart', () => {
  assert.deepEqual(wrap('one two three four\n\nfive', 9), ['one two', 'three', 'four', 'five']);
});
