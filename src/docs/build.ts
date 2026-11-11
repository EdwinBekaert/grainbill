// node src/docs/build.ts --repo <path> [--rev <ref>] [--questions eval/questions.jsonc] [--out data/passages.json]
//
// Cuts the documents of one repository at one commit into passages, writes them, and reports their
// sizes and how the question set's cited line ranges fall on them: a source inside one passage can
// be retrieved whole, one spread over several needs them all.

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { parseArgs } from 'node:util';
import { commitDate, listFiles, readFiles, resolveRev } from '../git.ts';
import { type AdrGraph, adrGraph, type Link, successors } from './adr-links.ts';
import { chunk, kindOf, type Passage } from './chunk.ts';
import { parseJsonc, plain } from './jsonc.ts';

export type Corpus = { rev: string; revDate: string; passages: Passage[] };

export type Question = {
  id: string;
  kind: string;
  question: string;
  paraphrased: boolean;
  sources: { path: string; lines: string }[];
};

export function buildCorpus(repo: string, rev: string): Corpus {
  const sha = resolveRev(repo, rev);
  const paths = listFiles(repo, sha).filter((p) => kindOf(p) !== undefined);
  const files = readFiles(repo, sha, paths);
  const passages = [...files].flatMap(([path, source]) => chunk(path, source));
  return { rev: sha, revDate: commitDate(repo, sha), passages };
}

export function readQuestions(file: string): Question[] {
  return plain(parseJsonc(readFileSync(file, 'utf8'))) as Question[];
}

// The passages a cited range overlaps.
export function passagesOf(passages: Passage[], path: string, lines: string): Passage[] {
  const [a, b = a] = lines.split('-').map(Number) as [number, number?];
  return passages.filter((p) => p.path === path && p.start <= b && p.end >= a);
}

function percentile(sorted: number[], q: number): number {
  return sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))] ?? 0;
}

export function report(corpus: Corpus, questions: Question[]): string {
  const out: string[] = [`Foedrum ${corpus.rev.slice(0, 8)} (${corpus.revDate})`, ''];
  out.push('| Kind | Files | Passages | Median chars | 90th pct | Max |', '|---|---|---|---|---|---|');
  const kinds = [...new Set(corpus.passages.map((p) => p.kind))].sort();
  for (const kind of [...kinds, 'all']) {
    const ps = corpus.passages.filter((p) => kind === 'all' || p.kind === kind);
    const sizes = ps.map((p) => p.title.length + p.text.length).sort((x, y) => x - y);
    const files = new Set(ps.map((p) => p.path)).size;
    out.push(
      `| ${kind} | ${files} | ${ps.length} | ${percentile(sizes, 0.5)} | ${percentile(sizes, 0.9)} | ${sizes.at(-1)} |`,
    );
  }
  const counts = questions.flatMap((q) => q.sources.map((s) => passagesOf(corpus.passages, s.path, s.lines).length));
  const by = (n: (c: number) => boolean) => counts.filter(n).length;
  out.push(
    '',
    `Question sources: ${counts.length}; inside one passage ${by((c) => c === 1)}, ` +
      `over two ${by((c) => c === 2)}, over three or more ${by((c) => c >= 3)}, on no passage ${by((c) => c === 0)}.`,
  );
  out.push('', adrReport(adrGraph(adrStatuses(corpus.passages)), questions));
  return out.join('\n');
}

// Each ADR's status line, by number.
export function adrStatuses(passages: Passage[]): Map<string, string> {
  return new Map(passages.flatMap((p) => (p.adr ? [[p.adr.number, p.adr.status] as const] : [])));
}

const adrOf = (path: string) => /^docs\/adr\/(\d{4})-/.exec(path)?.[1];

// The links by kind, and whether each amended question's later ADR is found from its earlier one.
export function adrReport(graph: AdrGraph, questions: Question[]): string {
  const count = (f: (l: Link) => boolean) => graph.links.filter(f).length;
  const out = [
    `ADR links: ${graph.links.length} (amends ${count((l) => l.kind === 'amends')}, ` +
      `supersedes ${count((l) => l.kind === 'supersedes' && !l.partly)}, partly supersedes ${count((l) => !!l.partly)}, ` +
      `generalises ${count((l) => l.kind === 'generalises')}, extends ${count((l) => l.kind === 'extends')}); ` +
      `${count((l) => l.scopes.length > 0)} say what they change, ${graph.oneSided.length} are stated by one of their two ADRs only, ` +
      `${graph.later.size} ADRs were changed by a later one.`,
  ];
  const amended = questions.filter((q) => q.kind === 'amended');
  const found = amended.filter((q) => {
    const ns = [...new Set(q.sources.map((s) => adrOf(s.path)).filter((n) => n !== undefined))];
    // The cited ADR that no other cited ADR changed is the earlier one; every other must follow it.
    const earliest = ns.filter((n) => !ns.some((m) => successors(graph, m).includes(n)));
    return earliest.length === 1 && ns.every((n) => n === earliest[0] || successors(graph, earliest[0] as string).includes(n));
  });
  out.push(`Amended questions whose later cited ADRs all follow the earlier one in the graph: ${found.length} of ${amended.length}.`);
  return out.join('\n');
}

if (import.meta.main) {
  const { values } = parseArgs({
    options: {
      repo: { type: 'string' },
      rev: { type: 'string', default: 'HEAD' },
      questions: { type: 'string', default: 'eval/questions.jsonc' },
      out: { type: 'string', default: 'data/passages.json' },
    },
  });
  if (!values.repo) throw new Error('--repo <path> is required');
  const corpus = buildCorpus(values.repo, values.rev);
  mkdirSync(dirname(values.out), { recursive: true });
  writeFileSync(values.out, `${JSON.stringify(corpus)}\n`);
  console.log(report(corpus, readQuestions(values.questions)));
  console.log(`\nWrote ${corpus.passages.length} passages to ${values.out}`);
}
