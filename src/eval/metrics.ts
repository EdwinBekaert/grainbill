// Set-based retrieval metrics for one case: the modules the pull request changed (expected)
// against the ranked modules a retriever returned (predicted).

export function recallAt(expected: string[], predicted: string[], k: number): number {
  if (expected.length === 0) return 0;
  const top = new Set(predicted.slice(0, k));
  return expected.filter((m) => top.has(m)).length / expected.length;
}

export function precisionAt(expected: string[], predicted: string[], k: number): number {
  const top = predicted.slice(0, k);
  if (top.length === 0) return 0;
  const want = new Set(expected);
  return top.filter((m) => want.has(m)).length / top.length;
}

// F-beta with beta 2: recall weighs four times precision, since a module the plan misses costs
// a round back, and an extra one costs a look.
export function f2At(expected: string[], predicted: string[], k: number): number {
  const p = precisionAt(expected, predicted, k);
  const r = recallAt(expected, predicted, k);
  return p + r === 0 ? 0 : (5 * p * r) / (4 * p + r);
}

export function hitAt1(expected: string[], predicted: string[]): number {
  return predicted.length > 0 && expected.includes(predicted[0] as string) ? 1 : 0;
}

export const mean = (xs: number[]): number => (xs.length === 0 ? 0 : xs.reduce((a, b) => a + b, 0) / xs.length);
