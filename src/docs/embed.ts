// Voyage embeddings over `fetch`, cached by content: a passage is embedded once per model and
// input type, and a run whose texts are all cached makes no call. The key comes from the
// environment (VOYAGE_API_KEY) and is never written anywhere.

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

export const MODEL = 'voyage-4';
// Per request: Voyage takes up to 1,000 texts and 320K tokens for voyage-4; a batch is kept far
// below both, counting a token as 3 characters to be safe.
const BATCH_TEXTS = 128;
const BATCH_CHARS = 300_000;

export type InputType = 'query' | 'document';
export type Fetch = typeof fetch;

export const cacheKey = (model: string, inputType: InputType, text: string): string =>
  createHash('sha256').update(`${model}\0${inputType}\0${text}`).digest('hex');

// Content key to vector. Stored as base64 float32, a quarter of the size of JSON numbers.
export class EmbeddingCache {
  readonly #file: string | undefined;
  readonly #vectors = new Map<string, Float32Array>();
  #dirty = false;

  constructor(file?: string) {
    this.#file = file;
    if (file && existsSync(file)) {
      for (const [k, v] of Object.entries(JSON.parse(readFileSync(file, 'utf8')) as Record<string, string>)) {
        // Copied out of Node's shared buffer pool, where the offset need not be a multiple of 4.
        this.#vectors.set(k, new Float32Array(new Uint8Array(Buffer.from(v, 'base64')).buffer));
      }
    }
  }

  get(key: string): Float32Array | undefined {
    return this.#vectors.get(key);
  }

  set(key: string, vector: Float32Array): void {
    this.#vectors.set(key, vector);
    this.#dirty = true;
  }

  save(): void {
    if (!this.#file || !this.#dirty) return;
    mkdirSync(dirname(this.#file), { recursive: true });
    const out: Record<string, string> = {};
    for (const [k, v] of this.#vectors) out[k] = Buffer.from(v.buffer, v.byteOffset, v.byteLength).toString('base64');
    writeFileSync(this.#file, `${JSON.stringify(out)}\n`);
    this.#dirty = false;
  }
}

// The texts not yet cached, and a rough count of their tokens (4 characters each), for a run to
// say what it would send before it sends anything.
export function uncached(cache: EmbeddingCache, model: string, inputType: InputType, texts: string[]) {
  const missing = [...new Set(texts)].filter((t) => !cache.get(cacheKey(model, inputType, t)));
  return { texts: missing, tokens: Math.ceil(missing.reduce((n, t) => n + t.length, 0) / 4) };
}

// Splits texts into requests under the per-request limits.
export function batches(texts: string[]): string[][] {
  const out: string[][] = [];
  let current: string[] = [];
  let chars = 0;
  for (const t of texts) {
    if (current.length > 0 && (current.length === BATCH_TEXTS || chars + t.length > BATCH_CHARS)) {
      out.push(current);
      current = [];
      chars = 0;
    }
    current.push(t);
    chars += t.length;
  }
  if (current.length > 0) out.push(current);
  return out;
}

type Response = { data: { embedding: number[]; index: number }[]; usage: { total_tokens: number } };

// One request. A 429 waits and tries again, up to three times; any other failure throws.
export async function requestEmbeddings(
  texts: string[],
  inputType: InputType,
  opts: { apiKey: string; model?: string; fetch?: Fetch; wait?: (ms: number) => Promise<void> },
): Promise<{ vectors: Float32Array[]; tokens: number }> {
  const f = opts.fetch ?? fetch;
  const wait = opts.wait ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  for (let attempt = 0; ; attempt++) {
    const res = await f('https://api.voyageai.com/v1/embeddings', {
      method: 'POST',
      headers: { authorization: `Bearer ${opts.apiKey}`, 'content-type': 'application/json' },
      body: JSON.stringify({ input: texts, model: opts.model ?? MODEL, input_type: inputType }),
    });
    const failure = res.ok ? '' : await res.text();
    // An account without a payment method is held to 3 requests and 10K tokens a minute; a batch
    // is larger than that, so waiting does not help.
    if (res.status === 429 && /payment method/i.test(failure)) {
      throw new Error('Voyage embeddings: the account has no payment method, so its rate limit is too low for a batch');
    }
    if (res.status === 429 && attempt < 3) {
      await wait(1000 * 2 ** attempt);
      continue;
    }
    if (!res.ok) throw new Error(`Voyage embeddings: HTTP ${res.status}: ${failure.slice(0, 300)}`);
    const body = (await res.json()) as Response;
    const vectors: Float32Array[] = [];
    for (const d of body.data) vectors[d.index] = normalize(Float32Array.from(d.embedding));
    if (vectors.length !== texts.length || vectors.includes(undefined as unknown as Float32Array)) {
      throw new Error(`Voyage embeddings: ${body.data.length} vectors for ${texts.length} texts`);
    }
    return { vectors, tokens: body.usage.total_tokens };
  }
}

// Every text's vector, from the cache or from Voyage; what was fetched is cached.
export async function embedAll(
  cache: EmbeddingCache,
  texts: string[],
  inputType: InputType,
  opts: { apiKey?: string; model?: string; fetch?: Fetch; wait?: (ms: number) => Promise<void> },
): Promise<{ vectors: Float32Array[]; tokens: number }> {
  const model = opts.model ?? MODEL;
  const missing = uncached(cache, model, inputType, texts).texts;
  let tokens = 0;
  if (missing.length > 0) {
    if (!opts.apiKey) throw new Error(`${missing.length} texts are not cached and VOYAGE_API_KEY is not set`);
    for (const batch of batches(missing)) {
      const got = await requestEmbeddings(batch, inputType, { ...opts, apiKey: opts.apiKey, model });
      batch.forEach((t, i) => cache.set(cacheKey(model, inputType, t), got.vectors[i] as Float32Array));
      tokens += got.tokens;
      cache.save();
    }
  }
  return { vectors: texts.map((t) => cache.get(cacheKey(model, inputType, t)) as Float32Array), tokens };
}

// Scaled to length 1, so a dot product is the cosine; Voyage's documentation does not promise it.
export function normalize(v: Float32Array): Float32Array {
  const n = Math.hypot(...v);
  return n === 0 ? v : v.map((x) => x / n);
}

export function dot(a: Float32Array, b: Float32Array): number {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += (a[i] as number) * (b[i] as number);
  return s;
}
