# Grain Bill: what and why

## The problem

[Foedrum](https://github.com/EdwinBekaert/foedrum) runs Claude agents through pipelines and turns GitHub issues into pull requests.
Its planner breaks a feature request into sub-orders, one repository each, and has to know where in the code a feature lives.

## M1: keyword search over code

Given an issue's text, rank the folders of a codebase it is likely to change.

1. **Index.** For every `.ts` file under `src/`, one blob of text: its path, its exported names and its comments, read through git at one commit.
2. **Query.** The issue's words, with identifiers split (`handoverOf` → `handover of`) and plurals folded.
3. **Score.** BM25, the scoring formula behind Lucene and Elasticsearch: a file scores higher for the issue's words it holds, rare words counting most, long files getting no free advantage.
4. **Group.** A folder scores the sum of its three best files; the top five come back with those files as evidence.
5. **Serve.** An MCP server (stdio, written by hand) with one tool, `impact(request)`.
6. **Measure.** 100 past issues, each against the folders its pull request changed.

No model is used anywhere: it is word counting.

The results, and what they do not show, are in [results.md](results.md#m1-which-folders-an-issue-touches).
What M1 carries forward: the time split, the evaluation harness, the BM25 search and the MCP server.

## M2: questions answered from Foedrum's documents

A question such as "why does the push gate run no tests?" answered from Foedrum's 346 ADRs, 67 design pages and its recipes, with citations, and measured on the answer as well as the search.

As built:

1. **Chunking** per kind of document: design pages and ADRs by heading with breadcrumbs, recipes parsed from JSONC into one passage per step, every passage with its line range for citations.
2. **Hybrid search**: BM25 for exact words, Voyage `voyage-4` embeddings for meaning, merged by reciprocal rank fusion, then the top 30 reranked by `rerank-3-lite`. Each stage is a row in the results table.
3. **Authority**: the links between ADRs read from their status lines. Fetching every later ADR beside an earlier one made search worse, so it is kept as a measured row and not used; instead each ADR passage reaches the answer with its status line, and the prompt says a later ADR holds over the one it amends.
4. **Generation**: Claude Haiku 5.5, through headless Claude Code, answers only from the top 5 passages, cites a passage after every sentence, and replies `NOT COVERED` when they do not answer.
5. **Evaluation**: 50 questions with known answers and sources, including amended decisions and questions the documents cannot answer; recall per search stage, and the answers judged by Claude Sonnet 5.5 for correctness, faithfulness to their passages, the current rule and refusals. No person checks the verdicts.
6. **Serving**: the MCP tool `ask(question)` and `npm run ask`, live; the demo and the demo's server answer from a frozen snapshot of the 50 answers, offline.

The results are in [results.md](results.md).
A full run is about a million tokens of Voyage embeddings (once; cached), and a few hundred thousand tokens each for reranking, answers and verdicts.

## Decisions

| Decision | Why |
|---|---|
| Measure first. | Every later choice is a row in the table, not an opinion. |
| Labels from history: issue as question, changed files as answer. | Real cases at no cost. |
| Time split. | Otherwise the index has seen the answers. |
| A baseline with no search. | The search has to beat the obvious guess, not zero. |
| No vector database. | A few thousand vectors fit in memory. |
| MCP by hand, zero runtime dependencies. | The SDK brought about 90 packages for one stdio tool. |
| A hardened install. | No install scripts, no package younger than 7 days, exact versions, lock file only. |
