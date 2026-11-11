// npm run demo [-- --no-pause] [--data demo/snapshot]
//
// A guided walk-through, offline: no gh, no login, no network, no model. It reads a frozen snapshot
// of Foedrum's issues and an index built before them, picks one real issue, shows Grain Bill's
// answer beside what the pull request actually changed and beside the baseline, and prints the
// evaluation over all cases. Then one question of each kind answered from Foedrum's documents
// (a refusal among them) and the judged answers over the question set, from the frozen answers.
// Last it talks to the real MCP server over stdio, as Claude Code would.

import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { createInterface } from 'node:readline';
import { createInterface as createPrompt } from 'node:readline/promises';
import { fileURLToPath } from 'node:url';
import { parseArgs, styleText } from 'node:util';
import type { Index } from './cards.ts';
import type { DocsSnapshot, Entry } from './docs/ask.ts';
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

  const docsPath = join(values.data, 'docs.json');
  const docs = JSON.parse(readFileSync(docsPath, 'utf8')) as DocsSnapshot;
  const picked = pickAnswers(docs);

  for (const [n, { kind, title, note }] of KINDS.entries()) {
    const e = picked.get(kind);
    if (e === undefined) throw new Error(`no ${kind} question in the snapshot`);
    await section(`Foedrum's documents, ${n + 1} of ${KINDS.length}: ${title}`);
    console.log(`  ${styleText('bold', e.question)}\n`);
    for (const line of wrap(e.answer, 100)) console.log(`  │ ${line}`);
    console.log('');
    for (const [i, p] of e.passages.entries()) console.log(`  ${dim(`[${i + 1}]`)} ${p.title} ${dim(`${p.path}:${p.start}-${p.end}`)}`);
    console.log(dim(`\n  ${note}`));
    console.log(
      `  ${dim(`${docs.judgeModel}'s verdict:`)} ` +
        (kind === 'unanswerable'
          ? `refused: ${e.verdict.refused}`
          : `correct: ${e.verdict.correct}, faithful to the passages: ${e.verdict.faithful}`),
    );
    if (n === 0) {
      console.log(dim(`\n  ${docs.answerModel} answers from the 5 passages that keyword search and embeddings, fused and reranked, put first.`));
      console.log(dim('  Each step shows an answer the judge found right; the table after them shows all 50.'));
    }
  }

  await section(`Across ${docs.entries.length} questions`);
  for (const line of docsTable(docs)) console.log(`  ${line}`);
  console.log(dim(`\n  Verdicts by ${docs.judgeModel}; no person checked them. More in docs/results.md.`));

  await section('Over MCP, as Claude Code calls it');
  await mcpExchange(indexPath, docsPath, showcase, (picked.get('amended') as Entry).question);
  console.log(`\n  Add it to Claude Code (ask answers any question live, with VOYAGE_API_KEY and claude on PATH):\n`);
  console.log(
    `    claude mcp add grainbill -- node ${join(ROOT, 'src', 'mcp', 'server.ts')} ${join(ROOT, 'data', 'index.json')} --live ${join(ROOT, 'data')}`,
  );
  console.log(dim('\n  (build data/ first: npm run index, npm run chunk, npm run eval:docs -- --embed)\n'));
  prompt?.close();
}

// The five kinds of question in the set, as the demo tells them.
export const KINDS = [
  { kind: 'design', title: 'how it works now', note: 'From the design pages, which say how Foedrum works today.' },
  { kind: 'why', title: 'why it was decided', note: 'From an ADR, which records why a decision was taken.' },
  { kind: 'amended', title: 'a decision a later one changed', note: 'An older ADR said otherwise; the answer gives the rule that holds now and cites both.' },
  { kind: 'recipe', title: 'what actually runs', note: "From Foedrum's defaults: the recipes, brewers and lenses it runs with." },
  { kind: 'unanswerable', title: 'a question the documents cannot answer', note: 'The documents come close but do not say; the answer says so instead of guessing.' },
] as const;

// For each kind, the shortest answer the judge found right and faithful, from passages that held
// a source (for an amended question, with the rule that holds now); for the unanswerable kind,
// the shortest refusal. A kind with none of those shows its first question.
export function pickAnswers(docs: DocsSnapshot): Map<string, Entry> {
  const good = (e: Entry) =>
    e.kind === 'unanswerable'
      ? e.verdict.refused === 'yes'
      : e.sourceHit && e.verdict.correct === 'yes' && e.verdict.faithful === 'yes' && (e.kind !== 'amended' || e.verdict.current === 'yes');
  const picked = new Map<string, Entry>();
  for (const { kind } of KINDS) {
    const all = docs.entries.filter((e) => e.kind === kind);
    const best = all.filter(good).sort((a, b) => a.answer.length - b.answer.length)[0] ?? all[0];
    if (best) picked.set(kind, best);
  }
  return picked;
}

// The verdicts over the set, by group, and by whether a source was among the 5 passages.
export function docsTable(docs: DocsSnapshot): string[] {
  const answerable = docs.entries.filter((e) => e.kind !== 'unanswerable');
  const share = (es: Entry[], f: (e: Entry) => boolean) => (es.length === 0 ? '-' : `${((100 * es.filter(f).length) / es.length).toFixed(1)}%`);
  const row = (name: string, es: Entry[]) =>
    `| ${name} (${es.length}) | ${share(es, (e) => e.verdict.correct === 'yes')} | ${share(es, (e) => e.verdict.correct === 'partly')} | ` +
    `${share(es, (e) => e.verdict.correct === 'no')} | ${share(es, (e) => e.verdict.faithful === 'yes')} |`;
  const unanswerable = docs.entries.filter((e) => e.kind === 'unanswerable');
  return [
    '| Questions | Correct | Partly | Wrong | Faithful |',
    '|---|---|---|---|---|',
    row('answerable', answerable),
    row('a source among the 5 passages', answerable.filter((e) => e.sourceHit)),
    row('no source among them', answerable.filter((e) => !e.sourceHit)),
    `| unanswerable, refused (${unanswerable.length}) | ${share(unanswerable, (e) => e.verdict.refused === 'yes')} | | | |`,
  ];
}

// Words to lines of at most `width` characters.
export function wrap(text: string, width: number): string[] {
  const lines: string[] = [];
  for (const paragraph of text.split(/\n+/)) {
    let line = '';
    for (const word of paragraph.split(/\s+/).filter(Boolean)) {
      if (line !== '' && line.length + 1 + word.length > width) {
        lines.push(line);
        line = word;
      } else line = line === '' ? word : `${line} ${word}`;
    }
    if (line !== '') lines.push(line);
  }
  return lines;
}

// Starts the real server on the snapshot, sends four JSON-RPC messages and shows what goes each way.
async function mcpExchange(indexPath: string, docsPath: string, showcase: EvalCase, question: string): Promise<void> {
  const server = spawn(process.execPath, [join(ROOT, 'src', 'mcp', 'server.ts'), indexPath, '--docs', docsPath], {
    stdio: ['pipe', 'pipe', 'inherit'],
  });
  const replies = createInterface({ input: server.stdout })[Symbol.asyncIterator]();
  const title = showcase.request.split('\n')[0] ?? '';
  const exchanges: [string, unknown][] = [
    ['initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'demo', version: '0' } }],
    ['tools/list', {}],
    ['tools/call', { name: 'impact', arguments: { request: showcase.request, top: 3 } }],
    ['tools/call', { name: 'ask', arguments: { question } }],
  ];
  try {
    for (const [i, [method, params]] of exchanges.entries()) {
      const isImpact = method === 'tools/call' && (params as { name: string }).name === 'impact';
      const shown = isImpact ? { name: 'impact', arguments: { request: `${title} …`, top: 3 } } : params;
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
