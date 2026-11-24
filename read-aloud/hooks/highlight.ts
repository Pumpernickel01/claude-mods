import type { Spoken } from '../types'

// `say --interactive=red` redraws its line at every word and paints the word
// being said between these two marks. Real timing, no guessing.
const OPEN = '\x1b[31m'
const CLOSE = '\x1b(B\x1b[m'
const CONTROL = /\x1b\[[0-9;?]*[A-Za-z]|\x1b\(B/g

// The newest complete line in what `say` wrote so far, and the unfinished tail
// to prepend to the next piece. A line is complete once a \r or \n follows it.
export function lastSpoken(buffer: string): { spoken: Spoken; rest: string } {
  const lines = buffer.split(/[\r\n]/)
  const rest = lines.pop() ?? ''
  let spoken: Spoken = null

  for (const line of lines) {
    const open = line.indexOf(OPEN)
    const close = line.indexOf(CLOSE)
    if (open === -1 || close < open) continue

    const clean = (text: string) => text.replace(CONTROL, '')
    spoken = {
      before: clean(line.slice(0, open)).trimStart(),
      word: clean(line.slice(open + OPEN.length, close)),
      after: clean(line.slice(close + CLOSE.length)),
    }
  }

  return { spoken, rest }
}
