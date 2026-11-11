// The MCP server: a stdio server with one tool, `impact`, which a Claude Code session (or any MCP
// client) calls with a feature request to get the ranked modules with their evidence.
//
//   claude mcp add grainbill -- node <path>/src/mcp/server.ts <path>/data/index.json

import { readFileSync } from 'node:fs';
import { createInterface } from 'node:readline';
import type { Index } from '../cards.ts';
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

if (import.meta.main) {
  const index = JSON.parse(readFileSync(process.argv[2] ?? 'data/index.json', 'utf8')) as Index;
  const handle = createHandler({ name: 'grainbill', version: '0.1.0' }, [impactTool(index)]);
  for await (const line of createInterface({ input: process.stdin })) {
    if (line.trim() === '') continue;
    const response = handle(line);
    if (response !== undefined) process.stdout.write(`${JSON.stringify(response)}\n`);
  }
}
