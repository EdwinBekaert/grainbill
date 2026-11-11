// Okapi BM25 in memory. A few thousand documents score in milliseconds, so there is no
// database and no vector store: at this scale they would be overhead.

export type Doc = { id: string; tokens: string[] };

export class Bm25 {
  readonly #k1: number;
  readonly #b: number;
  readonly #avgLength: number;
  readonly #docs: { id: string; length: number; tf: Map<string, number> }[];
  readonly #df = new Map<string, number>();

  constructor(docs: Doc[], k1 = 1.2, b = 0.75) {
    this.#k1 = k1;
    this.#b = b;
    this.#docs = docs.map((d) => {
      const tf = new Map<string, number>();
      for (const t of d.tokens) tf.set(t, (tf.get(t) ?? 0) + 1);
      for (const t of tf.keys()) this.#df.set(t, (this.#df.get(t) ?? 0) + 1);
      return { id: d.id, length: d.tokens.length, tf };
    });
    const total = this.#docs.reduce((n, d) => n + d.length, 0);
    this.#avgLength = this.#docs.length === 0 ? 0 : total / this.#docs.length;
  }

  idf(term: string): number {
    const n = this.#docs.length;
    const df = this.#df.get(term) ?? 0;
    return Math.log(1 + (n - df + 0.5) / (df + 0.5));
  }

  // Scores every document that holds at least one query term; each distinct term counts once.
  score(query: string[]): Map<string, number> {
    const scores = new Map<string, number>();
    const terms = [...new Set(query)].filter((t) => this.#df.has(t));
    for (const d of this.#docs) {
      let s = 0;
      for (const t of terms) {
        const f = d.tf.get(t);
        if (f === undefined) continue;
        const norm = this.#k1 * (1 - this.#b + (this.#b * d.length) / (this.#avgLength || 1));
        s += this.idf(t) * ((f * (this.#k1 + 1)) / (f + norm));
      }
      if (s > 0) scores.set(d.id, s);
    }
    return scores;
  }
}
