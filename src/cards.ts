// A card is what the index knows about one source file: where it is, what it exports, what its
// opening comment says it is for, and the rest of its comments. Cards are grouped into modules
// (a folder at a fixed depth), and a module is what a feature request is matched to.

export type Card = {
  path: string;
  module: string;
  exports: string[];
  summary: string;
  comments: string;
};

export type Index = {
  repo: string;
  rev: string;
  revDate: string;
  depth: number;
  cards: Card[];
};

const SUMMARY_LIMIT = 1_500;
const COMMENTS_LIMIT = 6_000;

// `src/engine/fold.ts` at depth 2 is `src/engine`; a file directly in `src/` is `src`.
export function moduleOf(path: string, depth: number): string {
  const parts = path.split('/');
  return parts.slice(0, Math.min(depth, parts.length - 1)).join('/') || '.';
}

export function exportsOf(source: string): string[] {
  const names = new Set<string>();
  const re =
    /export\s+(?:default\s+)?(?:declare\s+)?(?:async\s+)?(?:function\*?|const|let|class|type|interface|enum)\s+([A-Za-z_$][\w$]*)/g;
  for (const m of source.matchAll(re)) names.add(m[1] as string);
  return [...names];
}

// The comment lines at the top of the file, before the first line of code.
export function summaryOf(source: string): string {
  const lines: string[] = [];
  let inBlock = false;
  for (const raw of source.replace(/^﻿/, '').split(/\r?\n/)) {
    const line = raw.trim();
    if (inBlock) {
      lines.push(line.replace(/\*\/$/, '').replace(/^\*\s?/, ''));
      if (line.includes('*/')) inBlock = false;
    } else if (line.startsWith('//')) {
      lines.push(line.replace(/^\/\/+\s?/, ''));
    } else if (line.startsWith('/*')) {
      lines.push(line.replace(/^\/\*+\s?/, '').replace(/\*\/$/, ''));
      inBlock = !line.includes('*/');
    } else if (line === '' || line.startsWith('#!') || line === "'use strict';") {
      if (lines.length > 0 && line === '') break;
    } else {
      break;
    }
  }
  return lines.join(' ').replace(/\s+/g, ' ').trim().slice(0, SUMMARY_LIMIT);
}

// Every `//` and `/* */` comment in the file, joined: code comments often name the concept or
// the decision a request is about.
export function commentsOf(source: string): string {
  const parts: string[] = [];
  for (const m of source.matchAll(/\/\/([^\n]*)|\/\*([\s\S]*?)\*\//g)) {
    parts.push((m[1] ?? m[2] ?? '').replace(/^\s*\*\s?/gm, ''));
  }
  return parts.join(' ').replace(/\s+/g, ' ').trim().slice(0, COMMENTS_LIMIT);
}

export function cardOf(path: string, source: string, depth: number): Card {
  return {
    path,
    module: moduleOf(path, depth),
    exports: exportsOf(source),
    summary: summaryOf(source),
    comments: commentsOf(source),
  };
}
