// Claude through headless Claude Code (`claude -p`), as Foedrum runs it: no API key, the session
// is the user's own login. Each call is one turn with our system prompt in place of Claude Code's,
// no tools, no settings, CLAUDE.md, hooks, MCP servers or saved session, and the prompt on stdin.

import { spawn } from 'node:child_process';

// Runs a program with `input` on stdin and returns its exit code and output.
export type Run = (command: string, args: string[], input: string) => Promise<{ code: number; stdout: string; stderr: string }>;

export const runProcess: Run = (command, args, input) =>
  new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8').on('data', (d: string) => (stdout += d));
    child.stderr.setEncoding('utf8').on('data', (d: string) => (stderr += d));
    child.on('error', reject);
    child.on('close', (code) => resolve({ code: code ?? 1, stdout, stderr }));
    child.stdin.end(input);
  });

export type Usage = { inputTokens: number; outputTokens: number; cacheReadTokens: number; cacheWriteTokens: number };
// `models`: the models the call used, as claude reports them, to show which one answered.
export type Reply = { text: string; usage: Usage; costUsd: number; models?: string[] };

// The command line of one call. Only fixed values, the model and the system prompt go on it.
export function claudeArgs(model: string, system: string): string[] {
  return [
    '--print',
    '--output-format',
    'json',
    '--model',
    model,
    '--system-prompt',
    system,
    '--tools',
    '',
    '--setting-sources',
    '',
    '--strict-mcp-config',
    '--safe-mode',
    '--disable-slash-commands',
    '--no-session-persistence',
  ];
}

type Result = {
  type?: string;
  is_error?: boolean;
  result?: string;
  total_cost_usd?: number;
  modelUsage?: Record<string, unknown>;
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
    cache_read_input_tokens?: number;
    cache_creation_input_tokens?: number;
  };
};

export async function askClaude(
  prompt: string,
  opts: { model: string; system: string; run?: Run; command?: string },
): Promise<Reply> {
  const out = await (opts.run ?? runProcess)(opts.command ?? 'claude', claudeArgs(opts.model, opts.system), prompt);
  let result: Result;
  try {
    result = JSON.parse(out.stdout) as Result;
  } catch {
    throw new Error(`claude -p: exit ${out.code}, no JSON result: ${(out.stderr || out.stdout).slice(0, 300)}`);
  }
  if (out.code !== 0 || result.is_error || typeof result.result !== 'string') {
    throw new Error(`claude -p: exit ${out.code}, error: ${String(result.result ?? out.stderr).slice(0, 300)}`);
  }
  const u = result.usage ?? {};
  return {
    text: result.result,
    usage: {
      inputTokens: u.input_tokens ?? 0,
      outputTokens: u.output_tokens ?? 0,
      cacheReadTokens: u.cache_read_input_tokens ?? 0,
      cacheWriteTokens: u.cache_creation_input_tokens ?? 0,
    },
    costUsd: result.total_cost_usd ?? 0,
    ...(result.modelUsage ? { models: Object.keys(result.modelUsage) } : {}),
  };
}
