// node src/eval/prepare.ts --repo <path> --github <owner/name> [--eval 100] [--ref origin/main]
//
// 1. Reads the merged pull requests and the issues of the repository through gh, once, into
//    data/cases.json (delete it to read them again).
// 2. Splits by time: the newest `--eval` cases that change indexed code are the evaluation set.
// 3. Builds the index at the last commit of `--ref` before the first of them, so the index has
//    never seen the code those pull requests wrote: no leakage.

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { buildIndex, writeIndex } from '../build-index.ts';
import { revBefore } from '../git.ts';
import { type Case, casesOf, expectedModules, type GhIssue, type GhPr } from './cases.ts';
import { DEPTH, EXT, INCLUDE } from './evaluate.ts';

function gh<T>(args: string[]): T {
  return JSON.parse(execFileSync('gh', args, { maxBuffer: 512 * 1024 * 1024 }).toString()) as T;
}

function readCases(github: string, limit: number): Case[] {
  console.log(`reading merged pull requests of ${github} …`);
  const prs = gh<GhPr[]>([
    'pr', 'list', '--repo', github, '--state', 'merged', '--limit', String(limit),
    '--json', 'number,mergedAt,files,closingIssuesReferences',
  ]);
  console.log(`reading issues of ${github} …`);
  const issues = gh<GhIssue[]>([
    'issue', 'list', '--repo', github, '--state', 'all', '--limit', String(limit * 2),
    '--json', 'number,title,body',
  ]);
  return casesOf(prs, issues);
}

if (import.meta.main) {
  const { values } = parseArgs({
    options: {
      repo: { type: 'string' },
      github: { type: 'string' },
      eval: { type: 'string', default: '100' },
      ref: { type: 'string', default: 'origin/main' },
      limit: { type: 'string', default: '1000' },
    },
  });
  if (values.repo === undefined || values.github === undefined) {
    console.error('usage: node src/eval/prepare.ts --repo <path> --github <owner/name> [--eval 100]');
    process.exit(2);
  }
  mkdirSync('data', { recursive: true });
  const casesFile = 'data/cases.json';
  if (!existsSync(casesFile)) {
    writeFileSync(casesFile, `${JSON.stringify(readCases(values.github, Number(values.limit)), null, 1)}\n`);
  }
  const cases = JSON.parse(readFileSync(casesFile, 'utf8')) as Case[];
  const useful = cases.filter((c) => expectedModules(c, INCLUDE, EXT, DEPTH).length > 0);
  const evalSet = useful.slice(-Number(values.eval));
  const first = evalSet[0];
  if (first === undefined) throw new Error('no case changes indexed code');
  const rev = revBefore(values.repo, values.ref, first.mergedAt);
  const index = buildIndex({ repo: values.repo, name: values.github, rev, include: INCLUDE, ext: EXT, depth: DEPTH });
  writeIndex(index, 'data/eval-index.json');
  console.log(
    `${cases.length} cases, ${useful.length} change ${INCLUDE.join(',')}; ` +
      `evaluating the newest ${evalSet.length}, merged from ${first.mergedAt}; ` +
      `index at ${rev.slice(0, 8)} (${index.revDate}): ${index.cards.length} files`,
  );
}
