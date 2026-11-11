# Options considered

The design discussion that led to Grain Bill, kept so the choices can be revisited.
It started as "build a RAG with knowledge of Foedrum, reachable from a Claude Code session over MCP, to show what I know about retrieval systems".

## 1. Prior art: Arcane's Oracle

Arcane (a Claude Code plugin for running agent teams) has an Oracle that answers "why is ticket X stuck, and how do I unblock it?".
It is **agentic retrieval, not vector RAG**:

- A small grounding index (one line per concept doc) and two inlined reference cards (the state-file map and the stuck-mode catalog), both generated from code constants with a drift test.
- The model reads the authoritative sources itself with its tools: the state file, the pipeline file, session transcripts.
- Confinement: it reads anything and writes only state, enforced by a write guard.
- A triage contract: every answer ends as a state fix, an explanation, or a drafted issue filed only on approval.

Lesson kept: **exact, structured, changing state is read through tools, never embedded.** Similarity search is for prose and code whose location you do not know.

## 2. A RAG over Foedrum's own knowledge

Foedrum has three kinds of knowledge, each needing its own retrieval:

| Kind | Where | Answers | Authority |
|---|---|---|---|
| Design docs | `docs/design/**` (67 pages), architecture, glossary | how it works now | current, one owner per fact |
| ADRs | `docs/adr/` (346) | why, and what it replaced | historical: later ADRs amend earlier ones |
| Recipes, brewers, lenses | `defaults/` | what actually runs | executable |

Ideas worth keeping:

- They link each other already (design pages and recipe comments cite ADRs, ADRs amend ADRs, steps name brewers and lenses): a graph for one hop of expansion after search, with no model.
- Chunk per kind: design docs by heading with breadcrumbs (one sentence per line gives line-precise citations), ADRs by section with the status line as metadata, recipes parsed into one chunk per step, never raw JSON.
- Rank by authority when sources disagree: recipe, then design page, then newest ADR; superseded ADRs only as history.
- Tools for the structured parts (`get_recipe`, `get_adr` with its amendment chain); search for the prose.

Not chosen first: impressive, but the evaluation needs hand-written questions, and it answers questions a person can also answer by reading the docs.

## 3. Code search instead of grep

Rejected as framed. Claude Code moved away from vector indexes to agentic grep: indexes go stale, chunks lose context, grep is exact and always current.
Kept as **semantic search beside grep**: grep for names, retrieval for "where do we handle X?" in unfamiliar code, measured on which wins where.

## 4. Chosen: impact retrieval for planning

Foedrum's `mash` recipe has the Brewmaster break an order into sub-orders, one repository each.
It reads a **system map** computed from manifests with no model (ADR 0317): what each repository publishes and depends on.
That says how repositories relate, not where a feature lives; the Brewmaster opens repositories to find out, and a wrong guess is sent back by the coverage lens.

Grain Bill answers "which repositories and modules does this request touch?", with evidence:

- Index module cards: path, exports, opening comment, comments; later the public surface (routes, schemas, events), which is where changes cross repositories.
- Sum per module (later per repository), then spread along the system map's dependencies: a library's API change pulls in its dependents.
- **Ground truth for free**: merged pull requests pair an issue with the files it changed; approved plans pair an order with its repositories.
- Recall over precision (F2): a missed repository costs a round back.
- The planner keeps the decision; retrieval gives evidence.

Fit with Foedrum's rules, for when it moves in: start without a model (ADR 0317's spirit, token-free orchestration), re-index when a base moves (as `system.mapped` does), treat repository text as untrusted, and reach brewers as an input section, not an MCP tool, since they run with fixed settings. That needs an ADR and the planner A/B as its proof.

## 5. The quickest build

Use Foedrum itself as the corpus and predict **modules**, not repositories: same problem shape, no synthetic Brewery, hundreds of labelled cases.
Two days: indexer, BM25, cases from gh, a time-split evaluation, an MCP tool, a README with the table.
The trap avoided: leakage. The index is built at a commit before the evaluated pull requests.

## 6. Name and link

- Standalone repository, linked to Foedrum: Foedrum is the case study and the data, not a requirement.
- A brewing name that also explains itself: **Grain Bill**, what goes into the mash. Grist was set aside (a known spreadsheet product), Sparge describes it less well, and a plain name loses the link.

## 7. Dependencies

The MCP SDK brought about 90 packages (HTTP servers, CORS, a JSON Schema validator) for a stdio server with one tool.
The four methods it needs are written by hand in `src/mcp/protocol.ts`; runtime dependencies are zero.
Revisit if the server needs the HTTP transport, resources or prompts.

The remaining dev packages are held by Foedrum's `.npmrc`: `ignore-scripts` (install hooks are where most npm attacks run code), `min-release-age=7` (a hijacked release is usually pulled within days, before it can resolve here), `save-exact`, and no git or URL dependencies.
Install with `npm ci`, check with `npm audit signatures`.

## 8. Model APIs: `fetch` for Voyage, headless Claude Code for Claude

Voyage (embeddings and the reranker) is called with Node's `fetch`, not its SDK.
Each call is one JSON POST with a bearer key; what an SDK adds (retries, types) is a few lines here, and the dependency rule above stays at zero.
`fetch` is injected, so tests run on captured answers and never reach the network.
The key comes from the environment only (`VOYAGE_API_KEY`).

Claude is reached through headless Claude Code (`claude -p`), as Foedrum runs its brewers, rather than the API: no API key, the user's own Claude Code login.
Each call replaces Claude Code's system prompt with ours (`--system-prompt`), has no tools (`--tools ""`), no settings, CLAUDE.md, hooks or MCP servers (`--safe-mode`, `--setting-sources ""`, `--strict-mcp-config`), saves no session, and reads its prompt on stdin; `--output-format json` gives the answer, the tokens and the models used.
The process runner is injected, so tests run on captured output and never start `claude`.
What this costs in cleanliness: Claude Code still tells the model about the machine it runs on. In the first answer run, answers assumed the asker was on Windows.
The API over `fetch` (an `ANTHROPIC_API_KEY`) stays the way to remove that, and to let others run the evaluation without Claude Code.
