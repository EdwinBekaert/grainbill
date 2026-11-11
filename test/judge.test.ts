import assert from 'node:assert/strict';
import { test } from 'node:test';
import { AnswerCache, type Answered, parseAnswer } from '../src/docs/answer.ts';
import type { Question } from '../src/docs/build.ts';
import type { Passage } from '../src/docs/chunk.ts';
import type { Run } from '../src/docs/claude.ts';
import { judgeAll, judgePrompt, parseVerdict, report } from '../src/docs/judge.ts';

const gate: Passage = {
  id: 'docs/design/gate.md:1-4',
  path: 'docs/design/gate.md',
  kind: 'design',
  title: 'gates › push gate',
  start: 1,
  end: 4,
  text: 'The push gate runs lint and the typecheck.',
};

const usage = { inputTokens: 10, outputTokens: 5, cacheReadTokens: 0, cacheWriteTokens: 0 };

const answered = (id: string, kind: string, text: string, extra: Record<string, unknown> = {}): Answered => ({
  question: {
    id,
    kind,
    question: `Question ${id}?`,
    paraphrased: false,
    sources: kind === 'unanswerable' ? [] : [{ path: 'docs/design/gate.md', lines: '2' }],
    ...extra,
  } as Question,
  passages: [gate],
  reply: { text, usage, costUsd: 0 },
  parsed: parseAnswer(text, 1),
});

const verdict = (v: Record<string, unknown>) =>
  JSON.stringify({ correct: 'yes', faithful: 'yes', unsupported: [], current: 'n/a', refused: 'no', reason: 'ok', ...v });

test('judgePrompt gives the reference, the outdated answer when there is one, the passages and the answer', () => {
  const adr: Passage = { ...gate, id: 'docs/adr/0020-gate.md:3-6', path: 'docs/adr/0020-gate.md', kind: 'adr', title: 'ADR 0020 › Decision', adr: { number: '0020', status: 'Accepted · Amends [0010](0010-gate.md)' } };
  // The passages as the answer saw them, an ADR's status line included.
  assert.match(judgePrompt({ ...answered('x', 'amended', 'A [1].'), passages: [adr] }, 'R', undefined), /\[1\] ADR 0020 › Decision \(docs\/adr\/0020-gate\.md:1-4\)\nStatus: Accepted · Amends \[0010\]\(0010-gate\.md\)\n/);
  const a = answered('amended-01', 'amended', 'Lint and the typecheck [1].');
  assert.equal(
    judgePrompt(a, 'Lint and typecheck.', 'Every test.'),
    'Question: Question amended-01?\n\nReference answer: Lint and typecheck.\n\nOutdated answer (what an older ADR said): Every test.\n\n' +
      'Passages:\n\n[1] gates › push gate (docs/design/gate.md:1-4)\nThe push gate runs lint and the typecheck.\n\n' +
      'Answer to grade:\nLint and the typecheck [1].',
  );
  assert.match(judgePrompt(a, null, undefined), /Reference answer: None: the documents do not answer this question/);
});

test('parseVerdict reads the object from a fence or after text, and refuses a value out of range', () => {
  const v = parseVerdict(`Here it is:\n\`\`\`json\n${verdict({ correct: 'partly', unsupported: ['a', 3] })}\n\`\`\``);
  assert.equal(v.correct, 'partly');
  assert.deepEqual(v.unsupported, ['a']);
  assert.throws(() => parseVerdict(verdict({ correct: 'maybe' })), /correct is "maybe"/);
  assert.throws(() => parseVerdict('no json here'), /no JSON object/);
});

test('judgeAll asks only for what is not cached, and the report counts the verdicts', async () => {
  const answers = [
    answered('design-01', 'design', 'Lint and the typecheck [1].', { answer: 'Lint and typecheck.' }),
    answered('amended-01', 'amended', 'Every test [1].', { answer: 'Lint and typecheck.', stale: 'Every test.' }),
    answered('unanswerable-01', 'unanswerable', 'NOT COVERED: nothing on dates.', { answer: null }),
  ];
  const replies: Record<string, string> = {
    // A `current` for a question with no outdated answer is not counted.
    'design-01': verdict({ current: 'yes' }),
    'amended-01': verdict({ correct: 'no', current: 'no', faithful: 'no', unsupported: ['every test runs'] }),
    'unanswerable-01': verdict({ refused: 'yes' }),
  };
  const asked: string[] = [];
  const run: Run = async (_command, _args, input) => {
    const id = /Question (\S+)\?/.exec(input)?.[1] as string;
    asked.push(id);
    const result = { type: 'result', is_error: false, result: replies[id], usage: { input_tokens: 100, output_tokens: 20 }, modelUsage: { 'claude-sonnet-5-5': {} } };
    return { code: 0, stdout: JSON.stringify(result), stderr: '' };
  };
  const cache = new AnswerCache();
  const first = await judgeAll(answers, cache, { model: 'claude-sonnet-5-5', ask: true, run });
  assert.deepEqual(asked, ['design-01', 'amended-01', 'unanswerable-01']);
  const again = await judgeAll(answers, cache, { model: 'claude-sonnet-5-5', ask: false });
  assert.equal(again.judged.length, 3);
  assert.equal((await judgeAll(answers, new AnswerCache(), { model: 'claude-sonnet-5-5', ask: false })).missing, 3);
  const text = report(first.judged, 'claude-sonnet-5-5');
  assert.match(text, /\| answerable \(2\) \| 50\.0% \| 0\.0% \| 50\.0% \| 50\.0% \|/);
  assert.match(text, /Amended questions answered with the rule that holds now: 0 of 1\./);
  assert.match(text, /Unanswerable questions refused, by the judge: 1 of 1/);
  assert.match(text, /Claims the passages do not state: 1, in 1 answers\./);
  assert.match(text, /No person checked them\./);
});
