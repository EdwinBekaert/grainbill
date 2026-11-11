// An evaluation case is a merged pull request that closed an issue: the issue's title and body
// are the feature request, the files the pull request changed are the answer. The pull request's
// own text is never used, since it describes the solution.

import { moduleOf } from '../cards.ts';

export type Case = {
  pr: number;
  issue: number;
  mergedAt: string;
  request: string;
  files: string[];
};

export type GhPr = {
  number: number;
  mergedAt: string;
  files: { path: string }[];
  closingIssuesReferences: { number: number }[];
};

export type GhIssue = { number: number; title: string; body: string };

// One case per pull request that closes exactly one known issue.
export function casesOf(prs: GhPr[], issues: GhIssue[]): Case[] {
  const byNumber = new Map(issues.map((i) => [i.number, i]));
  const cases: Case[] = [];
  for (const pr of prs) {
    if (pr.closingIssuesReferences.length !== 1) continue;
    const issue = byNumber.get((pr.closingIssuesReferences[0] as { number: number }).number);
    if (issue === undefined) continue;
    cases.push({
      pr: pr.number,
      issue: issue.number,
      mergedAt: pr.mergedAt,
      request: `${issue.title}\n\n${issue.body}`,
      files: pr.files.map((f) => f.path),
    });
  }
  return cases.sort((a, b) => a.mergedAt.localeCompare(b.mergedAt));
}

// The modules a case changed, among the files the index covers.
export function expectedModules(c: Case, include: string[], ext: string[], depth: number): string[] {
  const files = c.files.filter(
    (p) => include.some((prefix) => p.startsWith(prefix)) && ext.some((e) => p.endsWith(e)),
  );
  return [...new Set(files.map((p) => moduleOf(p, depth)))];
}
