# Grain Bill

Retrieval and cited answers over [Foedrum](https://github.com/EdwinBekaert/foedrum)'s code and documents, measured, and served to Claude Code as MCP tools.

- **M1**: keyword search (BM25) that ranks which folders of a codebase an issue is likely to touch.
- **M2**: questions about Foedrum answered from its documents: hybrid search, a reranker, an answer that cites its passages or refuses, and an evaluation of both search and answers.

## What it is

- **Code search (M1)**: one text blob per source file (its path, exported names and comments), scored by BM25 against the issue's words; a folder scores the sum of its three best files. Evaluated on 100 past Foedrum issues against the folders their pull requests changed, with the index built from code older than those pull requests.
- **Document answers (M2)**:
  - Foedrum's ADRs, design pages, recipes, brewers and lenses cut into 3,561 passages, each kind its own way.
  - Search by BM25 and Voyage embeddings, fused, and the top 30 reranked.
  - Claude Haiku 5.5 answers from the top 5 passages, citing them, or says `NOT COVERED`.
  - An evaluation: 50 questions with known answers and sources, recall per search stage, and the answers judged by Claude Sonnet 5.5.
- **An MCP server** (stdio, written by hand, no dependencies) with two tools: `impact(request)` returns the top folders and the files behind them; `ask(question)` returns a cited answer.
- **An offline demo**: `npm run demo`, from a frozen snapshot, with no network and no model.

## What it is not

- Not a verified accuracy: no person checked the judge's verdicts, and the question set is small and was written from the documents it tests.
- The code search is word counting: no embeddings, no model, and only 9 folders to choose from, where always answering with the three busiest already finds 70%.
- `ask` over MCP answers new questions only in live mode, which needs a Voyage key and Claude Code on the machine; the demo's server answers only the 50 questions of the set.

## What the results show

Every number below is from [docs/results.md](docs/results.md), where its table and run are.

**The code search beats the obvious guess.** Its first folder is right for 89.0% of issues, against 76.0% for always answering with the busiest folders, and it finds 94.6% of the changed folders in its top 5, against 83.4% ([M1 table](docs/results.md#m1-which-folders-an-issue-touches)).

**For the documents, retrieval is the limit.** Keyword search puts 27.0% of the sources an answer needs in the top 5; embeddings 50.8%; embeddings and keywords fused, then reranked, 60.1%. About a quarter of the sources never reach the top 30, so no reranker can find them ([search table](docs/results.md#m2-finding-a-questions-sources-among-foedrums-passages)).

**The answers are disciplined.** All 8 questions the documents cannot answer were refused, and none of the 42 they can; no citation names a passage that was not given; 5.2% of sentences carry no citation ([answers table](docs/results.md#m2-answers-from-the-top-5-passages)).

**By the judge alone, most answers are right.** 71.4% correct, 23.8% partly, 4.8% wrong; 88.1% say only what their passages state. With a source among the 5 passages, 29 of 35 answers are correct and none wrong; without one, 1 of 7 is correct. Reworded questions are answered correctly 56.5% of the time, against 89.5% for those that share words with their source; recipe questions are weakest at 50.0%; 9 of 10 answers to amended questions give the rule that holds now ([verdicts table](docs/results.md#m2-the-answers-judged)).

**What it means.** The answering model cites and refuses well; the quality of an answer is limited mostly by whether search found its source, above all for reworded and recipe questions. Even with its source found, 6 of 35 answers are only partly right, so the answers have room too, but less.

**How much weight it carries.** 50 questions, 42 of them answerable, so one question moves a share by about 2 points. They were written from the documents themselves, which favours matching wording. Their reference answers were checked by a model, and 13 of the 50 also by a person; the judge's verdicts by no person. One corpus at one commit.

## What it demonstrates

- **Information retrieval fundamentals**: BM25 implemented from the formula, a tokenizer for code and prose, score aggregation from files to modules.
- **Chunking fitted to each kind of document**: design pages and ADRs by heading with breadcrumbs, recipes parsed from JSONC into one passage per step, line ranges kept for citations.
- **Hybrid retrieval, each stage measured**: keyword and dense search, reciprocal rank fusion, a cross-encoder reranker, and the stages that did not help kept in the table.
- **Grounded generation**: answers only from retrieved passages, a citation after every sentence, a refusal when the passages do not cover the question.
- **Stale knowledge**: the links between ADRs read from their status lines, and answers that give the rule that holds now.
- **Evaluation design**: labelled cases from real history with a time split (M1); a question set with amended and unanswerable questions, recall per stage, and a model judge whose limits are stated (M2).
- **Honest reporting**: what the numbers do not prove sits next to them, mistakes found in the runs included.
- **The Model Context Protocol from the wire up**: JSON-RPC 2.0 over stdio, tool listing and calling, tool errors versus protocol errors, without the SDK.
- **Cost control**: cheap models where they suffice; embeddings, rerankings, answers and verdicts cached by content, so a rerun sends nothing.
- **Supply-chain hygiene**: zero runtime dependencies, no install scripts, no package younger than 7 days, exact versions; model APIs over `fetch` or headless Claude Code.

## Milestones

- **M1**: keyword search over code, its evaluation, the MCP server and the demo.
- **M2**: questions answered from Foedrum's documents, with search, answers and their evaluation ([issue #1](https://github.com/EdwinBekaert/grainbill/issues/1); the plan in [docs/what-and-why.md](docs/what-and-why.md#m2-questions-answered-from-foedrums-documents)).

## Run

Node 24 or newer.

```sh
npm ci
npm test
npm run demo                 # offline, from demo/snapshot/

# M1: rebuild the evaluation (needs git and a logged-in gh)
npm run eval:prepare -- --repo ../foedrum --github EdwinBekaert/foedrum
npm run eval

# M2: Foedrum's documents into passages, then each stage; every stage reads its cache, and only
# the flagged runs call a service (Voyage with VOYAGE_API_KEY; Claude through claude -p)
npm run chunk -- --repo ../foedrum --rev 2d64a6e3904c8f514efa135237035c45ae42a57a
npm run eval:docs -- --embed --rerank   # search, scored
npm run answer -- --claude              # answers by Haiku
npm run judge -- --claude               # verdicts by Sonnet
npm run snapshot:docs                   # freeze answers and verdicts for the demo
npm run ask -- "Why does the push gate run no tests?"

# Use it in Claude Code; --live lets ask answer any question
npm run index -- --repo ../foedrum --name EdwinBekaert/foedrum --rev origin/main
claude mcp add grainbill -- node /abs/path/grainbill/src/mcp/server.ts /abs/path/grainbill/data/index.json --live /abs/path/grainbill/data
```

`.npmrc` refuses install scripts and package versions younger than 7 days; the only packages are TypeScript and Node's type definitions.

More: [docs/results.md](docs/results.md), [docs/what-and-why.md](docs/what-and-why.md), and the options considered in [docs/options.md](docs/options.md).
