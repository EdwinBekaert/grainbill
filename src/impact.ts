// Ranks the modules a feature request touches: BM25 scores each file's card, and a module scores
// the sum of its best few files, so one strong file counts and a large module does not win on
// size alone. Every module comes back with the files that put it there: the evidence.

import { Bm25 } from './bm25.ts';
import type { Card, Index } from './cards.ts';
import { tokenize } from './tokenize.ts';

// What of a card is searched. Each variant is one row of the evaluation table.
export const VARIANTS = ['paths', 'cards', 'cards+comments'] as const;
export type Variant = (typeof VARIANTS)[number];

export type FileHit = { path: string; score: number; exports: string[]; summary: string };
export type ModuleHit = { module: string; score: number; files: FileHit[] };

export function cardText(card: Card, variant: Variant): string {
  const path = card.path.replace(/\.[^.]+$/, '');
  switch (variant) {
    case 'paths':
      return path;
    case 'cards':
      return [path, card.exports.join(' '), card.summary].join(' ');
    case 'cards+comments':
      return [path, card.exports.join(' '), card.summary, card.comments].join(' ');
    default: {
      const never: never = variant;
      throw new Error(`unknown variant ${never}`);
    }
  }
}

export type ImpactOptions = { top?: number; perModule?: number };

export function createImpact(
  index: Index,
  variant: Variant = 'cards+comments',
): (request: string, options?: ImpactOptions) => ModuleHit[] {
  const byPath = new Map(index.cards.map((c) => [c.path, c]));
  const bm25 = new Bm25(index.cards.map((c) => ({ id: c.path, tokens: tokenize(cardText(c, variant)) })));
  return (request, { top = 5, perModule = 3 } = {}) => {
    const byModule = new Map<string, FileHit[]>();
    for (const [path, score] of bm25.score(tokenize(request))) {
      const card = byPath.get(path) as Card;
      const hits = byModule.get(card.module) ?? [];
      hits.push({ path, score, exports: card.exports, summary: card.summary });
      byModule.set(card.module, hits);
    }
    return [...byModule]
      .map(([module, files]) => {
        const best = files.sort((a, b) => b.score - a.score).slice(0, perModule);
        return { module, score: best.reduce((s, f) => s + f.score, 0), files: best };
      })
      .sort((a, b) => b.score - a.score)
      .slice(0, top);
  };
}
