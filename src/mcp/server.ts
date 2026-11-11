// The MCP server: a stdio server for a Claude Code session (or any MCP client) with two tools.
// `impact` takes a feature request and returns the ranked modules with their evidence; `ask` takes
// a question about Foedrum and returns a cited answer from its documents, from the frozen snapshot
// (--docs) or live (--live <data dir>, which calls Voyage and `claude -p`).
//
//   claude mcp add grainbill -- node <path>/src/mcp/server.ts <path>/data/index.json --live <path>/data

import { readFileSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { parseArgs } from 'node:util';
import type { Index } from '../cards.ts';
import { type Asked, createLiveAsk, type DocsSnapshot, renderAnswer, snapshotAsk } from '../docs/ask.ts';
import { createImpact, type ModuleHit } from '../impact.ts';
import { createHandler, type Tool, ToolError } from './protocol.ts';

export function render(hits: ModuleHit[], index: Index): string {
  if (hits.length === 0) return 'No module matches this request.';
  const lines = [`Modules of ${index.repo} at ${index.rev.slice(0, 8)}, most likely first:`, ''];
  for (const [i, h] of hits.entries()) {
    lines.push(`${i + 1}. ${h.module} (score ${h.score.toFixed(1)})`);
    for (const f of h.files) {
      const what = f.summary !== '' ? ` — ${f.summary.slice(0, 160)}` : '';
      const names = f.exports.length > 0 ? ` [${f.exports.slice(0, 6).join(', ')}]` : '';
      lines.push(`   - ${f.path}${names}${what}`);
    }
  }
  lines.push('', 'Evidence comes from file paths, exported names and comments; read the files before deciding.');
  return lines.join('\n');
}

export function impactTool(index: Index): Tool {
  const impact = createImpact(index);
  return {
    name: 'impact',
    description:
      'Given a feature request or issue text, rank the modules of the indexed repository it most likely ' +
      'touches, each with the files, exported names and comments that support it. Use it to plan where a ' +
      'change goes before reading code; grep remains the tool for exact names.',
    inputSchema: {
      type: 'object',
      properties: {
        request: { type: 'string', description: 'The feature request or issue: title and body' },
        top: { type: 'integer', minimum: 1, maximum: 20, description: 'How many modules to return (default 5)' },
      },
      required: ['request'],
    },
    call: ({ request, top }) => {
      if (typeof request !== 'string' || request.trim() === '') throw new ToolError('request must be a non-empty string');
      const n = top === undefined ? 5 : Number(top);
      if (!Number.isInteger(n) || n < 1 || n > 20) throw new ToolError('top must be an integer from 1 to 20');
      return render(impact(request, { top: n }), index);
    },
  };
}

// Where `ask` gets its answers: the frozen snapshot of the question set, or live (any question).
export type Asker = { rev: string; ask: (question: string) => Asked | undefined | Promise<Asked | undefined> };

export function askTool(asker: Asker, live: boolean): Tool {
  return {
    name: 'ask',
    description:
      "Answer a question about Foedrum's design, decisions (ADRs) or recipes from its documents: the five " +
      'best passages and an answer that cites them by number, or NOT COVERED when they do not say. ' +
      (live
        ? 'A new question costs a search and a model call.'
        : 'This server answers only the 50 questions of its evaluation set, from a snapshot.'),
    inputSchema: {
      type: 'object',
      properties: { question: { type: 'string', description: 'The question, in plain words' } },
      required: ['question'],
    },
    call: async ({ question }) => {
      if (typeof question !== 'string' || question.trim() === '') throw new ToolError('question must be a non-empty string');
      let asked: Asked | undefined;
      try {
        asked = await asker.ask(question);
      } catch (e) {
        throw new ToolError(`could not answer: ${(e as Error).message}`);
      }
      if (asked === undefined) throw new ToolError('not in the snapshot: this server answers only the questions of its evaluation set');
      return renderAnswer(asked, asker.rev);
    },
  };
}

if (import.meta.main) {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: { docs: { type: 'string' }, live: { type: 'string' } },
  });
  const index = JSON.parse(readFileSync(positionals[0] ?? 'data/index.json', 'utf8')) as Index;
  const tools = [impactTool(index)];
  if (values.live !== undefined) {
    const voyageKey = process.env.VOYAGE_API_KEY;
    const live = await createLiveAsk({ dir: values.live, ...(voyageKey ? { voyageKey } : {}) });
    tools.push(askTool(live, true));
  } else if (values.docs !== undefined) {
    const snapshot = JSON.parse(readFileSync(values.docs, 'utf8')) as DocsSnapshot;
    tools.push(askTool({ rev: snapshot.foedrum.rev, ask: snapshotAsk(snapshot) }, false));
  }
  const handle = createHandler({ name: 'grainbill', version: '0.2.0' }, tools);
  for await (const line of createInterface({ input: process.stdin })) {
    if (line.trim() === '') continue;
    const response = await handle(line);
    if (response !== undefined) process.stdout.write(`${JSON.stringify(response)}\n`);
  }
}
