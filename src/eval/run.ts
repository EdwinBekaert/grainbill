// node src/eval/run.ts [--eval 100] [--data data]
//
// Scores every retriever on the evaluation set that prepare.ts split off, and prints one
// markdown table (also written to <data>/results.md).

import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import type { Index } from '../cards.ts';
import type { Case } from './cases.ts';
import { evaluate, table } from './evaluate.ts';

if (import.meta.main) {
  const { values } = parseArgs({
    options: { eval: { type: 'string', default: '100' }, data: { type: 'string', default: 'data' } },
  });
  const index = JSON.parse(readFileSync(join(values.data, 'eval-index.json'), 'utf8')) as Index;
  const cases = JSON.parse(readFileSync(join(values.data, 'cases.json'), 'utf8')) as Case[];
  const text = table(evaluate(index, cases, Number(values.eval)));
  writeFileSync(join(values.data, 'results.md'), text);
  console.log(text);
}
