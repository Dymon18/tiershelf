export const media = {
  book: { name: 'Book', label: 'Books', phrase: 'a book', icons: ['📚', '🐛', '📖'] },
  movie: { name: 'Movie', label: 'Movies', phrase: 'a movie', icons: ['🎥', '🍿'] },
  anime: { name: 'Series', label: 'Series', phrase: 'a series', icons: ['📺', '📀'] },
  game: { name: 'Game', label: 'Games', phrase: 'a game', icons: ['🎮', '🕹️'] },
}

export const defaultMedia = 'book'
export const mediaKeys = Object.keys(media)
export const mediaKind = (type) => Object.hasOwn(media, type) ? type : defaultMedia
export const recommendLabel = (type) => 'Recommend me ' + media[mediaKind(type)].phrase + '!'

// Older deployments have a book-only RPC and no media column. Tag its optional
// author field only for non-book recommendations, so the same mailbox still receives them.
export const legacyMediaPrefix = 'tiershelf-recommendation:v1:'

export function readRecommendation(row) {
  const legacyType = row.author?.startsWith(legacyMediaPrefix) ? row.author.slice(legacyMediaPrefix.length) : null
  if (legacyType && legacyType !== 'book' && Object.hasOwn(media, legacyType)) {
    return { ...row, media_type: legacyType, author: null }
  }
  return { ...row, media_type: mediaKind(row.media_type) }
}

export const mediaSetup = 'Run the TierShelf Games and recommendations migration in Supabase to save this entry.'
