// The links between ADRs, read from their status lines: "Amends [0045](…) (what the gate runs) ·
// Amended by [0249](…) · Partly superseded by [0274](…)". An ADR is never edited, so what it
// decided may have been changed by a later one; the graph lets an answer find the later ADRs and
// tell the record that holds now from the history.

export type LinkKind = 'amends' | 'supersedes' | 'generalises' | 'extends';

// `from` (the later ADR) amends, supersedes, generalises or extends `to`.
export type Link = {
  from: string;
  to: string;
  kind: LinkKind;
  // Only part of `to` is superseded: "Partly superseded by", "[0008]'s client", "the cost parts of".
  partly?: boolean;
  // What the link changes, as the status line says it: "(what the gate runs before `git push`)".
  scopes: string[];
};

const VERBS: [RegExp, LinkKind, 'out' | 'in', boolean][] = [
  [/^partly superseded by\b/i, 'supersedes', 'in', true],
  [/^superseded by\b/i, 'supersedes', 'in', false],
  [/^supersedes\b/i, 'supersedes', 'out', false],
  [/^amended by\b/i, 'amends', 'in', false],
  [/^amends\b/i, 'amends', 'out', false],
  [/^generalised by\b/i, 'generalises', 'in', false],
  [/^generalises\b/i, 'generalises', 'out', false],
  [/^extended by\b/i, 'extends', 'in', false],
  [/^extends\b/i, 'extends', 'out', false],
];

// The links one status line states, `number` being its own ADR. A link is read under the last
// relation word before it in its clause; clauses are split at ` · ` and `;` outside brackets.
// Words without a relation of these kinds ("follows", "narrows #388") link nothing.
export function parseStatus(number: string, status: string): Link[] {
  const links: Link[] = [];
  let verb: (typeof VERBS)[number] | undefined;
  let depth = 0;
  let last: Link | undefined;
  // Text since the last link, to read "the cost parts of" before a link.
  let before = '';
  for (let i = 0; i < status.length; ) {
    const rest = status.slice(i);
    const c = status[i] as string;
    if (depth === 0) {
      if (c === ';' || rest.startsWith(' · ')) {
        verb = undefined;
        last = undefined;
        before = '';
        i += c === ';' ? 1 : 3;
        continue;
      }
      const v = /^[A-Za-z]/.test(c) && /[^A-Za-z]$|^$/.test(status.slice(Math.max(0, i - 1), i))
        ? VERBS.find(([re]) => re.test(rest))
        : undefined;
      if (v) {
        verb = v;
        last = undefined;
        before = '';
        i += (v[0].exec(rest)?.[0] as string).length;
        continue;
      }
      const link = /^\[(\d{4})\]\([^)]*\)/.exec(rest);
      if (link) {
        last = undefined;
        if (verb && link[1] !== number) {
          const [, kind, direction, partly] = verb;
          const other = link[1] as string;
          const [from, to] = direction === 'out' ? [number, other] : [other, number];
          // "[0008]'s client over `fetch`": the part named after the possessive is the scope.
          const after = /^'s ([^·;(]*?)(?=\s*\(|,? and \[|, \[| · |;|$)/.exec(status.slice(i + link[0].length));
          const part = partly || /\bparts? of\s*$/i.test(before) || after !== null;
          last = { from, to, kind, ...(part && kind === 'supersedes' ? { partly: true } : {}), scopes: [] };
          if (after?.[1]?.trim()) last.scopes.push(after[1].trim());
          links.push(last);
          if (after) i += after[0].length;
        }
        before = '';
        i += link[0].length;
        continue;
      }
    }
    // A bracket right after a link, spaces between, says what the link changes.
    if (c === '(' && depth === 0 && last && /^\s*$/.test(before)) {
      const close = closing(status, i);
      last.scopes.push(status.slice(i + 1, close).trim());
      last = undefined;
      i = close + 1;
      continue;
    }
    if (c === '(') depth++;
    else if (c === ')' && depth > 0) depth--;
    before += c;
    i++;
  }
  return links;
}

// The index of the bracket that closes the one at `open`.
function closing(s: string, open: number): number {
  let depth = 0;
  for (let i = open; i < s.length; i++) {
    if (s[i] === '(') depth++;
    else if (s[i] === ')' && --depth === 0) return i;
  }
  return s.length;
}

export type AdrGraph = {
  // Every link once, both ADRs' status lines merged.
  links: Link[];
  // The links to an ADR from later ones, and from it to earlier ones.
  later: Map<string, Link[]>;
  earlier: Map<string, Link[]>;
  // Links that only one of the two ADRs states.
  oneSided: Link[];
};

// The graph of all ADRs from their status lines, number to status.
export function adrGraph(statuses: Map<string, string>): AdrGraph {
  const byKey = new Map<string, { link: Link; sides: Set<string> }>();
  for (const [number, status] of statuses) {
    for (const link of parseStatus(number, status)) {
      // Only links between ADRs the corpus holds.
      if (!statuses.has(link.from) || !statuses.has(link.to)) continue;
      const key = `${link.from}>${link.to}>${link.kind}`;
      const seen = byKey.get(key);
      if (!seen) byKey.set(key, { link, sides: new Set([number]) });
      else {
        seen.sides.add(number);
        if (link.partly) seen.link.partly = true;
        for (const s of link.scopes) if (!seen.link.scopes.includes(s)) seen.link.scopes.push(s);
      }
    }
  }
  const links = [...byKey.values()].map((v) => v.link);
  const later = new Map<string, Link[]>();
  const earlier = new Map<string, Link[]>();
  for (const link of links) {
    later.set(link.to, [...(later.get(link.to) ?? []), link]);
    earlier.set(link.from, [...(earlier.get(link.from) ?? []), link]);
  }
  const oneSided = [...byKey.values()].filter((v) => v.sides.size === 1).map((v) => v.link);
  return { links, later, earlier, oneSided };
}

// Every ADR that changed `number`, directly or through another later ADR, by number (which is not
// the order they were decided in: 0079 amends 0084).
export function successors(graph: AdrGraph, number: string): string[] {
  const seen = new Set<string>();
  const visit = (n: string) => {
    for (const link of graph.later.get(n) ?? []) {
      if (seen.has(link.from)) continue;
      seen.add(link.from);
      visit(link.from);
    }
  };
  visit(number);
  return [...seen].sort();
}

// Whether `number` still holds as a whole: no later ADR supersedes all of it.
export function isCurrent(graph: AdrGraph, number: string): boolean {
  return !(graph.later.get(number) ?? []).some((l) => l.kind === 'supersedes' && !l.partly);
}
