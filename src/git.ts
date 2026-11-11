// Reads a repository at one commit through git, never the working tree, so an index can be
// built from the past (the time split of the evaluation) and is the same on every machine.

import { execFileSync } from 'node:child_process';

const MAX_BUFFER = 512 * 1024 * 1024;

function git(repo: string, args: string[], input?: string): Buffer {
  return execFileSync('git', ['-C', repo, ...args], { input, maxBuffer: MAX_BUFFER });
}

export function resolveRev(repo: string, rev: string): string {
  return git(repo, ['rev-parse', '--verify', `${rev}^{commit}`]).toString().trim();
}

// The last first-parent commit of `ref` made before `isoDate`.
export function revBefore(repo: string, ref: string, isoDate: string): string {
  const sha = git(repo, ['rev-list', '-1', '--first-parent', `--before=${isoDate}`, ref])
    .toString()
    .trim();
  if (sha === '') throw new Error(`no commit of ${ref} before ${isoDate}`);
  return sha;
}

export function commitDate(repo: string, rev: string): string {
  return git(repo, ['show', '-s', '--format=%cI', rev]).toString().trim();
}

export function listFiles(repo: string, rev: string): string[] {
  return git(repo, ['ls-tree', '-r', '--name-only', rev])
    .toString()
    .split('\n')
    .filter((p) => p !== '');
}

// One `git cat-file --batch` for all paths: "<sha> blob <size>\n<content>\n" per path.
export function readFiles(repo: string, rev: string, paths: string[]): Map<string, string> {
  const files = new Map<string, string>();
  if (paths.length === 0) return files;
  const out = git(repo, ['cat-file', '--batch'], paths.map((p) => `${rev}:${p}\n`).join(''));
  let at = 0;
  for (const path of paths) {
    const eol = out.indexOf(0x0a, at);
    const header = out.subarray(at, eol).toString();
    at = eol + 1;
    if (header.endsWith(' missing')) continue;
    const size = Number(header.split(' ')[2]);
    files.set(path, out.subarray(at, at + size).toString('utf8'));
    at += size + 1;
  }
  return files;
}
