// Run with `node --test viewer/git.spec.mjs`.
import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { promisify } from 'node:util'

import { cellsOf } from './draw.mjs'
import { drawBranches, drawCommits, drawFiles, moveList } from './drawgit.mjs'
import { loader, parseBranches, parseLog, parseShas, parseStatus, shortAge } from './gitdata.mjs'

const plain = line => line.replace(/\x1b\[[\d;]*m/g, '')
const US = '\x1f'

const STATUS = [
  '# branch.oid 1111111111111111111111111111111111111111',
  '# branch.head dev',
  '# branch.upstream origin/dev',
  '# branch.ab +2 -1',
  '1 M. N... 100644 100644 100644 aaa bbb src/app.mjs',
  '1 .M N... 100644 100644 100644 aaa bbb docs/my file.md',
  '2 R. N... 100644 100644 100644 aaa bbb R100 src/new.mjs',
  'src/old.mjs',
  'u UU N... 100644 100644 100644 100644 aaa bbb ccc conflict.txt',
  '? notes.txt',
  '',
].join('\0')

test('status v2 gives the branch, ahead and behind, and one entry per path', () => {
  const status = parseStatus(STATUS)
  assert.equal(status.head, 'dev')
  assert.equal(status.upstream, 'origin/dev')
  assert.deepEqual([status.ahead, status.behind], [2, 1])
  assert.deepEqual(status.entries, [
    { x: 'M', y: ' ', path: 'src/app.mjs' },
    { x: ' ', y: 'M', path: 'docs/my file.md' },
    { x: 'R', y: ' ', path: 'src/new.mjs', orig: 'src/old.mjs' },
    { x: 'U', y: 'U', path: 'conflict.txt' },
    { x: '?', y: '?', path: 'notes.txt' },
  ])
})

test('status without an upstream has none, and a detached head is named', () => {
  const status = parseStatus(['# branch.oid abc', '# branch.head (detached)', ''].join('\0'))
  assert.equal(status.head, '(detached)')
  assert.equal(status.upstream, undefined)
  assert.deepEqual(status.entries, [])
})

test('for-each-ref rows give the current branch, the track and the age', () => {
  const text = [
    ['*', 'dev', 'origin/dev', '[ahead 1, behind 2]', '17 hours ago'],
    [' ', 'main', 'origin/main', '', '3 days ago'],
    [' ', 'old', 'origin/old', '[gone]', '2 weeks ago'],
    [' ', 'local', '', '', '1 year, 2 months ago'],
  ].map(row => row.join(US)).join('\n')
  const [dev, main, old, local] = parseBranches(`${text}\n`)
  assert.deepEqual([dev.isCurrent, dev.ahead, dev.behind, dev.hasUpstream], [true, 1, 2, true])
  assert.deepEqual([main.isCurrent, main.ahead, main.behind], [false, 0, 0])
  assert.equal(old.isGone, true)
  assert.equal(local.hasUpstream, false)
  assert.deepEqual(['17 hours ago', '3 days ago', '2 weeks ago', '1 year, 2 months ago', '5 minutes ago', '4 months ago', 'x'].map(shortAge), ['17h', '3d', '2w', '1y', '5m', '4mo', ''])
})

const logLine = (graph, sha, refs, subject, age) => [graph, sha, refs, subject, age].join(US)

test('the graph log keeps graph-only lines and reads refs, subject and age', () => {
  const text = [
    logLine('*   ', 'a'.repeat(40), 'HEAD -> dev, origin/dev, tag: v1', 'Merge branch x', '17 hours ago'),
    '|\\  ',
    logLine('| * ', 'b'.repeat(40), '', 'feature', '3 days ago'),
    '|/  ',
    logLine('* ', 'c'.repeat(40), '', 'base', '2 weeks ago'),
  ].join('\n')
  const log = parseLog(text)
  assert.equal(log.length, 5)
  assert.deepEqual(log[0].refs, ['HEAD -> dev', 'origin/dev', 'tag: v1'])
  assert.deepEqual([log[1].graph, log[1].sha], ['|\\  ', undefined])
  assert.deepEqual([log[2].graph, log[2].subject, log[2].refs], ['| * ', 'feature', []])
  assert.deepEqual([...parseShas(`${'a'.repeat(40)}\n`)], ['a'.repeat(40)])
})

const widths = lines => lines.map(line => cellsOf(plain(line)))
const nothing = '\x1b[31m'
const hostile = `${nothing}evil\x1b]0;x\x07 \u009b2J`

test('files are drawn exactly as wide as the pane, a hostile name never an escape of its own', () => {
  const feed = { repo: true, status: parseStatus(STATUS.replace('notes.txt', hostile)) }
  const lines = drawFiles(feed, { at: 1 }, 10, 52)
  assert.equal(plain(lines[0]).trimEnd(), 'dev ↑2 ↓1 · 3 staged · 2 changed · 1 new')
  assert.equal(lines.length, 6)
  assert.deepEqual(widths(lines), Array(6).fill(52))
  assert.match(plain(lines[1]), /^M {2}src\/app\.mjs/)
  assert.match(lines[2], /\x1b\[48;2;49;50;68m/)
  assert.match(plain(lines[3]), /^R {2}src\/new\.mjs ← src\/old\.mjs/)
  for (const line of lines.slice(1)) assert.doesNotMatch(line.replace(/\x1b\[[\d;]*m/g, ''), /[\x00-\x08\x0b-\x1f\x7f-\x9f]/)
  assert.deepEqual(widths(drawFiles(feed, { at: 0 }, 4, 20)), Array(4).fill(20))
})

test('branches and commits are drawn exactly as wide as the pane', () => {
  const branches = parseBranches([['*', 'dev', 'origin/dev', '[ahead 1]', '17 hours ago'], [' ', hostile, '', '', '3 days ago']].map(row => row.join(US)).join('\n'))
  const b = drawBranches({ repo: true, branches }, { at: 0 }, 8, 52)
  assert.equal(plain(b[1]), '* dev' + ' '.repeat(52 - 5 - 7) + '↑1  17h')
  assert.deepEqual(widths(b), Array(3).fill(52))
  assert.doesNotMatch(b.join(''), /\x1b\[31m/)

  const commits = parseLog([
    logLine('* ', 'a'.repeat(40), 'HEAD -> dev, origin/dev', 'A very long subject '.repeat(5), '17 hours ago'),
    '|\\ ',
    logLine('| * ', 'b'.repeat(40), '', `${nothing}subject`, '3 days ago'),
  ].join('\n'))
  const feed = { repo: true, commits, unpushed: new Set(['a'.repeat(40)]) }
  for (const cols of [52, 30, 70]) {
    const c = drawCommits(feed, { at: 0 }, 8, cols)
    assert.deepEqual(widths(c), Array(4).fill(cols))
    assert.doesNotMatch(c.join('').replace(/\x1b\[(?:[\d;]*)m/g, ''), /\x1b/)
  }
  const c = drawCommits(feed, { at: 0 }, 8, 52)
  assert.match(plain(c[1]), /^\* aaaaaaa \[HEAD -> dev\] A very/)
  assert.match(c[1], /\x1b\[38;2;243;139;168maaaaaaa/)
  assert.match(c[3], /\x1b\[38;2;249;226;175mbbbbbbb/)
  assert.match(plain(c[0]), /^Commits · 1 unpushed/)
})

test('not a repository, and no feed yet, are drawn as a header', () => {
  assert.match(plain(drawFiles({ repo: false }, { at: 0 }, 5, 40)[0]), /^Files · not a git repository/)
  assert.match(plain(drawCommits(undefined, { at: 0 }, 5, 40)[0]), /waiting for git/)
})

test('the selection moves, stays in the list, and a click picks a row', () => {
  const at = (view, kind, row) => moveList(view, { kind, row }, 20, 11).at
  assert.equal(at({ at: 0 }, 'up'), 0)
  assert.equal(at({ at: 0 }, 'down'), 1)
  assert.equal(at({ at: 5 }, 'pageDown'), 15)
  assert.equal(at({ at: 15 }, 'pageDown'), 19)
  assert.equal(at({ at: 5 }, 'bottom'), 19)
  assert.equal(at({ at: 0 }, 'click', 4), 2)
  assert.deepEqual(moveList({ at: 0 }, { kind: 'click', row: 40 }, 20, 11), { at: 0 })
})

const run = promisify(execFile)
const g = (cwd, ...args) => run('git', ['-c', 'user.name=t', '-c', 'user.email=t@example.com', '-c', 'commit.gpgsign=false', ...args], { cwd })

test('against a real repository, and an empty folder, end to end', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'gitspec-'))
  const empty = mkdtempSync(join(tmpdir(), 'gitspec-empty-'))
  try {
    await g(dir, 'init', '-q', '-b', 'main')
    writeFileSync(join(dir, 'a.txt'), 'one\n')
    await g(dir, 'add', 'a.txt')
    await g(dir, 'commit', '-q', '-m', 'first')
    await g(dir, 'branch', 'topic')
    writeFileSync(join(dir, 'a.txt'), 'two\n')
    writeFileSync(join(dir, 'b.txt'), 'new\n')

    const files = await loader('files', dir)()
    assert.equal(files.repo, true)
    assert.equal(files.status.head, 'main')
    assert.deepEqual(files.status.entries.map(({ x, y, path }) => `${x}${y} ${path}`), [' M a.txt', '?? b.txt'])

    const branches = await loader('branches', dir)()
    assert.deepEqual(branches.branches.map(branch => [branch.name, branch.isCurrent]).sort(), [['main', true], ['topic', false]])

    const commits = await loader('commits', dir)()
    assert.equal(commits.commits.length, 1)
    assert.equal(commits.commits[0].subject, 'first')
    assert.equal(commits.unpushed, undefined)

    const again = loader('files', dir)
    assert.notEqual(await again(), undefined)
    assert.equal(await again(), undefined, 'a second run inside 2 s waits')
    assert.equal(existsSync(join(dir, '.git', 'index.lock')), false)

    const none = loader('files', empty)
    assert.deepEqual(await none(), { repo: false })
    assert.equal(await none(), undefined, 'the next look is 5 s away')
  } finally {
    rmSync(dir, { recursive: true, force: true })
    rmSync(empty, { recursive: true, force: true })
  }
})
