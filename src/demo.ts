// npm run demo [-- --no-pause] [--data demo/snapshot]
//
// A guided walk-through, offline: no gh, no login, no network. It reads a frozen snapshot of
// Foedrum's issues and an index built before them, picks one real issue, shows Grain Bill's answer
// beside what the pull request actually changed and beside the baseline, prints the evaluation
// over all cases, and last talks to the real MCP server over stdio, as Claude Code would.

import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { createInterface } from 'node:readline';
import { createInterface as createPrompt } from 'node:readline/promises';
import { fileURLToPath } from 'node:url';
import { parseArgs, styleText } from 'node:util';
import type { Index } from './cards.ts';
import type { Case } from './eval/cases.ts';
import { type EvalCase, evaluate, table } from './eval/evaluate.ts';
import { recallAt } from './eval/metrics.ts';
import { createImpact, type ModuleHit } from './impact.ts';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SHOWN_REQUEST_LINES = 12;
const MAX_REQUEST_LENGTH = 2_500;

// The case the demo tells: the newest one short enough to show, where Grain Bill's first module is
// right and its top three hold every changed module, while the baseline's top three miss one.
export function pickShowcase(
  evalSet: EvalCase[],
  impact: (request: string) => ModuleHit[],
  frequent: string[],
): EvalCase | undefined {
  const candidates = [...evalSet].reverse().filter((c) => c.request.length <= MAX_REQUEST_LENGTH);
  const strict = candidates.find((c) => {
    const predicted = impact(c.request).map((h) => h.module);
    return (
      c.expected.includes(predicted[0] ?? '') &&
      recallAt(c.expected, predicted, 3) === 1 &&
      recallAt(c.expected, frequent, 3) < 1
    );
  });
  return strict ?? candidates.find((c) => c.expected.includes(impact(c.request)[0]?.module ?? ''));
}

// The issue as a person would skim it: the title, then its first lines of prose, no code blocks.
export function excerpt(request: string, lines: number): string[] {
  const out: string[] = [];
  let inFence = false;
  for (const line of request.split(/\r?\n/)) {
    if (line.trimStart().startsWith('```')) {
      inFence = !inFence;
      continue;
    }
    if (inFence || line.trim() === '') continue;
    out.push(line.length > 110 ? `${line.slice(0, 107)}…` : line);
    if (out.length === lines) break;
  }
  return out;
}

const h1 = (s: string) => styleText(['bold', 'cyan'], s);
const dim = (s: string) => styleText('dim', s);
const good = (s: string) => styleText('green', s);
const bad = (s: string) => styleText('red', s);
const mark = (ok: boolean) => (ok ? good('✓') : bad('✗'));

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      'no-pause': { type: 'boolean', default: false },
      data: { type: 'string', default: join(ROOT, 'demo', 'snapshot') },
    },
  });
  const pausing = !values['no-pause'] && process.stdin.isTTY === true;
  const prompt = pausing ? createPrompt({ input: process.stdin, output: process.stdout }) : undefined;
  let step = 0;
  const section = async (title: string): Promise<void> => {
    if (step > 0 && prompt !== undefined) await prompt.question(dim('\n  press Enter to go on … '));
    step += 1;
    console.log(`\n${h1(`${step}. ${title}`)}\n`);
  };

  const indexPath = join(values.data, 'eval-index.json');
  const index = JSON.parse(readFileSync(indexPath, 'utf8')) as Index;
  const cases = JSON.parse(readFileSync(join(values.data, 'cases.json'), 'utf8')) as Case[];
  const evaluation = evaluate(index, cases, 100);
  const impact = createImpact(index);
  const showcase = pickShowcase(evaluation.evalSet, (r) => impact(r, { top: 5 }), evaluation.frequent);
  if (showcase === undefined) throw new Error('no case in the snapshot to show');
  const modules = [...new Set(index.cards.map((c) => c.module))].sort();

  await section('The question');
  console.log('  Foedrum turns issues into pull requests. Its planner breaks a feature request into sub-orders,');
  console.log('  and must first know where the feature lives. Grain Bill answers:');
  console.log(`\n    ${styleText('bold', 'which modules does this request touch, and what is the evidence?')}`);
  console.log(dim('\n  Everything below is offline: a frozen snapshot of Foedrum, a public repository.'));

  await section('The index: one card per file');
  console.log(`  ${index.cards.length} files of ${styleText('bold', 'src/')} in ${modules.length} modules, read through git at`);
  console.log(`  commit ${index.rev.slice(0, 8)} (${index.revDate.slice(0, 10)}), before every issue the demo asks about.\n`);
  console.log(`  ${dim('modules:')} ${modules.join(', ')}\n`);
  const evidence = impact(showcase.request, { top: 1 })[0]?.files[0];
  const card = index.cards.find((c) => c.path === evidence?.path) ?? index.cards[0];
  if (card !== undefined) {
    console.log(`  ${dim('a card:')}  ${styleText('bold', card.path)}`);
    console.log(`  ${dim('exports:')} ${card.exports.slice(0, 8).join(', ') || '(none)'}`);
    console.log(`  ${dim('summary:')} ${card.summary.slice(0, 300)}${card.summary.length > 300 ? '…' : ''}`);
    console.log(`  ${dim('comments:')} ${card.comments.length} characters, searched too`);
  }

  await section(`A real issue: #${showcase.issue}`);
  for (const line of excerpt(showcase.request, SHOWN_REQUEST_LINES)) console.log(`  │ ${line}`);
  console.log(dim(`\n  Closed by pull request #${showcase.pr}, merged ${showcase.mergedAt.slice(0, 10)}. The index has not seen it.`));

  await section("Grain Bill's answer");
  for (const [i, hit] of impact(showcase.request, { top: 3 }).entries()) {
    console.log(`  ${mark(showcase.expected.includes(hit.module))} ${i + 1}. ${styleText('bold', hit.module)} ${dim(`score ${hit.score.toFixed(1)}`)}`);
    for (const f of hit.files.slice(0, 2)) {
      console.log(`        ${f.path} ${dim(f.summary.slice(0, 90))}`);
    }
  }
  console.log(`\n  What pull request #${showcase.pr} actually changed: ${styleText('bold', showcase.expected.join(', '))}`);

  await section('The baseline: no search at all');
  console.log('  Always answer with the modules changed most often before the cut-off:\n');
  for (const [i, m] of evaluation.frequent.slice(0, 3).entries()) {
    console.log(`  ${mark(showcase.expected.includes(m))} ${i + 1}. ${m}`);
  }
  console.log(dim('\n  A strong baseline: a few modules change in most pull requests. Search has to beat it, not zero.'));

  await section(`Across ${evaluation.evalSet.length} issues`);
  for (const line of table(evaluation).trimEnd().split('\n')) console.log(`  ${line}`);
  console.log(dim('\n  Hit@1: the first module is right. Recall@k: the share of changed modules in the top k.'));
  console.log(dim('  F2 weighs recall four times precision: a module a plan misses costs more than an extra one.'));

  await section('Over MCP, as Claude Code calls it');
  await mcpExchange(indexPath, showcase);
  console.log(`\n  Add it to Claude Code:\n`);
  console.log(`    claude mcp add grainbill -- node ${join(ROOT, 'src', 'mcp', 'server.ts')} ${join(ROOT, 'data', 'index.json')}`);
  console.log(dim('\n  (build data/index.json of the current code first: npm run index -- --repo <path> --rev origin/main)\n'));
  prompt?.close();
}

// Starts the real server, sends three JSON-RPC messages and shows what goes each way.
async function mcpExchange(indexPath: string, showcase: EvalCase): Promise<void> {
  const server = spawn(process.execPath, [join(ROOT, 'src', 'mcp', 'server.ts'), indexPath], {
    stdio: ['pipe', 'pipe', 'inherit'],
  });
  const replies = createInterface({ input: server.stdout })[Symbol.asyncIterator]();
  const title = showcase.request.split('\n')[0] ?? '';
  const exchanges: [string, unknown][] = [
    ['initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'demo', version: '0' } }],
    ['tools/list', {}],
    ['tools/call', { name: 'impact', arguments: { request: showcase.request, top: 3 } }],
  ];
  try {
    for (const [i, [method, params]] of exchanges.entries()) {
      const shown = method === 'tools/call' ? { name: 'impact', arguments: { request: `${title} …`, top: 3 } } : params;
      console.log(`  ${good('→')} ${JSON.stringify({ jsonrpc: '2.0', id: i + 1, method, params: shown }).slice(0, 150)}`);
      server.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id: i + 1, method, params })}\n`);
      if (method === 'initialize') server.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' })}\n`);
      const { value, done } = await replies.next();
      if (done) throw new Error('the server ended before it answered');
      const reply = JSON.parse(value as string) as { result?: { content?: { text: string }[] } };
      const text = reply.result?.content?.[0]?.text;
      if (text === undefined) {
        console.log(`  ${styleText('yellow', '←')} ${(value as string).slice(0, 150)}${(value as string).length > 150 ? '…' : ''}\n`);
      } else {
        console.log(`  ${styleText('yellow', '←')} the tool's text:`);
        for (const line of text.split('\n')) console.log(`      ${line.slice(0, 120)}`);
      }
    }
  } finally {
    server.stdin.end();
    server.kill();
  }
}

if (import.meta.main) await main();
