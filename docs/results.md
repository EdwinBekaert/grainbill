# Results

Every number here comes from a run, with its date and the commits it ran on. The README's summary points at these tables; they stay the source.

## M1: which folders an issue touches

100 past Foedrum issues, each against the folders its pull request changed. The index is built at a commit older than every evaluated pull request, so it has not seen the code they wrote.

| Search | Hit@1 | Recall@3 | Recall@5 |
|---|---|---|---|
| no search: the busiest folders | 76.0% | 70.1% | 83.4% |
| BM25 over file paths | 84.0% | 72.6% | 87.9% |
| BM25 over paths, exports, comments | 89.0% | 82.6% | 94.6% |

Hit@1: the first folder is one the pull request changed.
Recall@k: the share of the changed folders found in the top k.

What M1 does not show:

- There are 9 folders and a pull request changes 2.5 of them, so always answering with the three busiest already finds 70%: the task is close to a choice among a few classes.
- Nothing generates an answer, and there are no embeddings, no chunking and no reranking: it is search, not RAG.

## M2: finding a question's sources among Foedrum's passages

The 42 answerable questions of [eval/questions.jsonc](../eval/questions.jsonc) (97 sources) against 3,561 passages of Foedrum at `2d64a6e3`, run on 2026-11-11.

| Search | Recall@5 | All@5 | Recall@30 | MRR@30 |
|---|---|---|---|---|
| BM25 over passage text | 20.2% | 9.5% | 43.3% | 0.26 |
| BM25 over breadcrumb title and text | 27.0% | 19.0% | 49.4% | 0.30 |
| the same, each ADR followed by the ADRs that later changed it | 23.8% | 16.7% | 28.2% | 0.25 |
| Voyage `voyage-4` embeddings of title and text, by cosine | 50.8% | 35.7% | 74.2% | 0.46 |
| BM25 (title and text) and `voyage-4`, by reciprocal rank fusion (k = 60) | 44.2% | 23.8% | 70.2% | 0.44 |
| `voyage-4`, its top 30 reranked by Voyage `rerank-3-lite` | 58.9% | 40.5% | 74.2% | 0.57 |
| the fusion, its top 30 reranked by `rerank-3-lite` | 60.1% | 40.5% | 70.2% | 0.58 |

Recall@k: the share of a question's sources with a passage in the top k (the answer is built from the top 5; the reranker reorders the top 30).
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

## M2: answers from the top 5 passages

Claude Haiku 5.5 (`claude-haiku-5-5`, through `claude -p`) answers all 50 questions from the 5 passages of the best search above (fusion, reranked), citing a passage after every sentence or replying `NOT COVERED:` when the passages do not answer. Run on 2026-11-11, Foedrum at `2d64a6e3`.

| | Count | Share |
|---|---|---|
| unanswerable questions refused | 8 of 8 | 100.0% |
| answerable questions refused | 0 of 42 | 0.0% |
| answerable questions with a source among the 5 passages | 35 of 42 | 83.3% |
| answers citing a passage of a source | 33 of 42 | 78.6% |
| sentences without a citation | 11 of 211 | 5.2% |
| citations naming no passage | 0 | |

What a read of the answers shows:

- For the 7 answerable questions with no source among the passages, Haiku still answered, from nearby passages, mostly saying what those passages leave open.
- Uncited sentences are mostly an opening "No." or a paragraph whose citations come at its end.
- A first run, without the prompt's rule to assume nothing about the asker's machine, had several answers assume native Windows: Claude Code passes the machine's details to the model even with its system prompt replaced (see [options.md](options.md#8-model-apis-fetch-for-voyage-headless-claude-code-for-claude)). With the rule, no answer assumes a platform; Windows comes up only as one of the cases the passages state.
- 50 calls took 212,719 tokens in and 54,552 out; answers are cached by model, system prompt and prompt.

## M2: the answers judged

Claude Sonnet 5.5 (`claude-sonnet-5-5`, through `claude -p`) judges each answer above against the question set's reference answer and the 5 passages the answer was given: whether it is right, whether every claim is stated by the passages, whether an amended question got the rule that holds now, and whether it refused. Run on 2026-11-11.

**No person checked the judge's verdicts.** The numbers below are one model's reading of another's answers, on a question set written with a model of the same family; they show where answers go wrong, not a verified accuracy.

| Questions | Correct | Partly | Wrong | Faithful to the passages |
|---|---|---|---|---|
| answerable (42) | 71.4% | 23.8% | 4.8% | 88.1% |
| design (12) | 75.0% | 16.7% | 8.3% | 91.7% |
| why (10) | 80.0% | 20.0% | 0.0% | 100.0% |
| amended (10) | 80.0% | 20.0% | 0.0% | 90.0% |
| recipe (10) | 50.0% | 40.0% | 10.0% | 70.0% |
| paraphrased (23) | 56.5% | 34.8% | 8.7% | 87.0% |
| not paraphrased (19) | 89.5% | 10.5% | 0.0% | 89.5% |
| unanswerable (8), refused | 100.0% | | | 100.0% |

By whether a source was among the answer's 5 passages (`npm run judge` prints this line):

| Answerable questions | Correct | Partly | Wrong |
|---|---|---|---|
| a source among the 5 passages (35) | 29 | 6 | 0 |
| no source among them (7) | 1 | 4 | 2 |

What the verdicts say:

- Retrieval decides most of it: with a source among the passages no answer is wrong; without one, only 1 of 7 is right.
- 9 of 10 amended questions get the rule that holds now, by the judge; for the tenth (amended-08) it gave no reading of that point ("n/a") while judging the answer correct and faithful.
- 13 claims in 5 answers are not stated by their passages: mostly an answer stretching a passage about a nearby case to the question asked, or naming an ADR's amendment history beyond what the status lines say. The judge also lists some omissions there, which are not claims.
- Recipe questions fare worst: a recipe's answer is spread over several steps, and the 5 passages often hold only some of them.
- A first judge run left the ADR status lines out of the passages it showed the judge, though the answers had them; it then called claims such as "ADR 0076 amends ADR 0069" unsupported and put faithfulness at 66.7%. The judge now sees the passages exactly as the answer did; only that run is reported above.
- 50 verdicts took 238,352 tokens in and 10,249 out; they are cached like the answers.
