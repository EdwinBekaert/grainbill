import assert from 'node:assert/strict';
import { test } from 'node:test';
import { type Answered, answerPrompt, citesSource, parseAnswer } from '../src/docs/answer.ts';
import type { Question } from '../src/docs/build.ts';
import type { Passage } from '../src/docs/chunk.ts';
import { askClaude, claudeArgs, type Run } from '../src/docs/claude.ts';

const passage = (path: string, start: number, end: number, text: string, adr?: string): Passage => ({
  id: `${path}:${start}-${end}`,
  path,
  kind: adr ? 'adr' : 'design',
  title: adr ? `ADR ${adr} › Decision` : 'gates › push gate',
  start,
  end,
  text,
  ...(adr ? { adr: { number: adr, status: 'Accepted · Amends [0010](0010-gate.md)' } } : {}),
});

const gate = passage('docs/design/gate.md', 1, 4, 'The push gate runs lint and the typecheck.');
const adr = passage('docs/adr/0020-gate.md', 3, 6, 'Only lint and the typecheck run.', '0020');

// What `claude -p --output-format json` prints for one turn.
const captured = {
  type: 'result',
  subtype: 'success',
  is_error: false,
  result: 'Lint and the typecheck [1].',
  total_cost_usd: 0.0012,
  usage: { input_tokens: 900, output_tokens: 12, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
  modelUsage: { 'claude-haiku-5-5': { inputTokens: 900, outputTokens: 12 } },
};

test('claudeArgs replaces the system prompt and turns off tools, settings, MCP and saved sessions', () => {
  const args = claudeArgs('claude-haiku-5-5', 'SYSTEM');
  assert.deepEqual(args.slice(args.indexOf('--system-prompt'), args.indexOf('--system-prompt') + 2), ['--system-prompt', 'SYSTEM']);
  assert.deepEqual(args.slice(args.indexOf('--tools'), args.indexOf('--tools') + 2), ['--tools', '']);
  for (const flag of ['--print', '--safe-mode', '--strict-mcp-config', '--no-session-persistence', '--disable-slash-commands']) {
    assert.ok(args.includes(flag), flag);
  }
  assert.ok(!args.includes('--append-system-prompt'));
});

test('askClaude sends the prompt on stdin and reads the result, usage and cost', async () => {
  const seen: { command: string; input: string }[] = [];
  const run: Run = async (command, _args, input) => {
    seen.push({ command, input });
    return { code: 0, stdout: JSON.stringify(captured), stderr: '' };
  };
  const reply = await askClaude('PROMPT', { model: 'claude-haiku-5-5', system: 'S', run });
  assert.deepEqual(seen, [{ command: 'claude', input: 'PROMPT' }]);
  assert.deepEqual(reply, {
    text: 'Lint and the typecheck [1].',
    usage: { inputTokens: 900, outputTokens: 12, cacheReadTokens: 0, cacheWriteTokens: 0 },
    costUsd: 0.0012,
    models: ['claude-haiku-5-5'],
  });
  const failed: Run = async () => ({ code: 1, stdout: JSON.stringify({ ...captured, is_error: true, result: 'Not logged in' }), stderr: '' });
  await assert.rejects(askClaude('P', { model: 'm', system: 'S', run: failed }), /Not logged in/);
  const garbled: Run = async () => ({ code: 1, stdout: '', stderr: 'command not found' });
  await assert.rejects(askClaude('P', { model: 'm', system: 'S', run: garbled }), /no JSON result: command not found/);
});

test('answerPrompt numbers the passages with where they come from and an ADR status', () => {
  assert.equal(
    answerPrompt('What runs?', [gate, adr]),
    'Passages:\n\n[1] gates › push gate (docs/design/gate.md:1-4)\nThe push gate runs lint and the typecheck.\n\n' +
      '[2] ADR 0020 › Decision (docs/adr/0020-gate.md:3-6)\nStatus: Accepted · Amends [0010](0010-gate.md)\nOnly lint and the typecheck run.\n\n' +
      'Question: What runs?',
  );
});

test('parseAnswer reads refusals, citations and sentences left without one', () => {
  assert.deepEqual(parseAnswer('Lint runs [1]. The typecheck too [1][2]. It is fast.', 2), {
    refused: false,
    cited: [1, 2],
    invalid: [],
    sentences: 3,
    uncited: 1,
  });
  // A citation after the full stop belongs to the sentence before it; [7] names no passage.
  assert.deepEqual(parseAnswer('Lint runs. [2] Tests do not [7].', 5), {
    refused: false,
    cited: [2],
    invalid: [7],
    sentences: 2,
    uncited: 0,
  });
  assert.equal(parseAnswer('NOT COVERED: the passages say nothing about Windows.', 5).refused, true);
  assert.equal(parseAnswer('Not covered: nothing on Windows.', 5).uncited, 0);
});

test('citesSource is true when a cited passage overlaps a source', () => {
  const question: Question = {
    id: 'q',
    kind: 'amended',
    question: '',
    paraphrased: false,
    sources: [{ path: 'docs/adr/0020-gate.md', lines: '4' }],
  };
  const answered = (text: string): Answered => ({
    question,
    passages: [gate, adr],
    reply: { text, usage: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 }, costUsd: 0 },
    parsed: parseAnswer(text, 2),
  });
  assert.equal(citesSource([gate, adr], answered('Only lint [2].')), true);
  assert.equal(citesSource([gate, adr], answered('Lint [1].')), false);
});
