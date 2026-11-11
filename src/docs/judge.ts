// node src/docs/judge.ts [--passages data/passages.json] [--questions eval/questions.jsonc]
//                        [--answers data/answers.json] [--out data/verdicts.json]
//                        [--model claude-sonnet-5-5] [--claude] [--voyage]
//
// Claude Sonnet 5.5 judges each answer of `npm run answer`, through `claude -p`: whether it is
// right against the question set's answer, whether everything it says is in the passages it was
// given, whether an amended question got the rule that holds now, and whether an unanswerable one
// was refused. No person checks the verdicts. They are cached by model, system prompt and prompt;
// only --claude asks for what is not cached.

import { readFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { ANSWER_MODEL, AnswerCache, answerAll, type Answered, answerKey, answerPrompt } from './answer.ts';
import { type Corpus, readQuestions } from './build.ts';
import { askClaude, type Reply, type Run } from './claude.ts';
import { EmbeddingCache } from './embed.ts';
import { RerankCache } from './rerank.ts';
import { createRetriever } from './retrieve.ts';

export const JUDGE_MODEL = 'claude-sonnet-5-5';

export const JUDGE_SYSTEM = [
  'You grade an answer to a question about Foedrum, a software project.',
  'You get the question, a reference answer written from Foedrum\'s documents, the numbered passages the answer was written from, and the answer.',
  'Assume nothing about the asker or their machine.',
  'Reply with one JSON object and nothing else:',
  '{"correct": "yes" | "partly" | "no", "faithful": "yes" | "no", "unsupported": [string], "current": "yes" | "no" | "n/a", "refused": "yes" | "no", "reason": string}',
  '- correct: does the answer say what the reference answer says on the point asked? "partly" when it is right but misses part of it or adds a wrong detail. An answer that says the passages do not cover the point asked is "no" unless the reference answer is a refusal.',
  '- faithful: is every claim in the answer stated by the passages it cites? Judge against the passages, not the reference answer. List in "unsupported" each claim the passages do not state, in a few words.',
  '- current: when an outdated answer is given, does the answer give the rule that holds now rather than the outdated one? "n/a" when none is given.',
  '- refused: does the answer decline to answer the question asked, in whole?',
  '- reason: one sentence.',
].join('\n');

// The passages exactly as the answer saw them, ADR status lines included: an answer may rest on a
// status line ("Amends [0069]"), and a judge without it would call that claim unsupported.
export function judgePrompt(a: Answered, reference: string | null, stale: string | undefined): string {
  const passages = answerPrompt(a.question.question, a.passages).replace(/\n\nQuestion: [^]*$/, '').replace(/^Passages:\n\n/, '');
  return [
    `Question: ${a.question.question}`,
    `Reference answer: ${reference ?? 'None: the documents do not answer this question; the right answer is a refusal.'}`,
    ...(stale ? [`Outdated answer (what an older ADR said): ${stale}`] : []),
    `Passages:\n\n${passages}`,
    `Answer to grade:\n${a.reply.text}`,
  ].join('\n\n');
}

export type Verdict = {
  correct: 'yes' | 'partly' | 'no';
  faithful: 'yes' | 'no';
  unsupported: string[];
  current: 'yes' | 'no' | 'n/a';
  refused: 'yes' | 'no';
  reason: string;
};

const oneOf = <T extends string>(v: unknown, values: readonly T[], what: string): T => {
  if (typeof v === 'string' && (values as readonly string[]).includes(v)) return v as T;
  throw new Error(`verdict: ${what} is ${JSON.stringify(v)}, not one of ${values.join(', ')}`);
};

// The JSON object in a reply, also when it comes in a code fence or after a line of text.
export function parseVerdict(text: string): Verdict {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end < start) throw new Error(`verdict: no JSON object in ${JSON.stringify(text.slice(0, 200))}`);
  const v = JSON.parse(text.slice(start, end + 1)) as Record<string, unknown>;
  const unsupported = Array.isArray(v.unsupported) ? v.unsupported.filter((s): s is string => typeof s === 'string') : [];
  return {
    correct: oneOf(v.correct, ['yes', 'partly', 'no'], 'correct'),
    faithful: oneOf(v.faithful, ['yes', 'no'], 'faithful'),
    unsupported,
    current: oneOf(v.current, ['yes', 'no', 'n/a'], 'current'),
    refused: oneOf(v.refused, ['yes', 'no'], 'refused'),
    reason: typeof v.reason === 'string' ? v.reason : '',
  };
}

export type Judged = Answered & { verdict: Verdict; judgeReply: Reply };

type Full = Answered['question'] & { answer?: string | null; stale?: string };

export async function judgeAll(
  answers: Answered[],
  cache: AnswerCache,
  opts: { model: string; ask: boolean; run?: Run },
): Promise<{ judged: Judged[]; missing: number }> {
  const judged: Judged[] = [];
  let missing = 0;
  for (const a of answers) {
    const q = a.question as Full;
    const prompt = judgePrompt(a, q.sources.length > 0 ? (q.answer ?? null) : null, q.stale);
    const key = answerKey(opts.model, JUDGE_SYSTEM, prompt);
    let reply = cache.get(key);
    if (!reply && opts.ask) {
      reply = await askClaude(prompt, { model: opts.model, system: JUDGE_SYSTEM, ...(opts.run ? { run: opts.run } : {}) });
      cache.set(key, reply);
      console.log(`${q.id}: judged`);
    }
    if (!reply) {
      missing++;
      continue;
    }
    judged.push({ ...a, verdict: parseVerdict(reply.text), judgeReply: reply });
  }
  return { judged, missing };
}

const pct = (n: number, of: number): string => (of === 0 ? '-' : `${((100 * n) / of).toFixed(1)}%`);

export function report(judged: Judged[], model: string): string {
  const answerable = judged.filter((j) => j.question.sources.length > 0);
  const unanswerable = judged.filter((j) => j.question.sources.length === 0);
  const kinds = [...new Set(answerable.map((j) => j.question.kind))];
  const count = (js: Judged[], f: (v: Verdict) => boolean) => js.filter((j) => f(j.verdict)).length;
  const row = (name: string, js: Judged[]) =>
    `| ${name} (${js.length}) | ${pct(count(js, (v) => v.correct === 'yes'), js.length)} | ${pct(count(js, (v) => v.correct === 'partly'), js.length)} | ` +
    `${pct(count(js, (v) => v.correct === 'no'), js.length)} | ${pct(count(js, (v) => v.faithful === 'yes'), js.length)} |`;
  // Only questions with an outdated answer: the judge may answer `current` for others too.
  const amended = answerable.filter((j) => (j.question as Full).stale !== undefined);
  const sum = (f: (j: Judged) => number) => judged.reduce((n, j) => n + f(j), 0);
  return [
    `Verdicts by ${model} on ${judged.length} answers by ${ANSWER_MODEL}. No person checked them.`,
    '',
    '| Questions | Correct | Partly | Wrong | Faithful |',
    '|---|---|---|---|---|',
    row('answerable', answerable),
    ...kinds.map((k) => row(k, answerable.filter((j) => j.question.kind === k))),
    row('paraphrased', answerable.filter((j) => j.question.paraphrased)),
    row('not paraphrased', answerable.filter((j) => !j.question.paraphrased)),
    row('unanswerable', unanswerable),
    '',
    `Amended questions answered with the rule that holds now: ${count(amended, (v) => v.current === 'yes')} of ${amended.length}.`,
    `Unanswerable questions refused, by the judge: ${count(unanswerable, (v) => v.refused === 'yes')} of ${unanswerable.length}; ` +
      `answerable ones refused: ${count(answerable, (v) => v.refused === 'yes')} of ${answerable.length}.`,
    `Claims the passages do not state: ${sum((j) => j.verdict.unsupported.length)}, in ${count(judged, (v) => v.unsupported.length > 0)} answers.`,
    `Judge tokens: ${sum((j) => j.judgeReply.usage.inputTokens + j.judgeReply.usage.cacheReadTokens + j.judgeReply.usage.cacheWriteTokens).toLocaleString('en')} in, ` +
      `${sum((j) => j.judgeReply.usage.outputTokens).toLocaleString('en')} out. ` +
      `Models that judged: ${[...new Set(judged.flatMap((j) => j.judgeReply.models ?? ['not reported']))].join(', ')}.`,
    '',
  ].join('\n');
}

if (import.meta.main) {
  const { values } = parseArgs({
    options: {
      passages: { type: 'string', default: 'data/passages.json' },
      questions: { type: 'string', default: 'eval/questions.jsonc' },
      answers: { type: 'string', default: 'data/answers.json' },
      out: { type: 'string', default: 'data/verdicts.json' },
      model: { type: 'string', default: JUDGE_MODEL },
      claude: { type: 'boolean', default: false },
      voyage: { type: 'boolean', default: false },
    },
  });
  const corpus = JSON.parse(readFileSync(values.passages, 'utf8')) as Corpus;
  const retrieve = await createRetriever(
    corpus.passages,
    { embeddings: new EmbeddingCache('data/embeddings.json'), reranks: new RerankCache('data/reranks.json') },
    values.voyage ? { apiKey: process.env.VOYAGE_API_KEY } : {},
  );
  const { answers, missing, unretrieved } = await answerAll(readQuestions(values.questions), retrieve, new AnswerCache(values.answers), {
    model: ANSWER_MODEL,
    ask: false,
  });
  if (unretrieved > 0) console.log(`${unretrieved} questions are not embedded or reranked yet; run with --voyage.`);
  if (missing > 0) console.log(`${missing} questions have no cached answer; run npm run answer -- --claude first.`);
  const verdicts = await judgeAll(answers, new AnswerCache(values.out), { model: values.model, ask: values.claude });
  if (verdicts.missing > 0) console.log(`${verdicts.missing} answers are not judged yet; run with --claude to ask ${values.model}.\n`);
  if (verdicts.judged.length > 0) console.log(report(verdicts.judged, values.model));
}
