# Grain Bill: what and why

## The problem

[Foedrum](https://github.com/EdwinBekaert/foedrum) runs Claude agents through pipelines and turns GitHub issues into pull requests.
Its planner breaks a feature request into sub-orders, one repository each, and has to know where in the code a feature lives.

## M1: keyword search over code (this version)

Given an issue's text, rank the folders of a codebase it is likely to change.

1. **Index.** For every `.ts` file under `src/`, one blob of text: its path, its exported names and its comments, read through git at one commit.
2. **Query.** The issue's words, with identifiers split (`handoverOf` → `handover of`) and plurals folded.
3. **Score.** BM25, the scoring formula behind Lucene and Elasticsearch: a file scores higher for the issue's words it holds, rare words counting most, long files getting no free advantage.
4. **Group.** A folder scores the sum of its three best files; the top five come back with those files as evidence.
5. **Serve.** An MCP server (stdio, written by hand) with one tool, `impact(request)`.
6. **Measure.** 100 past issues, each against the folders its pull request changed.

No model is used anywhere: it is word counting.

### Results

The index is built at a commit older than every evaluated pull request, so it has not seen the code they wrote.

| Search | Hit@1 | Recall@3 | Recall@5 |
|---|---|---|---|
| no search: the busiest folders | 76.0% | 70.1% | 83.4% |
| BM25 over file paths | 84.0% | 72.6% | 87.9% |
| BM25 over paths, exports, comments | 89.0% | 82.6% | 94.6% |

Hit@1: the first folder is one the pull request changed.
Recall@k: the share of the changed folders found in the top k.

### What M1 does not show

- There are 9 folders and a pull request changes 2.5 of them, so always answering with the three busiest already finds 70%: the task is close to a choice among a few classes.
- Nothing generates an answer, and there are no embeddings, no chunking and no reranking: it is search, not RAG.

What it does carry forward: the time split, the evaluation harness, the BM25 search and the MCP server.

## M2: questions answered from Foedrum's documents

A question such as "why does the push gate run no tests?" answered from Foedrum's 346 ADRs, 67 design pages and its recipes, with citations, and measured on the answer as well as the search.

1. **Chunking** per kind of document: design pages by heading, ADRs by section, recipes one step at a time.
2. **Hybrid search**: BM25 for exact words, embeddings (Voyage) for meaning, merged by reciprocal rank fusion, then a reranker. Each stage is a row in the results table.
3. **Authority**: an ADR that a later one amends is fetched with its successor, and the newest decision is the answer.
4. **Generation**: Claude answers only from the retrieved passages, cites each claim, and says so when the documents do not cover the question.
5. **Evaluation**: about 50 questions with known answers and sources, including amended decisions and questions the documents cannot answer; retrieval recall per stage, and the answers judged for correctness, faithfulness to their sources and correct refusals.
6. **Demo**: embeddings and the demo's answers cached in the snapshot, so `npm run demo` stays offline and free; a live mode asks new questions with API keys.

Expected cost of a full evaluation run: well under a dollar.

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
