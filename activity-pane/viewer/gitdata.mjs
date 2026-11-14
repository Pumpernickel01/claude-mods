// What the git viewers know: git run as a read-only child (an argument array, never a shell)
// and its answers parsed by pure functions, so `node --test` can check them from literal output.
import { execFile } from 'node:child_process'
import { readdirSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'

export const NOT_REPO = { repo: false }
const US = '\x1f'
const FILES_MS = 2000
const RECHECK_MS = 5000

// `git status --porcelain=v2 --branch -z`: the branch, and one entry per changed path.
export const parseStatus = text => {
  const status = { head: '', upstream: undefined, ahead: 0, behind: 0, entries: [] }
  const fields = text.split('\0')
  for (let at = 0; at < fields.length; at += 1) {
    const field = fields[at]
    const parts = field.split(' ')
    if (field.startsWith('# branch.head ')) status.head = field.slice(14)
    else if (field.startsWith('# branch.upstream ')) status.upstream = field.slice(18)
    else if (field.startsWith('# branch.ab ')) {
      status.ahead = Number(parts[2].slice(1))
      status.behind = Number(parts[3].slice(1))
    } else if (field.startsWith('1 ')) status.entries.push({ ...xyOf(parts[1]), path: parts.slice(8).join(' ') })
    else if (field.startsWith('2 ')) {
      // a rename or copy: its original path is the next field
      status.entries.push({ ...xyOf(parts[1]), path: parts.slice(9).join(' '), orig: fields[(at += 1)] })
    } else if (field.startsWith('u ')) status.entries.push({ ...xyOf(parts[1]), path: parts.slice(10).join(' ') })
    else if (field.startsWith('? ')) status.entries.push({ x: '?', y: '?', path: field.slice(2) })
  }

  return status
}

const xyOf = xy => ({ x: xy[0] === '.' ? ' ' : xy[0], y: xy[1] === '.' ? ' ' : xy[1] })

// `for-each-ref --format=%(HEAD)<US>%(refname:short)<US>%(upstream:short)<US>%(upstream:track)<US>%(committerdate:relative)`
export const BRANCH_FORMAT = ['%(HEAD)', '%(refname:short)', '%(upstream:short)', '%(upstream:track)', '%(committerdate:relative)'].join(US)

export const parseBranches = text =>
  text
    .split('\n')
    .filter(line => line !== '')
    .map(line => {
      const [head, name, upstream, track, age] = line.split(US)
      const ahead = /ahead (\d+)/.exec(track)?.[1]
      const behind = /behind (\d+)/.exec(track)?.[1]

      return {
        isCurrent: head === '*',
        name,
        hasUpstream: upstream !== '',
        isGone: track === '[gone]',
        ahead: Number(ahead ?? 0),
        behind: Number(behind ?? 0),
        age,
      }
    })

// `git log --graph --color=never --format=<US>%H<US>%D<US>%s<US>%cr`: a graph prefix, then the
// fields; a line with no fields is graph only.
export const LOG_FORMAT = ['', '%H', '%D', '%s', '%cr'].join(US)

export const parseLog = text =>
  text
    .split('\n')
    .filter(line => line !== '')
    .map(line => {
      const parts = line.split(US)
      if (parts.length < 5) return { graph: line }

      return {
        graph: parts[0],
        sha: parts[1],
        refs: parts[2] === '' ? [] : parts[2].split(', '),
        subject: parts.slice(3, -1).join(' '),
        age: parts.at(-1),
      }
    })

export const parseShas = text => new Set(text.split('\n').filter(line => line !== ''))

// "17 hours ago" as "17h", "3 weeks ago" as "3w": the short form a narrow pane has room for.
const UNITS = { second: 's', minute: 'm', hour: 'h', day: 'd', week: 'w', month: 'mo', year: 'y' }
export const shortAge = text => {
  const found = /^(\d+) (second|minute|hour|day|week|month|year)/.exec(text)

  return found === null ? '' : `${found[1]}${UNITS[found[2]]}`
}

const ENV = { ...process.env, GIT_OPTIONAL_LOCKS: '0', GIT_TERMINAL_PROMPT: '0', LC_ALL: 'C' }

// Git's stdout, or undefined when it failed or timed out.
export const git = (root, args) =>
  new Promise(done => {
    execFile(
      'git',
      ['--no-optional-locks', '-c', 'core.fsmonitor=false', ...args],
      { cwd: root, env: ENV, timeout: 3000, maxBuffer: 4 * 1024 * 1024, encoding: 'utf8' },
      (error, stdout) => done(error === null ? stdout : undefined),
    )
  })

// What changes when a branch, a commit or a ref does: if none of these files moved, Branches
// and Commits have nothing new to read. shortcut: a linked worktree keeps its refs elsewhere, so
// they are not watched there; upgrade by reading `git rev-parse --git-common-dir`.
const stampOf = dir => {
  try {
    statSync(join(dir, 'HEAD'))
    const watched = ['HEAD', 'packed-refs', 'logs/HEAD', 'refs', 'refs/heads', 'refs/tags', 'refs/remotes']
    try {
      for (const remote of readdirSync(join(dir, 'refs/remotes'))) watched.push(join('refs/remotes', remote))
    } catch {
      // no remotes
    }

    return watched
      .map(path => {
        try {
          return statSync(join(dir, path)).mtimeMs
        } catch {
          return 0
        }
      })
      .join(':')
  } catch {
    return undefined
  }
}

// One viewer's data source: `load()` gives its next feed, or undefined when nothing is due or
// changed (or a run is still under way). `kind` is 'files', 'branches' or 'commits'.
export function loader(kind, root) {
  let isBusy = false
  let dir
  let checkedAt = 0
  let ranAt = 0
  let stamp = null

  const fetchOf = async () => {
    if (kind === 'files') {
      const out = await git(root, ['status', '--porcelain=v2', '--branch', '-z'])

      return out === undefined ? undefined : { repo: true, status: parseStatus(out) }
    }
    if (kind === 'branches') {
      const out = await git(root, ['for-each-ref', '--sort=-committerdate', 'refs/heads', `--format=${BRANCH_FORMAT}`])

      return { repo: true, branches: parseBranches(out ?? '') }
    }
    const [log, unpushed] = await Promise.all([
      git(root, ['log', '--graph', '--color=never', `--format=${LOG_FORMAT}`, '-n', '100']),
      git(root, ['rev-list', '@{u}..HEAD']),
    ])

    return { repo: true, commits: parseLog(log ?? ''), unpushed: unpushed === undefined ? undefined : parseShas(unpushed) }
  }

  return async () => {
    if (isBusy) return undefined

    isBusy = true
    try {
      const now = Date.now()
      if (dir === undefined) {
        if (checkedAt !== 0 && now - checkedAt < RECHECK_MS) return undefined

        checkedAt = now
        const out = await git(root, ['rev-parse', '--git-dir'])
        if (out === undefined) return NOT_REPO

        dir = resolve(root, out.trim())
        stamp = null
        ranAt = 0
      }
      if (kind === 'files') {
        if (now - ranAt < FILES_MS) return undefined

        ranAt = now
      } else {
        const next = stampOf(dir)
        if (next === stamp) return undefined

        stamp = next
      }

      // the repository is gone: look for it again in 5 s
      const feed = stamp === undefined && kind !== 'files' ? undefined : await fetchOf()
      if (feed === undefined) {
        dir = undefined
        checkedAt = now

        return NOT_REPO
      }

      return feed
    } finally {
      isBusy = false
    }
  }
}
