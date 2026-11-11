# Working on Grain Bill

Grain Bill is a public portfolio project: retrieval and retrieval-augmented generation over [Foedrum](https://github.com/EdwinBekaert/foedrum), measured.
M1 (done) is BM25 keyword search over code with an evaluation on real pull requests and a hand-written MCP server; M2 (issue #1) answers questions from Foedrum's documents.

## Commands

- `npm ci`: install from the lock file (never `npm install` to restore)
- `npm test`: `node --test` over `test/**/*.test.ts`
- `npm run typecheck`: `tsc --noEmit`
- `npm run demo [-- --no-pause]`: the offline walk-through from `demo/snapshot/`
- `npm run eval:prepare -- --repo ../foedrum --github EdwinBekaert/foedrum`, then `npm run eval`: rebuild and score the evaluation (needs git and gh)
- `npm run chunk -- --repo ../foedrum --rev origin/main`: cut Foedrum's documents into passages (`data/passages.json`) and report how the question set's citations fall on them, and the links between ADRs
- `npm run eval:docs [-- --embed]`: score each search of the passages on the question set's sources; embeddings come from `data/embeddings.json`, and only `--embed` sends what is not cached to Voyage (`VOYAGE_API_KEY`, costs money past the free allowance: ask first)
- `npm run index -- --repo ../foedrum --name EdwinBekaert/foedrum --rev origin/main`: an index of current code for the MCP server
- Run `npm test` and `npm run typecheck` before every commit.

## Rules

- **Claims are plain and true.** The README and docs say what the code does and what it does not; no inflated names ("retrieval layer" for keyword search). Every result in a doc comes from a run, with its date and commit.
- **No job-search framing in the repository**: no "interview" in names or text, no "questions to expect". Prep material stays in chat.
- **Measure before claiming**: a technique enters the README as a row of a results table, including the ones that did not help.
- **Dependencies**: zero runtime dependencies so far. Adding one needs a reason stated in `docs/options.md`; prefer `fetch` and Node built-ins. `.npmrc` refuses install scripts and versions younger than 7 days; keep it.
- **TypeScript** run directly by Node 24 (type stripping): `.ts` extensions in imports, `import type` for types, no enums, no parameter properties.
- **Tests**: `node:test` and `node:assert/strict`; pure cores tested with plain data; no test reaches the network, an API or a login (inject `fetch`, use captured answers).
- **Data**: `data/` is git-ignored scratch; `demo/snapshot/` is committed and must stay offline-usable and free of local paths and secrets. API keys only from the environment, never in files.
- **Branches**: work on a branch in a worktree under `.claude/worktrees/`, never on `main`; changes reach `main` through a pull request, one per step of the milestone plan, linked to its issue.
- **Git**: commit messages in the imperative with a short body saying why; no "Generated with" lines or Co-Authored-By trailers. Text files are LF (`.gitattributes`).
