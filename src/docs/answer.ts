// node src/docs/answer.ts [--passages data/passages.json] [--questions eval/questions.jsonc]
//                         [--out data/answers.json] [--model claude-haiku-5-5] [--claude] [--voyage]
//
// Answers every question of the set from its top 5 passages, with Claude through `claude -p`.
// Answers are cached by model, system prompt and prompt; only --claude asks Claude for what is not
// cached, and only --voyage embeds or reranks a question not yet cached (VOYAGE_API_KEY). Then it
// reports refusals and citations; whether an answer is right is judged in the next step.

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { parseArgs } from 'node:util';
import { type Corpus, passagesOf, type Question, readQuestions } from './build.ts';
import type { Passage } from './chunk.ts';
import { askClaude, type Reply } from './claude.ts';
import { EmbeddingCache } from './embed.ts';
import { RerankCache } from './rerank.ts';
import { createRetriever } from './retrieve.ts';

export const ANSWER_MODEL = 'claude-haiku-5-5';

export const SYSTEM = [
  'You answer questions about Foedrum, a software project, from numbered passages of its documents.',
  'Rules:',
  '- Use only what the passages say. Add nothing from elsewhere, and do not guess.',
  '- End every sentence with the passages it rests on, such as [2] or [1][4].',
  '- An ADR that amends or supersedes another holds over it: say what holds now, and cite both.',
  '- If the passages do not answer the question, reply with one line that starts with NOT COVERED: and says what is missing.',
  '- At most five sentences.',
].join('\n');

// The question and its passages, numbered from 1, each with where it comes from.
export function answerPrompt(question: string, passages: Passage[]): string {
  const blocks = passages.map((p, i) => {
    const status = p.adr ? `\nStatus: ${p.adr.status}` : '';
    return `[${i + 1}] ${p.title} (${p.path}:${p.start}-${p.end})${status}\n${p.text}`;
  });
  return `Passages:\n\n${blocks.join('\n\n')}\n\nQuestion: ${question}`;
}

export type Parsed = {
  refused: boolean;
  // The passage numbers cited, in order of first citation, and those that name no passage.
  cited: number[];
  invalid: number[];
  sentences: number;
  uncited: number;
};

export function parseAnswer(text: string, count: number): Parsed {
  const refused = /^\s*NOT COVERED\b/i.test(text);
  const numbers = [...text.matchAll(/\[(\d+)\]/g)].map((m) => Number(m[1]));
  const cited = [...new Set(numbers)];
  // Sentences end at . ! or ? before a space or the end; citations after the stop belong to it.
  const sentences = text
    .replace(/([.!?])((?:\s*\[\d+\])+)/g, '$2$1')
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  return {
    refused,
    cited: cited.filter((n) => n >= 1 && n <= count),
    invalid: cited.filter((n) => n < 1 || n > count),
    sentences: sentences.length,
    uncited: refused ? 0 : sentences.filter((s) => !/\[\d+\]/.test(s)).length,
  };
}

export const answerKey = (model: string, system: string, prompt: string): string =>
  createHash('sha256').update(JSON.stringify([model, system, prompt])).digest('hex');

export class AnswerCache {
  readonly #file: string | undefined;
  readonly #replies: Map<string, Reply>;

  constructor(file?: string) {
    this.#file = file;
    this.#replies = new Map(
      file && existsSync(file) ? Object.entries(JSON.parse(readFileSync(file, 'utf8')) as Record<string, Reply>) : [],
    );
  }

  get(key: string): Reply | undefined {
    return this.#replies.get(key);
  }

  set(key: string, reply: Reply): void {
    this.#replies.set(key, reply);
    if (!this.#file) return;
    mkdirSync(dirname(this.#file), { recursive: true });
    writeFileSync(this.#file, `${JSON.stringify(Object.fromEntries(this.#replies), null, 1)}\n`);
  }
}

export type Answered = { question: Question; passages: Passage[]; reply: Reply; parsed: Parsed };

// Whether any cited passage overlaps one of the question's sources.
export function citesSource(all: Passage[], a: Answered): boolean {
  const ids = new Set(a.question.sources.flatMap((s) => passagesOf(all, s.path, s.lines).map((p) => p.id)));
  return a.parsed.cited.some((n) => ids.has((a.passages[n - 1] as Passage).id));
}

const pct = (n: number, of: number): string => (of === 0 ? '-' : `${((100 * n) / of).toFixed(1)}%`);

export function report(all: Passage[], answers: Answered[], model: string): string {
  const answerable = answers.filter((a) => a.question.sources.length > 0);
  const unanswerable = answers.filter((a) => a.question.sources.length === 0);
  const given = answerable.filter((a) => !a.parsed.refused);
  const retrieved = answerable.filter((a) => {
    const ids = new Set(a.question.sources.flatMap((s) => passagesOf(all, s.path, s.lines).map((p) => p.id)));
    return a.passages.some((p) => ids.has(p.id));
  });
  const sum = (f: (a: Answered) => number) => answers.reduce((n, a) => n + f(a), 0);
  const sentences = sum((a) => (a.parsed.refused ? 0 : a.parsed.sentences));
  return [
    `Answers by ${model} from the top 5 passages (fusion, reranked), ${answers.length} questions.`,
    '',
    '| | Count | Share |',
    '|---|---|---|',
    `| answerable questions refused | ${answerable.length - given.length} of ${answerable.length} | ${pct(answerable.length - given.length, answerable.length)} |`,
    `| of which a source was among the 5 passages | ${answerable.filter((a) => a.parsed.refused && retrieved.includes(a)).length} | |`,
    `| unanswerable questions refused | ${unanswerable.filter((a) => a.parsed.refused).length} of ${unanswerable.length} | ${pct(unanswerable.filter((a) => a.parsed.refused).length, unanswerable.length)} |`,
    `| answers citing a passage of a source | ${given.filter((a) => citesSource(all, a)).length} of ${given.length} | ${pct(given.filter((a) => citesSource(all, a)).length, given.length)} |`,
    `| answers with a source among the 5 passages | ${retrieved.length} of ${answerable.length} | ${pct(retrieved.length, answerable.length)} |`,
    `| sentences without a citation | ${sum((a) => a.parsed.uncited)} of ${sentences} | ${pct(sum((a) => a.parsed.uncited), sentences)} |`,
    `| citations naming no passage | ${sum((a) => a.parsed.invalid.length)} | |`,
    '',
    `Tokens: ${sum((a) => a.reply.usage.inputTokens + a.reply.usage.cacheReadTokens + a.reply.usage.cacheWriteTokens).toLocaleString('en')} in, ` +
      `${sum((a) => a.reply.usage.outputTokens).toLocaleString('en')} out; cost as claude -p reports it: $${sum((a) => a.reply.costUsd).toFixed(4)}. ` +
      `Models that answered: ${[...new Set(answers.flatMap((a) => a.reply.models ?? ['not reported']))].join(', ')}.`,
    '',
  ].join('\n');
}

if (import.meta.main) {
  const { values } = parseArgs({
    options: {
      passages: { type: 'string', default: 'data/passages.json' },
      questions: { type: 'string', default: 'eval/questions.jsonc' },
      out: { type: 'string', default: 'data/answers.json' },
      model: { type: 'string', default: ANSWER_MODEL },
      claude: { type: 'boolean', default: false },
      voyage: { type: 'boolean', default: false },
      only: { type: 'string' },
    },
  });
  const corpus = JSON.parse(readFileSync(values.passages, 'utf8')) as Corpus;
  const questions = readQuestions(values.questions).filter((q) => !values.only || values.only.split(',').includes(q.id));
  const retrieve = await createRetriever(
    corpus.passages,
    { embeddings: new EmbeddingCache('data/embeddings.json'), reranks: new RerankCache('data/reranks.json') },
    values.voyage ? { apiKey: process.env.VOYAGE_API_KEY } : {},
  );
  const cache = new AnswerCache(values.out);
  const answers: Answered[] = [];
  let missing = 0;
  let unretrieved = 0;
  for (const question of questions) {
    const passages = await retrieve(question.question).catch(() => undefined);
    if (!passages) {
      unretrieved++;
      continue;
    }
    const prompt = answerPrompt(question.question, passages);
    const key = answerKey(values.model, SYSTEM, prompt);
    let reply = cache.get(key);
    if (!reply && values.claude) {
      reply = await askClaude(prompt, { model: values.model, system: SYSTEM });
      cache.set(key, reply);
      console.log(`${question.id}: ${reply.usage.outputTokens} tokens out`);
    }
    if (!reply) {
      missing++;
      continue;
    }
    answers.push({ question, passages, reply, parsed: parseAnswer(reply.text, passages.length) });
  }
  if (unretrieved > 0) console.log(`${unretrieved} questions are not embedded or reranked yet; run with --voyage.`);
  if (missing > 0) console.log(`${missing} questions have no cached answer; run with --claude to ask ${values.model}.\n`);
  if (answers.length > 0) console.log(report(corpus.passages, answers, values.model));
}
