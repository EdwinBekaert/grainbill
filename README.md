# Grain Bill

Keyword search (BM25) that ranks which folders of a codebase an issue is likely to touch, exposed to Claude Code as an MCP tool.
Built for [Foedrum](https://github.com/EdwinBekaert/foedrum), whose planner has to know where a feature lives.

## What it is

- One text blob per source file: its path, its exported names and its comments.
- BM25 scores every file against the issue's words; a folder scores the sum of its three best files.
- An MCP server (stdio, written by hand, no dependencies) with one tool, `impact(request)`, returning the top folders and the files behind them.
- An evaluation on 100 past Foedrum issues against the folders their pull requests changed, with the index built from code older than those pull requests.
- An offline demo: `npm run demo`.

## What it is not

- Not RAG yet: nothing generates an answer from what is found. Claude may, after calling the tool, but that is not built or measured here.
- The code search uses no embeddings, no chunking beyond one blob per file, no reranking, no model of any kind. The document search of M2 so far finds passages (BM25, Voyage embeddings, their fusion, a reranker); it does not answer yet.
- Not a strong result: there are only 9 folders, and always answering with the three busiest already finds 70% of them.

## What it demonstrates

**M1, built:**

- **Information retrieval fundamentals**: BM25 implemented from the formula, a tokenizer for code and prose (identifier splitting, plural folding, stop words), and score aggregation from files to modules.
- **Evaluation design**: labelled cases mined from real history (an issue is the question, its pull request's changed files are the answer), a time split that keeps the index from seeing the answers, a no-search baseline, and metrics chosen for the task (Hit@1, Recall@k, recall-weighted F2).
- **Honest reporting**: the results table says what the numbers do not prove.
- **The Model Context Protocol from the wire up**: JSON-RPC 2.0 over stdio, version negotiation, tool listing and calling, tool errors versus protocol errors, without the SDK.
- **Supply-chain hygiene**: zero runtime dependencies, no install scripts, no package younger than 7 days, exact versions, signature checks.
- **Engineering basics**: TypeScript run directly by Node, pure cores tested with plain data, git read at a commit instead of the working tree, an offline reproducible demo.

**M2, planned:**

- **Chunking strategies** fitted to each kind of document.
- **Hybrid retrieval**: lexical and dense search merged by reciprocal rank fusion, then a cross-encoder reranker, each stage measured.
- **Grounded generation**: answers only from retrieved passages, a citation for every claim, and a refusal when the documents do not cover the question.
- **Stale knowledge**: decisions superseded by later ones, resolved through the links between documents.
- **Evaluating answers, not just search**: correctness, faithfulness and refusals judged by a model, checked by hand on a sample.
- **Cost control**: cheap models where they suffice, cached embeddings and answers, cents per evaluation run.

## Milestones

- **M1** (this version): keyword search over code, the evaluation, the MCP server and the demo.
- **M2**: questions answered from Foedrum's documents with hybrid search, a reranker, cited answers and an evaluation of the answers. The plan is in [docs/what-and-why.md](docs/what-and-why.md#m2-questions-answered-from-foedrums-documents).

## Results

### M1: which folders an issue touches

| Search | Hit@1 | Recall@3 | Recall@5 |
|---|---|---|---|
| no search: the busiest folders | 76.0% | 70.1% | 83.4% |
| BM25 over file paths | 84.0% | 72.6% | 87.9% |
| BM25 over paths, exports, comments | 89.0% | 82.6% | 94.6% |

### M2: finding a question's sources among Foedrum's passages

The 42 answerable questions of [eval/questions.jsonc](eval/questions.jsonc) (97 sources) against 3,561 passages of Foedrum at `2d64a6e3`, run on 2026-11-11.

| Search | Recall@5 | All@5 | Recall@30 | MRR@30 |
|---|---|---|---|---|
| BM25 over passage text | 20.2% | 9.5% | 43.3% | 0.26 |
| BM25 over breadcrumb title and text | 27.0% | 19.0% | 49.4% | 0.30 |
| the same, each ADR followed by the ADRs that later changed it | 23.8% | 16.7% | 28.2% | 0.25 |
| Voyage `voyage-4` embeddings of title and text, by cosine | 50.8% | 35.7% | 74.2% | 0.46 |
| BM25 (title and text) and `voyage-4`, by reciprocal rank fusion (k = 60) | 44.2% | 23.8% | 70.2% | 0.44 |
| `voyage-4`, its top 30 reranked by Voyage `rerank-3-lite` | 58.9% | 40.5% | 74.2% | 0.57 |
| the fusion, its top 30 reranked by `rerank-3-lite` | 60.1% | 40.5% | 70.2% | 0.58 |

Recall@k: the share of a question's sources with a passage in the top k (the answer is to be built from the top 5; a reranker would reorder the top 30).
All@5: every source of the question in the top 5.
MRR@30: one over the rank of the first source found.

What the numbers say:

- Keyword search alone finds a quarter of the sources an answer needs. It finds 46.5% for questions that share words with their source, and 10.9% for the 23 worded with few of them.
- Following the links between ADRs made it worse: an ADR in the results brings every ADR that later changed it, and those push the other sources down (design-01's source falls from rank 4 to 261). For the 10 amended questions it changed nothing at 5, since the older ADR is rarely in the top 5 to begin with.
- Embeddings find about twice as many sources as keyword search at 5 (50.8% against 27.0%), and three times as many for the paraphrased questions (35.9% against 10.9%). They also do better on the questions that share words with their source (68.9% against 46.5%).
- By kind, at 5: why 85.0%, design 52.8%, recipe 41.7%, amended 23.3%. Amended questions stay hardest: they need both the older ADR and the one that changed it.
- Fusing keyword search with the embeddings did worse than the embeddings alone (44.2% against 50.8% at 5): BM25's weaker lists pull good passages down. It did help the amended questions (45.0% against 23.3%), whose older ADR shares the question's words.
- The reranker helps most: it lifts the embeddings' top 5 from 50.8% to 58.9%, and the fusion's from 44.2% to 60.1%. The two reranked rows differ by 1.2 points, less than one question's worth on 42 questions, so this does not show that fusion before reranking helps. Reranked, amended questions reach 50.0% and paraphrased ones 45.7%.
- Recall@30 bounds what the reranker can do: about a quarter of the sources are not in the top 30 at all.
- The questions were written from their sources, so the literal ones favour keyword search; the paraphrased split shows how much.
- Fusion's constant k = 60 is the usual one, not tuned: these 42 questions are the only test, and tuning on them would overstate the result.
- Embedding the 3,561 passages and 42 questions took 930,293 tokens, within Voyage's free allowance for `voyage-4`; vectors are cached by content, so a later run sends nothing. Reranking sends 84 pools of 30 (about 690,000 tokens by the run's estimate); the orders are cached too.

## Run

Node 24 or newer.

```sh
npm ci
npm test
npm run demo                 # offline, from demo/snapshot/

# Rebuild the evaluation (needs git and a logged-in gh)
npm run eval:prepare -- --repo ../foedrum --github EdwinBekaert/foedrum
npm run eval

# Search Foedrum's documents for the question set's sources
npm run chunk -- --repo ../foedrum --rev 2d64a6e3904c8f514efa135237035c45ae42a57a
npm run eval:docs                 # BM25 rows; embeddings only from the cache
npm run eval:docs -- --embed      # also embeds what is not cached (VOYAGE_API_KEY)
npm run eval:docs -- --rerank     # also reranks what is not cached (VOYAGE_API_KEY)

# Use it in Claude Code
npm run index -- --repo ../foedrum --name EdwinBekaert/foedrum --rev origin/main
claude mcp add grainbill -- node /abs/path/grainbill/src/mcp/server.ts /abs/path/grainbill/data/index.json
```

`.npmrc` refuses install scripts and package versions younger than 7 days; the only packages are TypeScript and Node's type definitions.

More: [docs/what-and-why.md](docs/what-and-why.md), and the options considered in [docs/options.md](docs/options.md).
