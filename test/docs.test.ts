import assert from 'node:assert/strict';
import { test } from 'node:test';
import { passagesOf } from '../src/docs/build.ts';
import { chunk, kindOf, PIECE_CHARS, pieces, placeOf, render } from '../src/docs/chunk.ts';
import { field, parseJsonc, plain } from '../src/docs/jsonc.ts';

test('parseJsonc reads comments, trailing commas and the lines of each value', () => {
  const root = parseJsonc('// head\n{\n  // about a\n  "a": [1, true,],\n  "b": { "c": null }, /* end */\n}\n');
  assert.deepEqual(plain(root), { a: [1, true], b: { c: null } });
  assert.deepEqual(root.comments, [{ line: 1, text: 'head' }]);
  const a = field(root, 'a');
  assert.deepEqual([a?.start, a?.end, a?.comments], [4, 4, [{ line: 3, text: 'about a' }]]);
  assert.deepEqual([root.start, root.end], [2, 6]);
  assert.throws(() => parseJsonc('{ "a": 1 } x'), /text after the value at line 1/);
  assert.throws(() => parseJsonc('{\n "a" 1 }'), /expected ":" at line 2/);
});

test('kindOf keeps the documents and placeOf names where they sit', () => {
  assert.equal(kindOf('docs/adr/0249-the-push-gate.md'), 'adr');
  assert.equal(kindOf('docs/adr/README.md'), undefined);
  assert.equal(kindOf('docs/design/engine/fold.md'), 'design');
  assert.equal(kindOf('docs/glossary.md'), 'doc');
  assert.equal(kindOf('docs/milestones/m1.md'), 'doc');
  assert.equal(kindOf('ROADMAP.md'), 'doc');
  assert.equal(kindOf('defaults/recipes/nip.jsonc'), 'recipe');
  assert.equal(kindOf('defaults/models.jsonc'), undefined);
  assert.equal(kindOf('defaults/lenses/plan/sizing.md'), 'lens');
  assert.equal(kindOf('src/engine/fold.ts'), undefined);
  assert.equal(placeOf('docs/design/engine/fold.md', 'design'), 'engine › fold');
  assert.equal(placeOf('docs/design/engine/README.md', 'design'), 'engine');
  assert.equal(placeOf('docs/milestones/m1.md', 'doc'), 'milestones › m1');
  assert.equal(placeOf('defaults/lenses/plan/sizing.md', 'lens'), 'lens plan/sizing');
});

test('markdown is cut at headings outside fences, with a breadcrumb and line range', () => {
  const md = [
    '# The fold', //  1
    'Intro line.', // 2
    '', //            3
    '## Errors', //   4
    '```sh', //       5
    '# not a heading', // 6
    '```', //         7
    '### Empty', //   8
    '## Guard', //    9
    'Guard line.', // 10
    '', //            11
  ].join('\n');
  const ps = chunk('docs/design/engine/fold.md', md);
  assert.deepEqual(
    ps.map((p) => [p.title, p.start, p.end, p.text]),
    [
      ['engine › fold › The fold', 1, 2, 'Intro line.'],
      ['engine › fold › The fold › Errors', 4, 7, '```sh\n# not a heading\n```'],
      ['engine › fold › The fold › Guard', 9, 10, 'Guard line.'],
    ],
  );
  assert.equal(ps[0]?.id, 'docs/design/engine/fold.md:1-2');
});

test('a brewer’s JSON frontmatter is a passage of its own, written out', () => {
  const md = '---\n{ "name": "gauger", "inputs": [{ "name": "order" }] }\n---\n# Gauger\nWrite tests.\n';
  const ps = chunk('defaults/brewers/gauger.md', md);
  assert.deepEqual(
    ps.map((p) => [p.title, p.start, p.end, p.text]),
    [
      ['brewer gauger › settings', 1, 3, 'name gauger, inputs (name order)'],
      ['brewer gauger › Gauger', 4, 5, 'Write tests.'],
    ],
  );
});

test('an ADR’s passages carry its number and status, and the title says the number once', () => {
  const md = '# 0249. The push gate runs no tests\n\nDate: 2026-10-28 · Status: Accepted · Amends [0045](x.md)\n\n## Decision\nNo tests.\n';
  const ps = chunk('docs/adr/0249-the-push-gate.md', md);
  assert.deepEqual(
    ps.map((p) => [p.title, p.start, p.end]),
    [
      ['ADR 0249 › The push gate runs no tests', 1, 3],
      ['ADR 0249 › The push gate runs no tests › Decision', 5, 6],
    ],
  );
  assert.deepEqual(ps[1]?.adr, { number: '0249', status: 'Accepted · Amends [0045](x.md)' });
});

test('pieces cuts a long section at paragraphs, then between lines, never inside one', () => {
  const long = 'x'.repeat(PIECE_CHARS * 0.6);
  // Two paragraphs of two long lines each, then one line longer than a piece.
  const lines = [long, long, '', long, long, '', 'y'.repeat(PIECE_CHARS * 2)];
  assert.deepEqual(pieces(lines, 0, lines.length), [
    [0, 1],
    [1, 2],
    [3, 4],
    [4, 5],
    [6, 7],
  ]);
  const short = ['a', 'b', '', 'c', '', ''];
  assert.deepEqual(pieces(short, 0, short.length), [[0, 4]]);
});

test('a recipe is a header passage and one passage per step, members of a group included', () => {
  const recipe = [
    '// Nip, the quick fix.', //                       1
    '{', //                                            2
    '  "name": "nip",', //                             3
    '  "type": "brew",', //                            4
    '  "description": "Quick fix",', //                5
    '  "steps": [', //                                 6
    '    // Writes failing tests.', //                 7
    '    { "id": "gauge", "brewer": "gauger" },', //   8
    '    {', //                                        9
    '      // Findings go back.', //                   10
    '      "id": "taste",', //                         11
    '      "onFindings": { "goto": "gauge", "maxRounds": 2 },', // 12
    '      "parallel": [', //                         13
    '        { "id": "security", "brewer": "taster", "lens": "diff/security" }', // 14
    '      ]', //                                      15
    '    },', //                                       16
    '    { "action": "openPullRequest" }', //          17
    '  ]', //                                          18
    '}', //                                            19
  ].join('\n');
  const ps = chunk('defaults/recipes/nip.jsonc', recipe);
  assert.deepEqual(
    ps.map((p) => [p.title, p.start, p.end, p.text]),
    [
      ['recipe nip', 1, 5, 'Nip, the quick fix.\ntype brew: Quick fix'],
      ['recipe nip › gauge', 7, 8, 'brewer gauger\nWrites failing tests.'],
      [
        'recipe nip › taste',
        9,
        13,
        'runs side by side: security\nonFindings (goto gauge, maxRounds 2)\nFindings go back.',
      ],
      ['recipe nip › taste › security', 14, 14, 'brewer taster, lens diff/security'],
      ['recipe nip › openPullRequest', 17, 17, 'action openPullRequest'],
    ],
  );
});

test('render writes JSON as words', () => {
  assert.equal(render({ $schema: 'x', check: ['build', 'test'], onFail: { goto: 'implement' } }), 'check build, test, onFail (goto implement)');
});

test('passagesOf finds every passage a cited range overlaps', () => {
  const ps = chunk('docs/glossary.md', '# A\none\n# B\ntwo\n# C\nthree\n');
  assert.deepEqual(
    passagesOf(ps, 'docs/glossary.md', '2-3').map((p) => p.title),
    ['glossary › A', 'glossary › B'],
  );
  assert.deepEqual(passagesOf(ps, 'docs/glossary.md', '6').map((p) => p.title), ['glossary › C']);
  assert.deepEqual(passagesOf(ps, 'docs/other.md', '1-9'), []);
});
