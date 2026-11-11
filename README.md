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

- Not RAG: nothing generates an answer from what is found. Claude may, after calling the tool, but that is not built or measured here.
- No embeddings, no chunking beyond one blob per file, no reranking, no model of any kind.
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

| Search | Hit@1 | Recall@3 | Recall@5 |
|---|---|---|---|
| no search: the busiest folders | 76.0% | 70.1% | 83.4% |
| BM25 over file paths | 84.0% | 72.6% | 87.9% |
| BM25 over paths, exports, comments | 89.0% | 82.6% | 94.6% |

## Run

Node 24 or newer.

```sh
npm ci
npm test
npm run demo                 # offline, from demo/snapshot/

# Rebuild the evaluation (needs git and a logged-in gh)
npm run eval:prepare -- --repo ../foedrum --github EdwinBekaert/foedrum
npm run eval

# Use it in Claude Code
npm run index -- --repo ../foedrum --name EdwinBekaert/foedrum --rev origin/main
claude mcp add grainbill -- node /abs/path/grainbill/src/mcp/server.ts /abs/path/grainbill/data/index.json
```

`.npmrc` refuses install scripts and package versions younger than 7 days; the only packages are TypeScript and Node's type definitions.

More: [docs/what-and-why.md](docs/what-and-why.md), and the options considered in [docs/options.md](docs/options.md).
