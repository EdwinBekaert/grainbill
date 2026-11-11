import assert from 'node:assert/strict';
import { test } from 'node:test';
import { excerpt, pickShowcase } from '../src/demo.ts';
import type { EvalCase } from '../src/eval/evaluate.ts';
import type { ModuleHit } from '../src/impact.ts';

const evalCase = (pr: number, request: string, expected: string[]): EvalCase => ({
  pr,
  issue: pr + 100,
  mergedAt: `2026-01-0${pr}`,
  request,
  files: [],
  expected,
});
const answers =
  (byRequest: Record<string, string[]>) =>
  (request: string): ModuleHit[] =>
    (byRequest[request] ?? []).map((module) => ({ module, score: 1, files: [] }));

test('pickShowcase prefers the newest case where search is right and the baseline misses', () => {
  const cases = [
    evalCase(1, 'old', ['src/a']),
    evalCase(2, 'baseline also right', ['src/engine']),
    evalCase(3, 'search wins', ['src/gate']),
    evalCase(4, 'search wrong', ['src/x']),
  ];
  const impact = answers({
    old: ['src/a'],
    'baseline also right': ['src/engine'],
    'search wins': ['src/gate', 'src/engine'],
    'search wrong': ['src/y'],
  });
  assert.equal(pickShowcase(cases, impact, ['src/engine', 'src/cli', 'src/a'])?.pr, 3);
});

test('pickShowcase falls back to a case whose first module is right', () => {
  const cases = [evalCase(1, 'only', ['src/engine'])];
  assert.equal(pickShowcase(cases, answers({ only: ['src/engine'] }), ['src/engine'])?.pr, 1);
});

test('excerpt keeps prose lines and drops code blocks and blank lines', () => {
  const request = 'Title\n\n## How it works\n```mermaid\nflowchart LR\n```\nThe change does X.\nAnd Y.';
  assert.deepEqual(excerpt(request, 3), ['Title', '## How it works', 'The change does X.']);
});
