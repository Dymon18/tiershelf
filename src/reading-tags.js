import { normalizeTitle } from './posters.js'

const cues = new Map([
  ['cozy', { label: 'Happy & cozy', pattern: /\b(?:co[sz]y|comfort read|feel good|heartwarming|heart warming)\b/ }],
  ['gut-wrenching', { label: 'Gut-wrenching', pattern: /\b(?:gut wrenching|heart wrenching|heartbreak(?:ing)?|tear ?jerker|emotionally devastating)\b/ }],
  ['fast-paced', { label: 'Fast-paced', pattern: /\b(?:fast paced|breakneck pace|page turner|propulsive|action packed)\b/ }],
  ['slow-paced', { label: 'Slow-paced', pattern: /\b(?:slow paced|slow moving|leisurely pace|unhurried pace)\b/ }],
  ['straightforward', { label: 'Straightforward language', pattern: /\b(?:plain (?:language|prose|english)|simple (?:language|prose)|straightforward (?:language|prose)|accessible prose|easy to follow|easy to read)\b/ }],
  ['light-read', { label: 'Light read', pattern: /\b(?:light read|light ?hearted|comfort read|beach read|feel good|easy read)\b/ }],
])

export const readingTags = new Map([...cues].map(([id, { label }]) => [id, label]))

export async function suggestBookTags(book) {
  let work
  if (/^\/works\/OL[0-9]+W$/.test(book.workKey ?? '')) {
    try {
      const response = await fetch(`https://openlibrary.org${book.workKey}.json`, { signal: AbortSignal.timeout(8000) })
      if (response.ok) work = await response.json()
    } catch {
      // Search results still supply subjects when the work record is unavailable.
    }
  }

  const description = work?.description?.value ?? work?.description
  const subjects = Array.isArray(work?.subjects) ? work.subjects : []
  const evidence = [description, ...subjects, ...(book.genres ?? [])].filter((value) => typeof value === 'string').map(normalizeTitle)
  const tags = [...cues].filter(([, { pattern }]) => evidence.some((text) => {
    const match = pattern.exec(text)
    return match && !/\b(?:not|never|anything but) (?:\w+ ){0,2}$/.test(text.slice(0, match.index))
  })).map(([id]) => id)
  // Descriptions can compare different parts of a book. Leave its pace to the reader when signals conflict.
  return tags.includes('fast-paced') && tags.includes('slow-paced')
    ? tags.filter((id) => id !== 'fast-paced' && id !== 'slow-paced')
    : tags
}
