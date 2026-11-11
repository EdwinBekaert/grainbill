import assert from 'node:assert/strict';
import { test } from 'node:test';
import { adrGraph, isCurrent, parseStatus, successors } from '../src/docs/adr-links.ts';

const at = (n: string) => `[${n}](${n}-some-title.md)`;

test('parseStatus reads each relation in both directions, with what the link changes', () => {
  const status = `Accepted · Amends ${at('0045')} (what the gate runs; before \`git push\`) and ${at('0054')} · Amended by ${at('0249')}, ${at('0300')} (a later fix) · Extended by ${at('0070')}`;
  assert.deepEqual(parseStatus('0100', status), [
    { from: '0100', to: '0045', kind: 'amends', scopes: ['what the gate runs; before `git push`'] },
    { from: '0100', to: '0054', kind: 'amends', scopes: [] },
    { from: '0249', to: '0100', kind: 'amends', scopes: [] },
    { from: '0300', to: '0100', kind: 'amends', scopes: ['a later fix'] },
    { from: '0070', to: '0100', kind: 'extends', scopes: [] },
  ]);
});

test('parseStatus reads a comma before the relation and a clause after a semicolon', () => {
  const status = `Accepted, amended by ${at('0043')} and ${at('0050')}; its client over \`fetch\` superseded by ${at('0073')}`;
  assert.deepEqual(
    parseStatus('0008', status).map((l) => [l.from, l.to, l.kind]),
    [
      ['0043', '0008', 'amends'],
      ['0050', '0008', 'amends'],
      ['0073', '0008', 'supersedes'],
    ],
  );
});

test('parseStatus marks a partial supersession by its three wordings', () => {
  assert.deepEqual(parseStatus('0078', `Accepted · Partly superseded by ${at('0274')}`), [
    { from: '0274', to: '0078', kind: 'supersedes', partly: true, scopes: [] },
  ]);
  assert.deepEqual(
    parseStatus('0274', `Accepted · Supersedes ${at('0078')}'s test names and lists (which tests are the step's), ${at('0176')} and ${at('0178')}`),
    [
      { from: '0274', to: '0078', kind: 'supersedes', partly: true, scopes: ['test names and lists', "which tests are the step's"] },
      { from: '0274', to: '0176', kind: 'supersedes', scopes: [] },
      { from: '0274', to: '0178', kind: 'supersedes', scopes: [] },
    ],
  );
  assert.deepEqual(parseStatus('0181', `Accepted · Supersedes the cost parts of ${at('0172')} (the receipt's cost)`), [
    { from: '0181', to: '0172', kind: 'supersedes', partly: true, scopes: ["the receipt's cost"] },
  ]);
});

test('parseStatus links nothing for other words, for links inside brackets, or for itself', () => {
  assert.deepEqual(parseStatus('0300', `Accepted · Narrows #388 (with ${at('0233')} it replaces the plan) · follows ${at('0159')}`), []);
  assert.deepEqual(parseStatus('0300', `Accepted · Amends ${at('0100')} (as ${at('0200')} amends it)`), [
    { from: '0300', to: '0100', kind: 'amends', scopes: [`as ${at('0200')} amends it`] },
  ]);
  assert.deepEqual(parseStatus('0300', `Accepted · Amends ${at('0300')}`), []);
});

test('adrGraph merges both sides of a link, finds successors and what is no longer current', () => {
  const statuses = new Map([
    ['0011', `Accepted · Amended by ${at('0024')} (layout)`],
    ['0024', `Accepted · Amends ${at('0011')} (the outbox) · Superseded by ${at('0263')}`],
    ['0263', `Accepted · Supersedes ${at('0024')} · Amends ${at('0999')}`],
    ['0079', `Accepted · Amends ${at('0084')}`],
    ['0084', 'Accepted'],
  ]);
  const g = adrGraph(statuses);
  // 0999 is not in the corpus, so its link is left out.
  assert.equal(g.links.length, 3);
  assert.deepEqual(g.later.get('0011'), [{ from: '0024', to: '0011', kind: 'amends', scopes: ['layout', 'the outbox'] }]);
  // A link only one side states: 0084's line does not name 0079.
  assert.deepEqual(
    g.oneSided.map((l) => `${l.from}>${l.to}`),
    ['0079>0084'],
  );
  assert.deepEqual(successors(g, '0011'), ['0024', '0263']);
  assert.deepEqual(successors(g, '0084'), ['0079']);
  assert.equal(isCurrent(g, '0024'), false);
  assert.equal(isCurrent(g, '0011'), true);
});
