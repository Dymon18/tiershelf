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

export function normalizeTitle(value) {
  return value.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase()
    .replace(/['’]/g, '').replace(/[^\p{L}\p{N}]+/gu, ' ').trim()
}

const qualifiers = { movie: 'film', book: 'book', anime: 'TV series' }
const mediaDescriptions = { movie: /\bfilm\b/i, book: /book|novel|memoir/i, anime: /series|television|anime/i }
const ignoredWords = new Set(['a', 'an', 'and', 'of', 'the', 'in', 'to', 'for'])

async function wikipediaPages(parameters) {
  const endpoint = new URL('https://en.wikipedia.org/w/api.php')
  endpoint.search = new URLSearchParams({
    action: 'query', origin: '*', format: 'json', formatversion: '2', redirects: '1',
    prop: 'description|pageimages|pageprops', pithumbsize: '320', pilicense: 'any', ...parameters,
  })
  try {
    const response = await fetch(endpoint, { signal: AbortSignal.timeout(8000) })
    if (!response.ok) throw new Error()
    const payload = await response.json()
    if (payload.error) throw new Error()
    return (payload.query?.pages ?? []).filter((item) => !item.missing)
      .sort((a, b) => (a.index ?? 0) - (b.index ?? 0))
  } catch {
    throw new Error('Wikipedia could not be reached. Try again or paste a direct image URL.')
  }
}

function article(item) {
  return {
    title: item.title,
    description: item.description,
    entity: item.pageprops?.wikibase_item,
    image: item.thumbnail?.source,
    page: 'https://en.wikipedia.org/wiki/' + encodeURIComponent(item.title.replaceAll(' ', '_')),
  }
}

export async function findPoster({ title, type, year, page }) {
  const pageTitle = wikipediaTitle(page)
  if (page && !pageTitle) throw new Error('Enter an English Wikipedia article URL.')
  if (pageTitle) {
    const [match] = await wikipediaPages({ titles: pageTitle })
    if (!match?.thumbnail?.source) throw new Error('This Wikipedia article has no available image. Paste a direct image URL.')
    return article(match)
  }
  const cleaned = normalizeTitle(title)
  if (!cleaned) throw new Error('Enter a title or a Wikipedia page.')

  const search = (query) => wikipediaPages({
    generator: 'search', gsrsearch: query, gsrnamespace: '0', gsrlimit: '15',
  })
  const qualifier = qualifiers[type]
  const hasMediaQualifier = (item) => mediaDescriptions[type].test(item.title.match(/\(([^()]*)\)$/)?.[1] ?? '')
  const descriptive = (item) => mediaDescriptions[type].test(item.description ?? '') || hasMediaQualifier(item)
  const baseTitle = (item) => normalizeTitle(item.title.replace(/\s*\([^()]*\)$/, ''))
  const strict = await search(`intitle:"${cleaned}" ${qualifier} ${year}`.trim())
  const exact = strict.filter((item) =>
    (normalizeTitle(item.title) === cleaned && (item.thumbnail?.source || descriptive(item))) ||
    (baseTitle(item) === cleaned && hasMediaQualifier(item)))
  const yearMatches = year ? exact.filter((item) =>
    normalizeTitle(item.title + ' ' + (item.description ?? '')).split(' ').includes(year)) : []
  if (yearMatches.length === 1 && yearMatches[0].thumbnail?.source) return article(yearMatches[0])
  if (exact.length === 1 && exact[0].thumbnail?.source) return article(exact[0])
  if (exact.length > 1) return { suggestions: exact.map(article), ambiguous: true }

  const words = cleaned.split(' ').filter((word) => !ignoredWords.has(word))
  const pairs = words.slice(1).map((word, i) => words[i] + ' ' + word).reverse().slice(0, 3)
  const queryOptions = [`${cleaned} ${qualifier}`, ...pairs.map((pair) => `intitle:"${pair}" ${qualifier}`)]
  const results = await Promise.allSettled(queryOptions.map(search))
  const successful = results.filter((result) => result.status === 'fulfilled')
  if (!successful.length) throw results[0].reason
  const candidates = new Map()
  for (const item of [...exact, ...strict, ...successful.flatMap((result) => result.value)]) {
    if (!item.thumbnail?.source || !descriptive(item) || candidates.has(item.title)) continue
    const titleWords = baseTitle(item).split(' ').filter((word) => !ignoredWords.has(word))
    const overlap = titleWords.filter((word) => words.includes(word)).length
    if (overlap < Math.min(2, words.length)) continue
    const score = (2 * overlap) / (words.length + titleWords.length)
    candidates.set(item.title, { item, score })
  }
  const suggestions = [...candidates.values()].sort((a, b) => b.score - a.score).slice(0, 6)
    .map(({ item }) => article(item))
  if (!suggestions.length) throw new Error('No matching poster found. Paste a Wikipedia article or a direct image URL.')
  return { suggestions }
}

export async function findBookCover({ title, author, coverRequired = true }) {
  if (!title) throw new Error('Enter the book title.')
  const endpoint = new URL('https://openlibrary.org/search.json')
  endpoint.search = new URLSearchParams({ title, fields: 'title,author_name,cover_i,first_publish_year,subject', limit: '10' })
  if (author) endpoint.searchParams.set('author', author)

  let response
  try {
    response = await fetch(endpoint, { signal: AbortSignal.timeout(10000) })
  } catch {
    throw new Error('Open Library could not be reached. Try again or paste a direct cover image URL.')
  }
  if (!response.ok) throw new Error('Open Library could not be reached. Try again or paste a direct cover image URL.')

  const normalize = (value) => value.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().trim()
  const { docs = [] } = await response.json()
  const result = docs.find((book) => (!coverRequired || book.cover_i) && normalize(book.title) === normalize(title)
    && (!author || book.author_name?.some((name) => normalize(name) === normalize(author))))
  if (!result) throw new Error('No matching cover in Open Library. Try a Wikipedia article or a direct cover image URL.')
  return {
    image: result.cover_i ? `https://covers.openlibrary.org/b/id/${result.cover_i}-M.jpg?default=false` : undefined,
    year: result.first_publish_year,
    genres: result.subject ?? [],
    author: result.author_name?.join(', '),
  }
}

async function wikidata(ids, props) {
  const endpoint = new URL('https://www.wikidata.org/w/api.php')
  endpoint.search = new URLSearchParams({
    action: 'wbgetentities', ids: ids.join('|'), props, languages: 'en', origin: '*', format: 'json',
  })
  const response = await fetch(endpoint, { signal: AbortSignal.timeout(8000) })
  if (!response.ok) throw new Error('Wikidata could not be reached. Try again.')
  return (await response.json()).entities ?? {}
}

export async function findEntryDetails({ title, type, year, page, author, match }) {
  if (type === 'book' && !page) return findBookCover({ title, author, coverRequired: false })
  let source = match
  if (!source && page) {
    const articleTitle = wikipediaTitle(page)
    if (!articleTitle) throw new Error('Enter an English Wikipedia article URL.')
    const [item] = await wikipediaPages({ titles: articleTitle })
    if (!item) throw new Error('No matching Wikipedia article found.')
    source = article(item)
  }
  source ??= await findPoster({ title, type, year, page })
  if (source.suggestions || !source.entity) return source

  const entities = await wikidata([source.entity], 'claims')
  const claims = entities[source.entity]?.claims ?? {}
  const values = (key) => (claims[key] ?? []).filter((claim) => claim.rank !== 'deprecated')
    .map((claim) => claim.mainsnak.datavalue?.value).filter(Boolean)
  const dates = type === 'anime' ? [...values('P580'), ...values('P577')] : values('P577')
  const years = dates.filter((date) => date.precision >= 9)
    .map((date) => Number(date.time.match(/^\+(\d+)-/)?.[1])).filter((value) => value > 0 && value <= 9999)
  const genreIds = [...new Set(values('P136').map((value) => value.id).filter(Boolean))].slice(0, 20)
  const authorIds = type === 'book' ? values('P50').map((value) => value.id).filter(Boolean).slice(0, 5) : []
  const ids = [...new Set([...genreIds, ...authorIds])]
  let labels = {}
  if (ids.length) {
    try { labels = await wikidata(ids, 'labels') } catch { /* Release year is still available. */ }
  }
  const label = (id) => labels[id]?.labels?.en?.value
  return {
    ...source,
    year: years.length ? Math.min(...years) : undefined,
    genres: genreIds.map(label).filter(Boolean),
    author: authorIds.map(label).filter(Boolean).join(', '),
  }
}
