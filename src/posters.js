export function httpsUrl(value) {
  try {
    const url = new URL(value)
    return url.protocol === 'https:' && !url.username && !url.password ? url : null
  } catch {
    return null
  }
}

export function wikipediaTitle(value) {
  const url = httpsUrl(value)
  if (url?.hostname !== 'en.wikipedia.org' || !url.pathname.startsWith('/wiki/')) return null
  try {
    return decodeURIComponent(url.pathname.slice(6)).replaceAll('_', ' ').trim() || null
  } catch {
    return null
  }
}

export async function findPoster({ title, type, year, page }) {
  const endpoint = new URL('https://en.wikipedia.org/w/api.php')
  const common = { action: 'query', origin: '*', format: 'json', formatversion: '2',
    redirects: '1', prop: 'pageimages', pithumbsize: '320', pilicense: 'any' }
  const pageTitle = wikipediaTitle(page)
  if (page && !pageTitle) throw new Error('Enter an English Wikipedia article URL.')
  if (!pageTitle && !title) throw new Error('Enter a title or a Wikipedia page.')
  const qualifier = { movie: 'film', book: 'book', anime: 'TV series' }[type]
  const quotedTitle = title.replaceAll('"', '')
  const search = `intitle:"${quotedTitle}" ${qualifier} ${year}`.trim()
  endpoint.search = new URLSearchParams({
    ...common,
    ...(pageTitle ? { titles: pageTitle } : { generator: 'search', gsrsearch: search, gsrnamespace: '0', gsrlimit: '6' }),
  })
  let response
  try {
    response = await fetch(endpoint, { signal: AbortSignal.timeout(10000) })
  } catch {
    throw new Error('Wikipedia could not be reached. Try again or paste a direct image URL.')
  }
  if (!response.ok) throw new Error('Wikipedia could not be reached. Try again or paste a direct image URL.')
  const payload = await response.json()
  const pages = (payload.query?.pages ?? []).sort((a, b) => (a.index ?? 0) - (b.index ?? 0))
  const normalize = (value) => value.trim().toLowerCase().replace(/[’‘]/g, "'")
  const match = pages.find((item) => {
    if (!item.thumbnail?.source) return false
    if (pageTitle) return true
    const name = normalize(item.title)
    const needle = normalize(title)
    const descriptors = { movie: /film/, book: /book|novel|memoir/, anime: /series|television|anime/ }
    return name === needle || (name.startsWith(needle + ' (') && descriptors[type].test(name.slice(needle.length)))
  })
  if (!match) throw new Error('No matching poster found. Paste a Wikipedia article or a direct image URL.')
  return {
    image: match.thumbnail.source,
    page: 'https://en.wikipedia.org/wiki/' + encodeURIComponent(match.title.replaceAll(' ', '_')),
  }
}
