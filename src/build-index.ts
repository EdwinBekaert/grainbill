// node src/build-index.ts --repo <path> [--name <owner/name>] [--rev <ref>] [--include src/] [--ext .ts] [--depth 2] [--out data/index.json]
//
// Builds the card index of one repository at one commit.

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { parseArgs } from 'node:util';
import { type Card, cardOf, type Index } from './cards.ts';
import { commitDate, listFiles, readFiles, resolveRev } from './git.ts';

export type BuildOptions = {
  repo: string;
  // How the index names the repository, such as owner/name; the path when absent.
  name?: string;
  rev: string;
  include: string[];
  ext: string[];
  depth: number;
};

export function buildIndex(o: BuildOptions): Index {
  const rev = resolveRev(o.repo, o.rev);
  const paths = listFiles(o.repo, rev).filter(
    (p) =>
      o.include.some((prefix) => p.startsWith(prefix)) &&
      o.ext.some((e) => p.endsWith(e)) &&
      !p.endsWith('.d.ts'),
  );
  const sources = readFiles(o.repo, rev, paths);
  const cards: Card[] = [...sources].map(([path, source]) => cardOf(path, source, o.depth));
  return { repo: o.name ?? o.repo, rev, revDate: commitDate(o.repo, rev), depth: o.depth, cards };
}

export function writeIndex(index: Index, out: string): void {
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, `${JSON.stringify(index)}\n`);
}

if (import.meta.main) {
  const { values } = parseArgs({
    options: {
      repo: { type: 'string' },
      name: { type: 'string' },
      rev: { type: 'string', default: 'HEAD' },
      include: { type: 'string', multiple: true, default: ['src/'] },
      ext: { type: 'string', multiple: true, default: ['.ts'] },
      depth: { type: 'string', default: '2' },
      out: { type: 'string', default: 'data/index.json' },
    },
  });
  if (values.repo === undefined) {
    console.error('usage: node src/build-index.ts --repo <path> [--rev <ref>] [--out <file>]');
    process.exit(2);
  }
  const index = buildIndex({
    repo: values.repo,
    name: values.name,
    rev: values.rev,
    include: values.include,
    ext: values.ext,
    depth: Number(values.depth),
  });
  writeIndex(index, values.out);
  const modules = new Set(index.cards.map((c) => c.module)).size;
  console.log(
    `${values.out}: ${index.cards.length} files in ${modules} modules at ${index.rev.slice(0, 8)} (${index.revDate})`,
  );
}
