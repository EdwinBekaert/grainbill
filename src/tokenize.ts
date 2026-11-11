// Turns text and code into search terms: identifiers are split on camelCase and punctuation,
// so `handoverOf` and "the handover of a brewer" meet on the same terms.

const STOP = new Set(
  (
    'a an and are as at be by can do does for from has have if in into is it its not of on or ' +
    'that the their then there these this to was when which while will with without would ' +
    'const let var function return import export type interface class new true false null ' +
    'undefined void async await string number boolean readonly'
  ).split(' '),
);

export function tokenize(text: string): string[] {
  return text
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .map((t) => (/^\d+$/.test(t) ? t.replace(/^0+(?=\d)/, '') : stem(t)))
    .filter((t) => t.length > 1 && !STOP.has(t));
}

// Crude plural folding: enough for "batches"/"batch" and "entries"/"entry", nothing more.
function stem(t: string): string {
  if (t.length > 4 && t.endsWith('ies')) return `${t.slice(0, -3)}y`;
  if (t.length > 4 && /(ch|sh|x|ss)es$/.test(t)) return t.slice(0, -2);
  if (t.length > 3 && t.endsWith('s') && !t.endsWith('ss')) return t.slice(0, -1);
  return t;
}
