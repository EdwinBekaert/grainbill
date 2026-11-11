// Cuts Foedrum's documents into passages, the unit that is retrieved and cited. Markdown is cut
// at every heading, and a passage keeps its file's place and its headings as a breadcrumb
// ("engine › fold › The fold and the guard"); design pages hold one sentence per line, so a
// passage's line range is a precise citation. A recipe becomes one passage for its header and one
// per step, written out with the comments that explain it, never as raw JSON.

import { type Comment, commentsIn, field, type Node, parseJsonc, plain } from './jsonc.ts';

export type Kind = 'design' | 'doc' | 'adr' | 'recipe' | 'brewer' | 'lens';

export type Passage = {
  // `<path>:<start>-<end>`, unique within one commit.
  id: string;
  path: string;
  kind: Kind;
  // The breadcrumb: where the passage sits, then its headings.
  title: string;
  // Lines in the file, 1-based and inclusive.
  start: number;
  end: number;
  text: string;
  // An ADR's number and its status line after "Status: ", on each of its passages.
  adr?: { number: string; status: string };
};

const SEP = ' › ';

// The documents a question may be answered from; anything else at the commit is left out.
export function kindOf(path: string): Kind | undefined {
  if (/^docs\/adr\/\d{4}-[^/]+\.md$/.test(path)) return 'adr';
  if (/^docs\/design\/.+\.md$/.test(path)) return 'design';
  if (/^docs\/(milestones\/)?[^/]+\.md$/.test(path) || /^(README|ROADMAP|SECURITY)\.md$/.test(path)) return 'doc';
  if (/^defaults\/recipes\/[^/]+\.jsonc$/.test(path)) return 'recipe';
  if (/^defaults\/brewers\/[^/]+\.md$/.test(path)) return 'brewer';
  if (/^defaults\/lenses\/.+\.md$/.test(path)) return 'lens';
  return undefined;
}

// Where a file sits, as the start of its passages' breadcrumbs.
export function placeOf(path: string, kind: Kind): string {
  const stem = path.replace(/\.(md|jsonc)$/, '');
  switch (kind) {
    case 'adr':
      return `ADR ${/\/(\d{4})-/.exec(path)?.[1]}`;
    case 'design':
      return stem.replace(/^docs\/design\//, '').replace(/\/README$/, '').split('/').join(SEP);
    case 'doc':
      return stem.replace(/^docs\//, '').split('/').join(SEP);
    case 'recipe':
      return `recipe ${stem.replace(/^defaults\/recipes\//, '')}`;
    case 'brewer':
      return `brewer ${stem.replace(/^defaults\/brewers\//, '')}`;
    case 'lens':
      return `lens ${stem.replace(/^defaults\/lenses\//, '')}`;
  }
}

export function chunk(path: string, source: string): Passage[] {
  const kind = kindOf(path);
  if (!kind) return [];
  const place = placeOf(path, kind);
  if (kind === 'recipe') return chunkRecipe(path, place, source);
  const passages = chunkMarkdown(path, kind, place, source);
  if (kind === 'adr') {
    const status = /^Date: .*?Status: (.+)$/m.exec(source)?.[1]?.trim() ?? '';
    const number = place.slice('ADR '.length);
    for (const p of passages) {
      p.adr = { number, status };
      // "ADR 0249 › 0249. The push gate…" says the number once.
      p.title = p.title.replace(`${SEP}${number}. `, SEP);
    }
  }
  return passages;
}

function passage(path: string, kind: Kind, title: string, start: number, end: number, text: string): Passage {
  return { id: `${path}:${start}-${end}`, path, kind, title, start, end, text };
}

export function chunkMarkdown(path: string, kind: Kind, place: string, source: string): Passage[] {
  const lines = source.split('\n');
  const passages: Passage[] = [];
  let first = 0;

  // A JSON frontmatter between `---` lines (brewers) is a passage of its own, written out.
  if (lines[0] === '---') {
    const close = lines.indexOf('---', 1);
    if (close > 0) {
      const settings = plain(parseJsonc(lines.slice(1, close).join('\n')));
      passages.push(passage(path, kind, place + SEP + 'settings', 1, close + 1, render(settings)));
      first = close + 1;
    }
  }

  const headings: string[] = [];
  let fence: string | undefined;
  let start = first;
  let headed = false;
  let chain: string[] = [];
  const flush = (stop: number) => {
    // The heading itself goes into the title; a section with nothing under it is no passage.
    const title = [place, ...chain].join(SEP);
    pieces(lines, headed ? start + 1 : start, stop).forEach(([a, b], n) => {
      // The first piece's range starts at the heading, which the citation covers too.
      const from = n === 0 ? start : a;
      const text = lines.slice(a, b).join('\n').trim();
      if (text !== '') passages.push(passage(path, kind, title, from + 1, b, text));
    });
  };
  for (let i = first; i < lines.length; i++) {
    const line = lines[i] as string;
    const f = /^\s*(```|~~~)/.exec(line);
    if (f) fence = fence === undefined ? f[1] : fence === f[1] ? undefined : fence;
    if (fence !== undefined) continue;
    const h = /^(#{1,6})\s+(.+?)\s*#*\s*$/.exec(line);
    if (!h) continue;
    flush(i);
    const level = (h[1] as string).length;
    headings.length = level - 1;
    headings[level - 1] = h[2] as string;
    chain = headings.filter((x) => x !== undefined);
    start = i;
    headed = true;
  }
  flush(lines.length);
  return passages;
}

// A section longer than this is cut into pieces of about this size.
export const PIECE_CHARS = 1_500;

// Cuts lines [from, to) into pieces of at most about PIECE_CHARS: whole paragraphs where they fit,
// else line by line, which on a page of one sentence per line cuts between sentences. A fenced
// block counts as one paragraph, blank lines included. A single line is never cut, so a passage
// of one long line (a wide table row) may pass the size. Returns [start, end) line indexes.
export function pieces(lines: string[], from: number, to: number): [number, number][] {
  const units: [number, number][] = [];
  let i = from;
  while (i < to) {
    if ((lines[i] as string).trim() === '') {
      i++;
      continue;
    }
    let j = i;
    let fence: string | undefined;
    while (j < to && (fence !== undefined || (lines[j] as string).trim() !== '')) {
      const f = /^\s*(```|~~~)/.exec(lines[j] as string);
      if (f) fence = fence === undefined ? f[1] : fence === f[1] ? undefined : fence;
      j++;
    }
    const size = lines.slice(i, j).join('\n').length;
    if (size > PIECE_CHARS) {
      for (let k = i; k < j; k++) units.push([k, k + 1]);
    } else units.push([i, j]);
    i = j;
  }
  const out: [number, number][] = [];
  let size = 0;
  for (const [a, b] of units) {
    const n = lines.slice(a, b).join('\n').length;
    const last = out.at(-1);
    if (last && size + n <= PIECE_CHARS) {
      last[1] = b;
      size += n;
    } else {
      out.push([a, b]);
      size = n;
    }
  }
  return out;
}

export function chunkRecipe(path: string, place: string, source: string): Passage[] {
  const root = parseJsonc(source);
  const recipe = plain(root) as { name?: string; type?: string; description?: string };
  const steps = field(root, 'steps');
  const passages: Passage[] = [];

  // The header comment and what the recipe says of itself.
  const headerEnd = steps ? firstLine(steps) - 1 : root.end;
  const about = [recipe.type && `type ${recipe.type}`, recipe.description].filter(Boolean).join(': ');
  passages.push(
    passage(path, 'recipe', place, 1, headerEnd, [prose(root.comments), about].filter(Boolean).join('\n')),
  );

  const walk = (items: Node[], chain: string[]) => {
    items.forEach((step, i) => {
      const value = plain(step) as Record<string, unknown>;
      const name = String(value.id ?? value.action ?? `step ${i + 1}`);
      const group = field(step, 'parallel');
      const { parallel, id, ...rest } = value;
      const title = [place, ...chain, name].join(SEP);
      if (group?.type === 'array') {
        // The group's own words; each member is a passage of its own.
        const own = step.type === 'object' ? step.entries.filter(([k]) => k !== 'parallel') : [];
        const comments = [...step.comments, ...own.flatMap(([, v]) => commentsIn(v))];
        const members = (parallel as Record<string, unknown>[]).map((m) => m.id).join(', ');
        const text = [`runs side by side: ${members}`, render(rest), prose(comments)].filter(Boolean).join('\n');
        passages.push(passage(path, 'recipe', title, firstLine(step), group.start, text));
        walk(group.items, [...chain, name]);
        return;
      }
      const text = [render(rest), prose(commentsIn(step))].filter(Boolean).join('\n');
      passages.push(passage(path, 'recipe', title, firstLine(step), step.end, text));
    });
  };
  if (steps?.type === 'array') walk(steps.items, []);
  return passages;
}

// A node's first line, counting the comments written above it.
function firstLine(node: Node): number {
  return Math.min(node.start, ...node.comments.map((c) => c.line));
}

// Comments as sentences: wrapped comment lines joined back together.
function prose(comments: Comment[]): string {
  return comments
    .map((c) => c.text)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// A JSON value as words: `{ "goto": "gauge", "maxRounds": 1 }` is "goto gauge, maxRounds 1", and
// an object inside another value is wrapped in brackets.
export function render(value: unknown): string {
  if (Array.isArray(value)) return value.map(nested).join(', ');
  if (value !== null && typeof value === 'object') {
    return Object.entries(value)
      .filter(([k]) => k !== '$schema')
      .map(([k, v]) => `${k} ${nested(v)}`)
      .join(', ');
  }
  return String(value);
}

function nested(value: unknown): string {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? `(${render(value)})` : render(value);
}
