// npm run ask -- "<question>" [--data data] [--model claude-haiku-5-5]
//
// A question answered from Foedrum's documents: the top 5 passages of the best search, and an
// answer by Claude Haiku 5.5 through `claude -p` that cites them. A question asked before comes
// from the cache; a new one embeds and reranks with Voyage (VOYAGE_API_KEY) and asks Claude.
// The same answers, frozen, are what the demo and the MCP tool serve offline.

import { join } from 'node:path';
import { readFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { ANSWER_MODEL, AnswerCache, answerAll } from './answer.ts';
import type { Corpus, Question } from './build.ts';
import type { Passage } from './chunk.ts';
import type { Run } from './claude.ts';
import { EmbeddingCache } from './embed.ts';
import type { Verdict } from './judge.ts';
import { RerankCache } from './rerank.ts';
import { createRetriever } from './retrieve.ts';

// Where a cited passage comes from; the snapshot keeps this, not the passage's text.
export type Cited = { path: string; start: number; end: number; title: string };

export type Asked = { answer: string; passages: Cited[] };

// One answered question of the set, as the demo and the MCP tool show it.
export type Entry = Asked & {
  id: string;
  kind: string;
  question: string;
  paraphrased: boolean;
  // Whether a passage of one of the question's sources was among the 5.
  sourceHit: boolean;
  verdict: Verdict;
};

export type DocsSnapshot = {
  foedrum: { rev: string; revDate: string };
  answerModel: string;
  judgeModel: string;
  entries: Entry[];
};

export const cited = (p: Passage): Cited => ({ path: p.path, start: p.start, end: p.end, title: p.title });

// The answer, then the passages its [n] refer to.
export function renderAnswer(asked: Asked, rev: string): string {
  const lines = asked.passages.map((p, i) => `[${i + 1}] ${p.title} (${p.path}:${p.start}-${p.end})`);
  return `${asked.answer}\n\nPassages, from Foedrum at ${rev.slice(0, 8)}:\n${lines.join('\n')}`;
}

const normal = (q: string): string => q.trim().replace(/\s+/g, ' ').toLowerCase();

// Answers from the snapshot only: a question of the set, matched on its words.
export function snapshotAsk(snapshot: DocsSnapshot): (question: string) => Asked | undefined {
  const byQuestion = new Map(snapshot.entries.map((e) => [normal(e.question), e]));
  return (question) => byQuestion.get(normal(question));
}

// Answers any question: from the caches in `dir` when asked before, else with Voyage and Claude.
export async function createLiveAsk(opts: {
  dir: string;
  model?: string;
  voyageKey?: string;
  run?: Run;
}): Promise<{ ask: (question: string) => Promise<Asked>; rev: string }> {
  const corpus = JSON.parse(readFileSync(join(opts.dir, 'passages.json'), 'utf8')) as Corpus;
  const retrieve = await createRetriever(
    corpus.passages,
    { embeddings: new EmbeddingCache(join(opts.dir, 'embeddings.json')), reranks: new RerankCache(join(opts.dir, 'reranks.json')) },
    opts.voyageKey ? { apiKey: opts.voyageKey } : {},
  );
  const cache = new AnswerCache(join(opts.dir, 'answers.json'));
  const ask = async (text: string): Promise<Asked> => {
    const question: Question = { id: 'asked', kind: 'asked', question: text, paraphrased: false, sources: [] };
    const passages = await retrieve(text).catch((e: Error) => {
      throw new Error(`${e.message}${opts.voyageKey ? '' : ' (a new question needs VOYAGE_API_KEY)'}`);
    });
    const { answers } = await answerAll([question], async () => passages, cache, {
      model: opts.model ?? ANSWER_MODEL,
      ask: true,
      ...(opts.run ? { run: opts.run } : {}),
    });
    const a = answers[0];
    if (!a) throw new Error('no answer');
    return { answer: a.reply.text, passages: a.passages.map(cited) };
  };
  return { ask, rev: corpus.rev };
}

if (import.meta.main) {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: { data: { type: 'string', default: 'data' }, model: { type: 'string', default: ANSWER_MODEL } },
  });
  const question = positionals.join(' ').trim();
  if (question === '') throw new Error('usage: npm run ask -- "<question>"');
  const voyageKey = process.env.VOYAGE_API_KEY;
  const { ask, rev } = await createLiveAsk({ dir: values.data, model: values.model, ...(voyageKey ? { voyageKey } : {}) });
  console.log(renderAnswer(await ask(question), rev));
}
