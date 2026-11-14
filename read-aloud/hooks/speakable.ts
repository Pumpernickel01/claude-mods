const cellsOf = (row: string) =>
  row
    .trim()
    .replace(/^\||\|$/g, '')
    .split('|')
    .map(cell => cell.trim())

const isDivider = (line: string | undefined) => line !== undefined && /^[ \t]*\|?[ \t:|-]*-{3,}[ \t:|-]*$/.test(line)

// A table as a voice can follow it: each row is its first cell, then every
// other cell led by its column's heading.
function tablesSpoken(markdown: string): string {
  const lines = markdown.split('\n')
  const out: string[] = []

  for (let at = 0; at < lines.length; at++) {
    const line = lines[at] as string
    if (!line.trim().startsWith('|') || !isDivider(lines[at + 1])) {
      out.push(line)
      continue
    }

    const headings = cellsOf(line)
    for (at += 2; at < lines.length && (lines[at] as string).trim().startsWith('|'); at++) {
      const [first = '', ...rest] = cellsOf(lines[at] as string)
      const told = rest.filter(Boolean).map((cell, column) => `${headings[column + 1] ?? ''}: ${cell}.`)
      out.push('', `${first}.`, ...told)
    }
    at -= 1
  }

  return out.join('\n')
}

// Lithuanian letters in the text: the answer is Lithuanian and needs a Lithuanian voice.
export const isLithuanian = (text: string) => (text.match(/[ąčęėįšųūž]/gi) ?? []).length >= 3

// The few words the reading adds itself, in the answer's language.
const WORDS = {
  en: { code: 'Code block skipped.', home: 'home folder, ', slash: ' slash ' },
  lt: { code: 'Kodo blokas praleistas.', home: 'namų aplankas, ', slash: ' ' },
}

// Markdown as a voice should say it: no symbols, no code, paths in words.
export function speakable(markdown: string): string {
  const words = WORDS[isLithuanian(markdown) ? 'lt' : 'en']

  return tablesSpoken(markdown.replace(/```[\s\S]*?(```|$)/g, `\n${words.code}\n`))
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/^[ \t]*(#{1,6}|>|[-*+]|\d+\.)\s+(.*)$/gm, '$2.')
    .replace(/[*`#<>|]/g, '')
    .replace(/_/g, ' ')
    .replace(/~\//g, words.home)
    .replace(/\/+(?=[\s.,;:)]|$)/gm, '')
    .replace(/\s*\/\s*/g, words.slash)
    .replace(/(^|\() slash /gm, '$1slash ')
    .replace(/([.:!?])\.$/gm, '$1')
    .replace(/\n{2,}/g, '\n')
    .trim()
}
