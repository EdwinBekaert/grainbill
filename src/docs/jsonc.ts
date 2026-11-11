// A JSONC reader that keeps where each value sits: its first and last line, and the comments
// written before it. Recipes explain their steps in comments, so a step's passage needs both.

export type Node =
  | { type: 'object'; start: number; end: number; comments: Comment[]; entries: [string, Node][] }
  | { type: 'array'; start: number; end: number; comments: Comment[]; items: Node[] }
  | { type: 'value'; start: number; end: number; comments: Comment[]; value: string | number | boolean | null };

// A comment's text without its `//` or `/* */`, and the line it starts on.
export type Comment = { line: number; text: string };

export function parseJsonc(source: string): Node {
  let at = 0;
  let line = 1;
  let pending: Comment[] = [];

  const fail = (what: string): never => {
    throw new Error(`JSONC: ${what} at line ${line}`);
  };
  const advance = (n: number) => {
    for (let i = 0; i < n; i++) if (source[at + i] === '\n') line++;
    at += n;
  };
  const match = (re: RegExp) => {
    re.lastIndex = at;
    return re.exec(source);
  };
  // Skips white space, collecting the comments in it for the next value.
  const skip = () => {
    for (;;) {
      const m = match(/\s+/y);
      if (m) advance(m[0].length);
      if (source.startsWith('//', at)) {
        const eol = source.indexOf('\n', at);
        const stop = eol === -1 ? source.length : eol;
        pending.push({ line, text: source.slice(at + 2, stop).trim() });
        advance(stop - at);
      } else if (source.startsWith('/*', at)) {
        const close = source.indexOf('*/', at + 2);
        if (close === -1) fail('unclosed comment');
        pending.push({ line, text: source.slice(at + 2, close).replace(/^\s*\*?\s?/gm, '').trim() });
        advance(close + 2 - at);
      } else return;
    }
  };
  const take = () => {
    const c = pending;
    pending = [];
    return c;
  };

  const value = (): Node => {
    skip();
    const comments = take();
    const start = line;
    const c = source[at];
    if (c === '{') {
      advance(1);
      const entries: [string, Node][] = [];
      for (;;) {
        skip();
        if (source[at] === '}') break;
        const keyComments = take();
        if (source[at] !== '"') fail('expected a key');
        const key = string();
        skip();
        if (source[at] !== ':') fail('expected ":"');
        advance(1);
        const node = value();
        // A comment above a key belongs to the value of that key.
        node.comments.unshift(...keyComments);
        entries.push([key, node]);
        skip();
        if (source[at] === ',') advance(1);
        else if (source[at] !== '}') fail('expected "," or "}"');
      }
      take();
      advance(1);
      return { type: 'object', start, end: line, comments, entries };
    }
    if (c === '[') {
      advance(1);
      const items: Node[] = [];
      for (;;) {
        skip();
        if (source[at] === ']') break;
        items.push(value());
        skip();
        if (source[at] === ',') advance(1);
        else if (source[at] !== ']') fail('expected "," or "]"');
      }
      take();
      advance(1);
      return { type: 'array', start, end: line, comments, items };
    }
    if (c === '"') return { type: 'value', start, end: line, comments, value: string() };
    const m = match(/true|false|null|-?\d+(\.\d+)?([eE][+-]?\d+)?/y);
    if (!m) return fail('unexpected character');
    advance(m[0].length);
    return { type: 'value', start, end: line, comments, value: JSON.parse(m[0]) };
  };

  const string = (): string => {
    const m = match(/"(?:[^"\\\n]|\\.)*"/y);
    if (!m) return fail('unclosed string');
    advance(m[0].length);
    return JSON.parse(m[0]) as string;
  };

  // Comments before the root, such as a recipe's header, stay on the root.
  const root = value();
  skip();
  if (at < source.length) fail('text after the value');
  return root;
}

// The plain value of a node, comments dropped.
export function plain(node: Node): unknown {
  if (node.type === 'value') return node.value;
  if (node.type === 'array') return node.items.map(plain);
  return Object.fromEntries(node.entries.map(([k, v]) => [k, plain(v)]));
}

export function field(node: Node, key: string): Node | undefined {
  return node.type === 'object' ? node.entries.find(([k]) => k === key)?.[1] : undefined;
}

// Every comment inside a node, in order.
export function commentsIn(node: Node): Comment[] {
  const own = [...node.comments];
  if (node.type === 'object') for (const [, v] of node.entries) own.push(...commentsIn(v));
  if (node.type === 'array') for (const v of node.items) own.push(...commentsIn(v));
  return own;
}
