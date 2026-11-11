// node src/docs/snapshot.ts [--data data] [--questions eval/questions.jsonc] [--out demo/snapshot/docs.json]
//
// Freezes the question set's answers and verdicts for the offline demo and the MCP tool: each
// answer with where its 5 passages come from, not their text, so the snapshot stays small. Reads
// the caches only; it never calls a model.

import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { ANSWER_MODEL, AnswerCache, answerAll } from './answer.ts';
import { cited, type DocsSnapshot } from './ask.ts';
import { type Corpus, passagesOf, readQuestions } from './build.ts';
import type { Passage } from './chunk.ts';
import { EmbeddingCache } from './embed.ts';
import { JUDGE_MODEL, type Judged, judgeAll } from './judge.ts';
import { RerankCache } from './rerank.ts';
import { createRetriever } from './retrieve.ts';

export function buildSnapshot(corpus: Corpus, judged: Judged[]): DocsSnapshot {
  return {
    foedrum: { rev: corpus.rev, revDate: corpus.revDate },
    answerModel: ANSWER_MODEL,
    judgeModel: JUDGE_MODEL,
    entries: judged.map((j) => {
      const ids = new Set(j.question.sources.flatMap((s) => passagesOf(corpus.passages, s.path, s.lines).map((p) => p.id)));
      return {
        id: j.question.id,
        kind: j.question.kind,
        question: j.question.question,
        paraphrased: j.question.paraphrased,
        sourceHit: j.passages.some((p: Passage) => ids.has(p.id)),
        answer: j.reply.text,
        passages: j.passages.map(cited),
        verdict: j.verdict,
      };
    }),
  };
}

if (import.meta.main) {
  const { values } = parseArgs({
    options: {
      data: { type: 'string', default: 'data' },
      questions: { type: 'string', default: 'eval/questions.jsonc' },
      out: { type: 'string', default: 'demo/snapshot/docs.json' },
    },
  });
  const corpus = JSON.parse(readFileSync(join(values.data, 'passages.json'), 'utf8')) as Corpus;
  const retrieve = await createRetriever(corpus.passages, {
    embeddings: new EmbeddingCache(join(values.data, 'embeddings.json')),
    reranks: new RerankCache(join(values.data, 'reranks.json')),
  });
  const questions = readQuestions(values.questions);
  const { answers } = await answerAll(questions, retrieve, new AnswerCache(join(values.data, 'answers.json')), {
    model: ANSWER_MODEL,
    ask: false,
  });
  const { judged } = await judgeAll(answers, new AnswerCache(join(values.data, 'verdicts.json')), { model: JUDGE_MODEL, ask: false });
  if (judged.length !== questions.length) throw new Error(`${judged.length} of ${questions.length} questions are answered and judged in the caches`);
  writeFileSync(values.out, `${JSON.stringify(buildSnapshot(corpus, judged), null, 1)}\n`);
  console.log(`Wrote ${judged.length} answers and verdicts to ${values.out}`);
}
