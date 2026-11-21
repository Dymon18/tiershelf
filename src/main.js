import { createClient } from '@supabase/supabase-js'
import './style.css'
import { config } from './config.js'
import { createQueue } from './queue.js'
import { createViewer } from './viewer.js'
import { createMailbox } from './mailbox.js'
import { categoryKey, createCategoryEditor } from './categories.js'
import { celebrate, enterView, initDecorations } from './effects.js'
import { defaultMedia, media, mediaSetup } from './media.js'
import { createPokemonPicker, extraPokemonColumn, pokemonName, pokemonSprite, recommenderIds } from './pokemon.js'
import { findArtworkOptions, findEntryDetails, httpsUrl, normalizeTitle, wikipediaTitle } from './posters.js'

const grades = {
  S: '#f1a59c', A: '#f3bc91', B: '#f0db97', C: '#cfe69e',
  D: '#a6dbbc', E: '#a6cde8', F: '#c4b9ed',
}
const starterCategories = {
  movie: ['Studio Ghibli', 'Barbie', 'Marvel', 'DreamWorks', 'Disney', 'Animation', 'Musical', 'Action'],
  book: ['Fantasy', 'Sci-fi', 'Mystery', 'Romance', 'Nonfiction'],
  anime: ['Animation', 'Anime', 'K-drama', 'TV Show'],
  game: ['Action', 'Adventure', 'RPG', 'Puzzle', 'Simulation', 'Strategy', 'Co-op'],
}
const basicColumns = 'id,title,media_type,grade'
const detailColumns = basicColumns + ',categories,release_year,wikipedia_url,poster_url'
const fullColumns = detailColumns + ',author'
const rankedColumns = fullColumns + ',tier_position'
const movieColumn = ',movie_details'
const promotionColumns = ',recommender_pokemon_id,source_queue_id'
const movieFields = {
  directors: 'Director', studios: 'Studio', franchises: 'Franchise',
  languages: 'Original language', countries: 'Country of origin', runtime: 'Runtime (minutes)',
}
const movieFacets = { directors: 'Director', studios: 'Studio', franchises: 'Franchise',
  languages: 'Language', countries: 'Country', decade: 'Decade', runtime: 'Runtime' }
const movieInputs = {}
const db = config?.supabaseUrl && config?.supabasePublishableKey
  ? createClient(config.supabaseUrl, config.supabasePublishableKey, { auth: { flowType: 'pkce' } })
  : null

const queue = createQueue(db, (entry) => openEditor({
  title: entry.title, media_type: entry.media_type, author: entry.author,
  poster_url: entry.artwork_url, source_queue_id: entry.id,
  recommender_pokemon_id: entry.source === 'recommended' ? entry.pokemon_id : null,
  extra_pokemon_ids: entry.source === 'recommended' ? entry.extra_pokemon_ids : [],
}), (type) => mailbox.setMedia(type ?? filter))

const byId = (id) => document.getElementById(id)
const board = byId('board')
const editor = byId('editor')
const login = byId('login-dialog')
const search = byId('search')
const accountButton = byId('account-button')
const githubButton = byId('github-login')
const titleInput = byId('entry-title')
const authorInput = byId('entry-author')
const recommenderPicker = createPokemonPicker(
  byId('entry-recommender'), byId('entry-recommender-preview'), byId('entry-add-pokemon'),
)
const gradeInput = byId('entry-grade')
const typeInput = byId('entry-type')
const categoryFilter = byId('category-filter')
const filterOptions = byId('filter-options')
const categoryMatch = byId('category-match')
const categoryList = byId('entry-categories')
const newCategory = byId('new-category')
const yearInput = byId('entry-year')
const wikiInput = byId('entry-wikipedia')
const posterInput = byId('entry-poster')
const alternativePoster = byId('alternative-poster')
const artworkChoices = [
  { input: posterInput, button: byId('select-poster'), image: byId('poster-preview') },
  { input: alternativePoster, button: byId('select-alternative'), image: byId('alternative-preview') },
]
const autofillButton = byId('autofill-details')
const autofillStatus = byId('autofill-status')
const posterStatus = byId('poster-status')
const posterButton = byId('find-poster')
const posterOptions = byId('poster-options')
const matchTitleButton = byId('match-poster-title')
const editorStatus = byId('editor-status')
const saveButton = byId('save-button')
const deleteButton = byId('delete-button')
const filters = document.querySelectorAll('[data-filter]')
const demo = [
  {
    id: 'demo-kpop', title: 'KPop Demon Hunters', media_type: 'movie', grade: 'A',
    categories: ['Animation', 'Musical'], release_year: 2025,
    wikipedia_url: 'https://en.wikipedia.org/wiki/KPop_Demon_Hunters',
    poster_url: 'https://upload.wikimedia.org/wikipedia/en/9/93/KPDHposter.jpeg',
  },
  {
    id: 'demo-pacific-rim', title: 'Pacific Rim', media_type: 'movie', grade: 'S',
    categories: ['Action', 'Sci-fi'], release_year: 2013,
    wikipedia_url: 'https://en.wikipedia.org/wiki/Pacific_Rim_(film)',
    poster_url: 'https://upload.wikimedia.org/wikipedia/en/f/f3/Pacific_Rim_FilmPoster.jpeg',
  },
  {
    id: 'demo-avatar', title: 'Avatar: The Last Airbender', media_type: 'anime', grade: 'S',
    categories: ['Animation', 'TV Show'], release_year: 2005,
    wikipedia_url: 'https://en.wikipedia.org/wiki/Avatar:_The_Last_Airbender',
    poster_url: 'https://static.tvmaze.com/uploads/images/medium_portrait/79/199224.jpg',
  },
]
let entries = demo
let filter = defaultMedia
const activeCategories = new Set()
let canRank = true
const movieFilterValues = new Map()
for (const [key, name] of Object.entries(movieFields)) {
  const label = document.createElement('label')
  const input = document.createElement('input')
  input.id = 'movie-' + key
  if (key === 'runtime') {
    input.type = 'number'
    input.min = '1'
    input.max = '1440'
  } else {
    input.maxLength = 250
    input.placeholder = 'Separate multiple values with commas'
  }
  label.append(name, input)
  byId('movie-fields').append(label)
  movieInputs[key] = input
}
let archiveDetails = true
let archiveColumns = fullColumns
let selectedCategories = new Set()
let lookupVersion = 0
let posterSuggestions = []
let selectedArtwork = null
let autofillVersion = 0
let ownerMode = false
let viewerMode = false
const viewer = createViewer(db, {
  mode: () => ownerMode ? 'dymon' : viewerMode ? 'viewer' : 'demo',
  openSnapshot: ({ shelf, questlog }, key, recommending) => {
    setMode(false, shelf, questlog, key)
    if (recommending) {
      setMediaFilter(recommending)
      mailbox.open(recommending)
    }
  },
  exit: () => setMode(false, demo),
})
const mailbox = createMailbox(db, queue.openRecommendation, (type) => viewer.showUnlock(type))
let editing = null
let editorReturn = null
let dragging = null
let pending = false
let pendingChanges = 0
let frameVersion = 0
const categoryEditor = createCategoryEditor(db, {
  getType: () => filter,
  getNames: categoriesFor,
  onUpdate(type, previous, renamed) {
    if (filter === type && activeCategories.delete(categoryKey(previous))) activeCategories.add(categoryKey(renamed))
    if (editor.open) {
      selectedCategories = new Set(categoryEditor.labels(typeInput.value, selectedCategories))
      renderCategoryPicker()
    }
    render()
  },
})

function status(message) {
  byId('status').textContent = message
}

function categoriesFor(type) {
  const items = viewerMode ? [] : [...starterCategories[type], ...categoryEditor.preferredLabels(type)]
  for (const entry of entries) {
    if (entry.media_type === type) items.push(...(entry.categories ?? []))
  }
  return categoryEditor.labels(type, items).sort((a, b) => a.localeCompare(b))
}

function movieFacetValues(entry, key) {
  if (key === 'decade') return entry.release_year ? [Math.floor(entry.release_year / 10) * 10 + 's'] : []
  if (key === 'runtime') {
    const minutes = entry.movie_details?.runtime
    return minutes > 0 ? [minutes <= 90 ? '90 min or less' : minutes <= 120 ? '91–120 min' : 'Over 120 min'] : []
  }
  const values = entry.movie_details?.[key]
  return Array.isArray(values) ? values.filter((value) => typeof value === 'string') : []
}

function renderMovieFilters() {
  const panel = byId('movie-filters')
  const focused = document.activeElement?.dataset.movieFacet
  panel.replaceChildren()
  if (filter !== 'movie') return
  const movies = entries.filter((entry) => entry.media_type === 'movie')
  for (const [key, name] of Object.entries(movieFacets)) {
    const options = new Map()
    for (const entry of movies) {
      for (const value of movieFacetValues(entry, key)) options.set(normalizeTitle(value), value)
    }
    if (!options.has(movieFilterValues.get(key))) movieFilterValues.delete(key)
    if (!options.size) continue
    const select = document.createElement('select')
    select.dataset.movieFacet = key
    select.add(new Option('Any ' + name.toLowerCase(), ''))
    for (const [code, value] of [...options].sort((a, b) => a[1].localeCompare(b[1]))) {
      select.add(new Option(value, code))
    }
    select.value = movieFilterValues.get(key) ?? ''
    select.addEventListener('change', () => {
      if (select.value) movieFilterValues.set(key, select.value)
      else movieFilterValues.delete(key)
      render()
    })
    const label = document.createElement('label')
    label.append(name, select)
    panel.append(label)
    if (focused === key) select.focus()
  }
}

function renderCategoryFilter() {
  renderMovieFilters()
  const heading = filter === 'book' ? 'Genres' : 'Categories'
  byId('manage-categories').textContent = 'Edit ' + heading.toLowerCase()
  categoryFilter.hidden = ownerMode && !archiveDetails
  const options = categoriesFor(filter)
  const available = new Set(options.map(categoryKey))
  for (const key of activeCategories) if (!available.has(key)) activeCategories.delete(key)
  const count = activeCategories.size + (filter === 'movie' ? movieFilterValues.size : 0)
  byId('category-filter-label').textContent = count ? `${heading} (${count})` : heading
  const focused = document.activeElement?.dataset.category
  filterOptions.replaceChildren()
  let restoreFocus
  for (const name of options) {
    const key = categoryKey(name)
    const label = document.createElement('label')
    const checkbox = document.createElement('input')
    checkbox.type = 'checkbox'
    checkbox.dataset.category = key
    checkbox.checked = activeCategories.has(key)
    checkbox.addEventListener('change', () => {
      if (checkbox.checked) activeCategories.add(key)
      else activeCategories.delete(key)
      render()
    })
    if (focused === key) restoreFocus = checkbox
    label.append(checkbox, name)
    filterOptions.append(label)
  }
  restoreFocus?.focus()
}

function tierOrder(a, b) {
  return (a.tier_position ?? Infinity) - (b.tier_position ?? Infinity)
}

function render() {
  queue.setPromotionState(ownerMode && archiveColumns.includes(promotionColumns),
    new Set(entries.map((entry) => entry.source_queue_id).filter(Boolean)))
  renderCategoryFilter()
  const query = normalizeTitle(search.value)
  const shelf = entries.filter((entry) => entry.media_type === filter)
  const keys = [...activeCategories]
  const matchCategory = (entry) => {
    if (!keys.length) return true
    const tags = new Set(categoryEditor.labels(entry.media_type, entry.categories ?? []).map(categoryKey))
    return categoryMatch.value === 'any' ? keys.some((key) => tags.has(key)) : keys.every((key) => tags.has(key))
  }
  const visible = shelf.filter((entry) =>
    matchCategory(entry) &&
    (filter !== 'movie' || [...movieFilterValues].every(([key, value]) =>
      movieFacetValues(entry, key).some((item) => normalizeTitle(item) === value))) &&
    (normalizeTitle(entry.title).includes(query) || normalizeTitle(entry.author ?? '').includes(query)),
  )
  byId('count').textContent = visible.length === shelf.length
    ? `${shelf.length} ${shelf.length === 1 ? 'title' : 'titles'}`
    : `${visible.length} of ${shelf.length} titles`
  const rankUnavailable = ownerMode && !canRank
  byId('rank-setup').hidden = !rankUnavailable
  byId('hint').textContent = viewerMode ? 'Read-only · tap a title for details' : matchMedia('(pointer: coarse)').matches
    ? 'Tap a title to change its tier'
    : rankUnavailable ? 'Drag titles between tiers' : 'Drag titles within or between tiers'
  board.replaceChildren()
  for (const [grade, color] of Object.entries(grades)) {
    const row = document.createElement('section')
    row.className = 'tier'
    row.setAttribute('aria-labelledby', `tier-${grade}`)
    row.style.setProperty('--grade', color)

    const heading = document.createElement('h2')
    heading.id = `tier-${grade}`
    heading.className = 'grade'
    heading.textContent = grade
    heading.setAttribute('aria-label', `Tier ${grade}`)

    const cards = document.createElement('div')
    cards.className = 'cards'
    const ranked = visible.filter((entry) => entry.grade === grade).sort(tierOrder)
    for (const entry of ranked) cards.append(createCard(entry))
    if (!ranked.length) {
      const empty = document.createElement('span')
      empty.className = 'empty'
      empty.textContent = query || activeCategories.size || movieFilterValues.size ? 'No matching titles' : 'No titles yet'
      cards.append(empty)
    }

    if (!viewerMode) {
      const add = document.createElement('button')
      add.type = 'button'
      add.className = 'add-tier'
      add.textContent = `+ Add New ${grade} Tier`
      add.addEventListener('click', () => openEditor(null, grade))
      cards.append(add)
    }

    row.addEventListener('dragover', (event) => {
      if (!dragging) return
      event.preventDefault()
      const blocked = rankUnavailable && dragging.grade === grade
      event.dataTransfer.dropEffect = blocked ? 'none' : 'move'
      row.classList.toggle('over', !blocked)
      clearDropMarkers()
      if (blocked) return
      const { anchor, after } = dropPosition(event, cards, dragging.id)
      anchor?.classList.add(after ? 'drop-after' : 'drop-before')
    })
    row.addEventListener('dragleave', (event) => {
      if (row.contains(event.relatedTarget)) return
      row.classList.remove('over')
      clearDropMarkers()
    })
    row.addEventListener('drop', (event) => {
      if (!dragging) return
      event.preventDefault()
      row.classList.remove('over')
      clearDropMarkers()
      const entry = dragging
      dragging = null
      if (event.target.closest('.card')?.dataset.entry === entry.id) return
      const { anchor, after } = dropPosition(event, cards, entry.id)
      if (anchor || entry.grade !== grade) moveEntry(entry, grade, anchor?.dataset.entry, after)
    })
    row.append(heading, cards)
    board.append(row)
  }
}

function dropPosition(event, container, entryId) {
  const candidates = [...container.querySelectorAll('.card')]
    .filter((card) => card.dataset.entry !== entryId)
    .map((card) => ({ card, bounds: card.getBoundingClientRect() }))
  if (!candidates.length) return { anchor: null, after: false }

  const distance = ({ bounds }) => Math.max(bounds.top - event.clientY, event.clientY - bounds.bottom, 0)
  // A tier can wrap. Resolve the visual row before resolving its horizontal gap.
  const nearest = candidates.reduce((best, candidate) => distance(candidate) < distance(best) ? candidate : best)
  const line = candidates.filter(({ bounds }) => Math.abs(bounds.top - nearest.bounds.top) < 2)
  const next = line.find(({ bounds }) => event.clientX < bounds.left + bounds.width / 2)
  return next ? { anchor: next.card, after: false } : { anchor: line.at(-1).card, after: true }
}

function clearDropMarkers() {
  board.querySelectorAll('.drop-before, .drop-after').forEach((card) => card.classList.remove('drop-before', 'drop-after'))
}

async function moveEntry(entry, grade, anchorId, after = false, restoreFocus = false) {
  if (pendingChanges || viewerMode) return
  if (ownerMode && !canRank) {
    if (entry.grade !== grade) {
      try { await save({ ...entry, grade }) } catch (error) { status(error.message) }
    } else {
      status('Run the Supabase tier order migration to save custom positions.')
    }
    return
  }

  const version = frameVersion
  const movingOwner = ownerMode
  try {
    if (movingOwner) {
      pendingChanges++
      accountButton.disabled = true
      const { data, error } = await db.rpc('tiershelf_move_entry', {
        entry_id: entry.id, destination: grade, anchor_id: anchorId ?? null, place_after: Boolean(after),
      })
      if (error?.code === 'PGRST202' || error?.code === '42703') {
        canRank = false
        render()
        throw new Error('Run the SB tier order migration and refresh to save custom positions.')
      }
      if (error) throw new Error('Could not move this title. Refresh and try again.')
      if (version !== frameVersion) return
      const positions = new Map(data.map((item) => [item.id, item]))
      entries = entries.map((item) => positions.has(item.id) ? { ...item, ...positions.get(item.id) } : item)
    } else {
      const ordered = entries.filter((item) => item.id !== entry.id &&
        item.media_type === entry.media_type && item.grade === grade).sort(tierOrder)
      const anchor = ordered.findIndex((item) => item.id === anchorId)
      const position = anchor < 0 ? ordered.length : anchor + Number(Boolean(after))
      ordered.splice(position, 0, entry)
      ordered.forEach((item, index) => {
        item.grade = grade
        item.tier_position = index + 1
      })
    }
    render()
    if (restoreFocus) board.querySelector(`[data-entry="${CSS.escape(entry.id)}"]`)?.focus({ preventScroll: true })
    status(`Moved ${entry.title} in tier ${grade}.`)
  } catch (error) {
    status(error.message)
  } finally {
    if (movingOwner) {
      pendingChanges--
      if (version === frameVersion) accountButton.disabled = false
    }
  }
}

function createCard(entry) {
  const card = document.createElement('button')
  card.type = 'button'
  card.className = 'card'
  card.draggable = !viewerMode
  card.dataset.entry = entry.id
  const name = document.createElement('strong')
  name.textContent = entry.title
  const type = document.createElement('span')
  type.textContent = entry.author || media[entry.media_type]?.name || ''
  card.append(name, type)
  const titleWithYear = entry.release_year ? `${entry.title} (${entry.release_year})` : entry.title
  card.title = entry.author ? `${titleWithYear} by ${entry.author}` : titleWithYear
  const poster = httpsUrl(entry.poster_url)
  if (poster) {
    const image = document.createElement('img')
    image.alt = ''
    image.loading = 'lazy'
    image.draggable = false
    image.referrerPolicy = 'no-referrer'
    image.addEventListener('error', () => {
      image.remove()
      card.classList.remove('poster-card')
    }, { once: true })
    card.classList.add('poster-card')
    card.prepend(image)
    image.src = poster.href
  }
  const recommenders = recommenderIds(entry.recommender_pokemon_id, entry.extra_pokemon_ids)
  if (recommenders.length) {
    const icons = document.createElement('span')
    icons.className = 'entry-recommender-sprites'
    icons.setAttribute('aria-hidden', 'true')
    icons.append(...recommenders.slice(0, 3).map(pokemonSprite))
    if (recommenders.length > 3) {
      const more = document.createElement('span')
      more.textContent = '+' + (recommenders.length - 3)
      icons.append(more)
    }
    card.append(icons)
    card.classList.add('has-recommender')
    const names = recommenders.map(pokemonName).join(', ')
    card.title += ` · Recommended by ${names}`
    card.setAttribute('aria-label', `${entry.title}, recommended by ${names}`)
  }
  card.addEventListener('click', () => openEditor(entry))
  card.addEventListener('dragstart', (event) => {
    if (viewerMode) { event.preventDefault(); return }
    dragging = entry
    event.dataTransfer.setData('text/plain', entry.id)
    event.dataTransfer.effectAllowed = 'move'
  })
  card.addEventListener('keydown', (event) => {
    if (!event.altKey || !['ArrowLeft', 'ArrowRight'].includes(event.key)) return
    const after = event.key === 'ArrowRight'
    const target = after ? card.nextElementSibling : card.previousElementSibling
    if (!target?.dataset.entry) return
    event.preventDefault()
    moveEntry(entry, entry.grade, target.dataset.entry, after, true)
  })
  card.addEventListener('dragend', () => {
    dragging = null
    clearDropMarkers()
    board.querySelectorAll('.over').forEach((row) => row.classList.remove('over'))
  })
  return card
}

function openEditor(entry, defaultGrade = 'A') {
  if (viewerMode) {
    if (entry) viewer.inspect(entry)
    return
  }
  const promoting = Boolean(entry?.source_queue_id && !entry?.id)
  editorReturn = { x: window.scrollX, y: window.scrollY, grade: entry?.grade ?? defaultGrade,
    queueId: promoting ? entry.source_queue_id : null }
  editing = entry ?? null
  byId('editor-title').textContent = promoting ? 'Promote to MyShelf' : entry?.id ? 'Edit title' : 'Add title'
  titleInput.value = entry?.title ?? ''
  authorInput.value = entry?.author ?? ''
  const recommendField = byId('entry-recommender-field')
  recommendField.hidden = ownerMode && !archiveColumns.includes(promotionColumns)
  recommenderPicker.reset(recommenderIds(entry?.recommender_pokemon_id, entry?.extra_pokemon_ids),
    !ownerMode || archiveColumns.includes(extraPokemonColumn), recommendField.hidden)
  for (const [key, input] of Object.entries(movieInputs)) {
    const value = entry?.movie_details?.[key]
    input.value = key === 'runtime' ? value ?? '' : (Array.isArray(value) ? value.join(', ') : '')
  }
  typeInput.value = entry?.media_type ?? filter
  byId('entry-details').hidden = ownerMode && !archiveDetails
  byId('entry-artwork').hidden = ownerMode && !archiveDetails
  selectedCategories = new Set(categoryEditor.labels(typeInput.value, entry?.categories ?? []))
  newCategory.value = ''
  yearInput.value = entry?.release_year ?? ''
  wikiInput.value = entry?.wikipedia_url ?? ''
  posterInput.value = entry?.poster_url ?? ''
  alternativePoster.value = ''
  selectedArtwork = posterInput.value ? posterInput : null
  resetPosterLookup()
  renderTypeFields()
  renderCategoryPicker()
  previewPoster()
  gradeInput.value = entry?.grade ?? defaultGrade
  deleteButton.hidden = !entry?.id
  editorStatus.textContent = ''
  editor.showModal()
  titleInput.focus()
}

function renderTypeFields() {
  const isBook = typeInput.value === 'book'
  const movieDetails = byId('movie-details')
  movieDetails.hidden = typeInput.value !== 'movie' || (ownerMode && !archiveColumns.includes(movieColumn))
  movieDetails.disabled = movieDetails.hidden
  byId('entry-author-field').hidden = !isBook || (ownerMode && !archiveColumns.includes(',author'))
  byId('artwork-legend').textContent = isBook ? 'Cover' : 'Poster'
  posterButton.textContent = isBook ? 'Find cover' : 'Find poster'
  posterInput.parentElement.firstChild.textContent = isBook ? 'Cover image URL ' : 'Poster image URL '
  alternativePoster.parentElement.firstChild.textContent = isBook ? 'Alternative cover URL ' : 'Alternative poster URL '
}

function renderCategoryPicker() {
  byId('category-legend').textContent = typeInput.value === 'book' ? 'Genres' : 'Categories'
  newCategory.placeholder = typeInput.value === 'book' ? 'New genre' : 'New category'
  const options = new Map()
  for (const name of [...categoriesFor(typeInput.value), ...selectedCategories]) {
    const key = categoryKey(name)
    if (!options.has(key)) options.set(key, name)
  }
  categoryList.replaceChildren()
  for (const [key, name] of options) {
    const label = document.createElement('label')
    const checkbox = document.createElement('input')
    checkbox.type = 'checkbox'
    checkbox.checked = [...selectedCategories].some((item) => categoryKey(item) === key)
    checkbox.addEventListener('change', () => {
      if (checkbox.checked) selectedCategories.add(name)
      else for (const item of selectedCategories) {
        if (categoryKey(item) === key) selectedCategories.delete(item)
      }
    })
    label.append(checkbox, name)
    categoryList.append(label)
  }
}

function addCategory() {
  const name = newCategory.value.trim().replace(/\s+/g, ' ')
  if (!name) {
    newCategory.focus()
    return
  }
  const resolved = categoryEditor.label(typeInput.value, name)
  const canonical = [...selectedCategories, ...categoriesFor(typeInput.value)]
    .find((item) => categoryKey(item) === categoryKey(resolved)) ?? resolved
  selectedCategories.add(canonical)
  newCategory.value = ''
  renderCategoryPicker()
  newCategory.focus()
}

function previewPoster() {
  for (const { input, button, image } of artworkChoices) {
    const url = httpsUrl(input.value.trim())
    button.hidden = !url
    button.setAttribute('aria-pressed', String(Boolean(url) && selectedArtwork === input))
    if (url && image.getAttribute('src') !== url.href) {
      image.hidden = false
      image.src = url.href
    } else if (!url) image.removeAttribute('src')
  }
}

for (const { input, button, image } of artworkChoices) {
  image.referrerPolicy = 'no-referrer'
  image.addEventListener('error', () => {
    image.hidden = true
    posterStatus.textContent = 'An image could not load. Try another direct image URL.'
  })
  button.addEventListener('click', () => {
    selectedArtwork = selectedArtwork === input ? null : input
    previewPoster()
    posterStatus.textContent = selectedArtwork ? 'Image selected.' : 'Image unselected.'
  })
}

async function save(record) {
  if (viewerMode) return
  if (pendingChanges) throw new Error('Please wait for the current change to finish.')
  const version = frameVersion
  const target = entries
  const { id, source_queue_id, ...fields } = record
  if (!id && source_queue_id) fields.source_queue_id = source_queue_id
  let result = record
  if (ownerMode) {
    pendingChanges++
    accountButton.disabled = true
    try {
      const request = id
        ? db.from('tiershelf_entries').update(fields).eq('id', id)
        : db.from('tiershelf_entries').insert(fields)
      const { data, error } = await request.select(archiveColumns).single()
      if (error?.code === '23505' && source_queue_id) throw new Error('This entry is already in MyShelf. Refresh to see it.')
      if (error?.code === '23514' && fields.media_type === 'game') throw new Error(mediaSetup)
      if (error) throw new Error('Could not save this title. Try again.')
      result = data
    } finally {
      pendingChanges--
      accountButton.disabled = false
    }
  }
  if (version !== frameVersion) return
  const index = target.findIndex((entry) => entry.id === id)
  if (index === -1) target.push({ ...result, id: result.id ?? crypto.randomUUID() })
  else target[index] = result
  render()
  status(`Saved ${record.title} in tier ${record.grade}.`)
  return !id && record.media_type === 'book'
}

async function remove(entry) {
  if (viewerMode) return
  if (pendingChanges) throw new Error('Please wait for the current change to finish.')
  const version = frameVersion
  const target = entries
  if (ownerMode) {
    pendingChanges++
    accountButton.disabled = true
    try {
      const { error } = await db.from('tiershelf_entries').delete().eq('id', entry.id).select('id').single()
      if (error) throw new Error('Could not delete this title. Try again.')
    } finally {
      pendingChanges--
      accountButton.disabled = false
    }
  }
  if (version !== frameVersion) return
  const index = target.findIndex((item) => item.id === entry.id)
  if (index !== -1) target.splice(index, 1)
  render()
  status(`Deleted ${entry.title}.`)
}

async function submitEditor(action, focusId) {
  if (pending) return
  pending = true
  saveButton.disabled = true
  deleteButton.disabled = true
  byId('close-editor').disabled = true
  editorStatus.textContent = ''
  try {
    const returnTo = editorReturn
    const addedBook = await action()
    editor.close()
    if (addedBook) celebrate('shelf')
    const editedCard = focusId && board.querySelector(`[data-entry="${CSS.escape(focusId)}"]`)
    const tierAdd = byId('tier-' + returnTo.grade)?.parentElement.querySelector('.add-tier')
    const focusTarget = editedCard || tierAdd || byId('add-button')
    if (returnTo.queueId) queue.finishPromotion(returnTo.queueId)
    else focusTarget.focus({ preventScroll: true })
    if (window.scrollX !== returnTo.x || window.scrollY !== returnTo.y) {
      window.scrollTo({ left: returnTo.x, top: returnTo.y, behavior: 'instant' })
    }
  } catch (error) {
    editorStatus.textContent = error.message
  } finally {
    pending = false
    saveButton.disabled = false
    deleteButton.disabled = false
    byId('close-editor').disabled = false
  }
}

typeInput.addEventListener('change', () => {
  selectedCategories = new Set(typeInput.value === editing?.media_type
    ? categoryEditor.labels(typeInput.value, editing.categories ?? []) : [])
  newCategory.value = ''
  resetPosterLookup()
  renderTypeFields()
  renderCategoryPicker()
})
byId('add-category').addEventListener('click', addCategory)
newCategory.addEventListener('keydown', (event) => {
  if (event.key === 'Enter') {
    event.preventDefault()
    addCategory()
  }
})
function resetAutofill() {
  autofillVersion++
  autofillButton.disabled = false
  autofillStatus.textContent = ''
}

function resetPosterLookup() {
  resetAutofill()
  lookupVersion++
  posterButton.disabled = false
  posterStatus.textContent = ''
  posterSuggestions = []
  posterOptions.disabled = true
  posterOptions.replaceChildren(new Option('Find a poster or cover to see matches', ''))
  matchTitleButton.hidden = true
}

function usePoster(poster) {
  if (poster.page) wikiInput.value = poster.page
  if (poster.image) {
    posterInput.value = poster.image
    selectedArtwork = posterInput
    previewPoster()
    posterStatus.textContent = 'Image selected. Click it to unselect.'
  } else {
    if (selectedArtwork === posterInput) selectedArtwork = null
    posterInput.value = ''
    previewPoster()
    posterStatus.textContent = 'This article has no available image. You can paste a direct image URL.'
  }
}

function showPosterSuggestions(result) {
  posterSuggestions = result.suggestions
  posterOptions.disabled = false
  posterOptions.replaceChildren(new Option('Choose a result', ''))
  posterSuggestions.forEach((entry, index) => {
    const label = entry.description ? `${entry.title} — ${entry.description}` : entry.title
    posterOptions.add(new Option(label, String(index)))
  })
  if (result.preferred) {
    posterOptions.value = String(posterSuggestions.indexOf(result.preferred))
    applyPosterSuggestion()
  } else posterStatus.textContent = 'Choose a result under Title to see its image.'
}

function applyPosterSuggestion() {
  const selected = posterOptions.selectedIndex > 0 ? posterSuggestions[Number(posterOptions.value)] : null
  resetAutofill()
  matchTitleButton.hidden = !selected || selected.title === titleInput.value
  if (selected) usePoster(selected)
  else previewPoster()
}
posterOptions.addEventListener('change', applyPosterSuggestion)
matchTitleButton.addEventListener('click', () => {
  const selected = posterSuggestions[Number(posterOptions.value)]
  if (!selected || posterOptions.selectedIndex < 1) return
  resetAutofill()
  titleInput.value = selected.title
  matchTitleButton.hidden = true
  titleInput.focus()
})
for (const { input } of artworkChoices) {
  input.addEventListener('input', () => {
    posterStatus.textContent = ''
    if (input === posterInput && !selectedArtwork && httpsUrl(input.value.trim())) selectedArtwork = input
    if (selectedArtwork === input && !input.value.trim()) selectedArtwork = null
    previewPoster()
  })
}
titleInput.addEventListener('keydown', (event) => {
  if (event.key !== 'Enter' || event.isComposing) return
  event.preventDefault()
  if (!byId('entry-artwork').hidden) posterButton.click()
})
for (const input of [titleInput, authorInput, yearInput, wikiInput]) {
  input.addEventListener('input', resetPosterLookup)
}

posterButton.addEventListener('click', async () => {
  resetPosterLookup()
  previewPoster()
  const version = lookupVersion
  posterButton.disabled = true
  const page = wikiInput.value.trim()
  const type = typeInput.value
  posterOptions.options[0].textContent = 'Looking for matches…'
  posterStatus.textContent = type === 'book' ? 'Looking for a cover…' : 'Looking for a poster…'
  try {
    const result = await findArtworkOptions({ title: titleInput.value.trim(), type, year: yearInput.value,
      page, author: authorInput.value.trim() })
    if (version !== lookupVersion || !editor.open) return
    showPosterSuggestions(result)
  } catch (error) {
    if (version === lookupVersion && editor.open) {
      posterOptions.options[0].textContent = 'No matches available'
      posterStatus.textContent = error.message
    }
  } finally {
    if (version === lookupVersion) posterButton.disabled = false
  }
})

const genreAliases = {
  'sci fi': /science fiction|^sci fi$/,
  animation: /animat/,
  anime: /\banime\b/,
  'k drama': /korean drama|^k drama$/,
  'tv show': /television (series|show|program)|^tv show$/,
  musical: /musical/,
  action: /\baction\b/,
}

autofillButton.addEventListener('click', async () => {
  resetAutofill()
  const version = autofillVersion
  const title = titleInput.value.trim()
  if (!title) {
    autofillStatus.textContent = 'Enter a title first.'
    titleInput.focus()
    return
  }
  autofillButton.disabled = true
  autofillStatus.textContent = 'Looking up details…'
  try {
    const type = typeInput.value
    const page = wikiInput.value.trim()
    const match = posterOptions.selectedIndex > 0 ? posterSuggestions[Number(posterOptions.value)] : null
    const details = await findEntryDetails({ title, type, page, year: yearInput.value,
      author: authorInput.value.trim(), match })
    if (version !== autofillVersion || !editor.open) return
    if (details.suggestions) {
      showPosterSuggestions(details)
      posterOptions.focus()
      autofillStatus.textContent = 'Choose a title above, then try autofill again.'
      return
    }
    const filled = []
    if (details.year && !yearInput.value) {
      yearInput.value = details.year
      filled.push('release year')
    }
    if (details.author && !authorInput.value.trim() && !byId('entry-author-field').hidden) {
      authorInput.value = details.author.slice(0, 200)
      filled.push('author')
    }
    const genres = (details.genres ?? []).map(normalizeTitle)
    const movie = details.movie ?? {}
    if (type === 'movie' && !byId('movie-details').hidden) {
      for (const [key, input] of Object.entries(movieInputs)) {
        const value = movie[key]
        const text = Array.isArray(value) ? value.filter((name) => name.length <= 250).join(', ') : value
        if (!input.value.trim() && text && String(text).length <= 250) {
          input.value = text
          filled.push(movieFields[key].toLowerCase())
        }
      }
    }
    const knownCategories = categoriesFor(type)
    if (type === 'movie') {
      for (const name of ['Adventure', 'Comedy', 'Drama', 'Fantasy', 'Horror', 'Romance', 'Sci-fi', 'Thriller', 'Pixar', 'Sony Pictures Animation']) {
        const label = categoryEditor.label(type, name)
        if (!knownCategories.some((item) => normalizeTitle(item) === normalizeTitle(label))) knownCategories.push(label)
      }
    }
    const companies = [...(movie.studios ?? []), ...(movie.franchises ?? [])].map(normalizeTitle)
    const movieTags = {
      'studio ghibli': /\bstudio ghibli\b/,
      dreamworks: /\bdreamworks\b/,
      disney: /\bdisney\b/,
      pixar: /\bpixar\b/,
      marvel: /\bmarvel\b/,
      barbie: /\bbarbie\b/,
      'sony pictures animation': /\bsony pictures animation\b/,
    }
    const categories = knownCategories.filter((name) => categoryEditor.lookupNames(type, name).some((label) => {
      const key = normalizeTitle(label)
      if (type === 'movie' && movieTags[key]?.test(companies.join(' '))) return true
      if (type === 'movie' && key === 'animation' &&
        /studio ghibli|pixar|sony pictures animation|dreamworks animation|disney animation/.test(companies.join(' '))) return true
      if (type === 'movie' && key === 'barbie' && /^barbie\b/.test(normalizeTitle(details.title ?? title))) return true
      return genres.some((genre) => genre === key || genre === key + ' film' || genre === key + ' novel' ||
        genreAliases[key]?.test(genre))
    }))
    const selectedKeys = new Set([...selectedCategories].map(normalizeTitle))
    const additions = categories.filter((name) => !selectedKeys.has(normalizeTitle(name))).slice(0, Math.max(0, 30 - selectedCategories.size))
    if (additions.length) {
      for (const name of additions) selectedCategories.add(name)
      renderCategoryPicker()
      filled.push(type === 'book' ? 'genres' : 'categories')
    }
    if (!wikiInput.value && details.page) wikiInput.value = details.page
    if (!posterInput.value.trim() && details.image) {
      posterInput.value = details.image
      previewPoster()
      posterStatus.textContent = 'Click the image to select it.'
    }
    autofillStatus.textContent = filled.length
      ? `Filled ${filled.join(', ')}. Review them before saving.`
      : 'No additional details were filled. You can edit the fields manually.'
  } catch (error) {
    if (version === autofillVersion && editor.open) autofillStatus.textContent = error.message
  } finally {
    if (version === autofillVersion) autofillButton.disabled = false
  }
})

for (const grade of Object.keys(grades)) gradeInput.add(new Option(grade, grade))
byId('add-button').addEventListener('click', () => openEditor())
byId('close-editor').addEventListener('click', () => editor.close())
editor.addEventListener('cancel', (event) => {
  if (pending) event.preventDefault()
})
byId('entry-form').addEventListener('submit', (event) => {
  event.preventDefault()
  const title = titleInput.value.trim()
  if (!title) {
    editorStatus.textContent = 'Enter a title.'
    titleInput.focus()
    return
  }
  const record = { id: editing?.id, title, media_type: typeInput.value, grade: gradeInput.value }
  if (!byId('entry-recommender-field').hidden) {
    const ids = recommenderPicker.read()
    if (!ids) return
    record.recommender_pokemon_id = ids[0] ?? null
    if (!ownerMode || archiveColumns.includes(extraPokemonColumn)) record.extra_pokemon_ids = ids.slice(1)
  }
  if (!editing?.id && editing?.source_queue_id) record.source_queue_id = editing.source_queue_id
  if (!ownerMode || archiveDetails) {
    if (newCategory.value.trim()) addCategory()
    const page = wikiInput.value.trim()
    const image = selectedArtwork?.value.trim() ?? ''
    if (page && !wikipediaTitle(page)) {
      editorStatus.textContent = 'Enter an English Wikipedia article URL.'
      wikiInput.focus()
      return
    }
    if (image && !httpsUrl(image)) {
      editorStatus.textContent = 'Enter a direct HTTPS image URL.'
      selectedArtwork.focus()
      return
    }
    if (selectedCategories.size > 30) {
      editorStatus.textContent = 'Choose 30 categories or fewer for each title.'
      return
    }
    Object.assign(record, {
      categories: categoryEditor.labels(record.media_type, selectedCategories), release_year: yearInput.value ? Number(yearInput.value) : null,
      wikipedia_url: page || null, poster_url: image || null,
    })
  }
  if (!ownerMode || archiveColumns.includes(',author')) {
    record.author = typeInput.value === 'book' ? authorInput.value.trim() || null : null
  }
  if (!ownerMode || archiveColumns.includes(movieColumn)) {
    record.movie_details = record.media_type === 'movie' ? Object.fromEntries(Object.entries(movieInputs)
      .filter(([, input]) => input.value.trim())
      .map(([key, input]) => [key, key === 'runtime' ? Number(input.value) : input.value.split(',').map((value) => value.trim()).filter(Boolean)])) : null
  }
  if ((!ownerMode || canRank) && editing &&
    (editing.grade !== record.grade || editing.media_type !== record.media_type)) record.tier_position = null
  else if (!ownerMode && editing) record.tier_position = editing.tier_position
  submitEditor(() => save(record), editing?.id)
})
deleteButton.addEventListener('click', () => submitEditor(() => remove(editing)))
function setMediaFilter(type, animate = false) {
  filter = type
  document.body.dataset.media = type
  if (document.body.dataset.view !== 'queue') mailbox.setMedia(type)
  activeCategories.clear()
  movieFilterValues.clear()
  categoryFilter.open = false
  filters.forEach((item) => item.setAttribute('aria-pressed', String(item.dataset.filter === type)))
  render()
  if (animate) enterView(board)
}
filters.forEach((button) => button.addEventListener('click', () => {
  if (filter !== button.dataset.filter) setMediaFilter(button.dataset.filter, true)
}))
search.addEventListener('input', render)
categoryMatch.addEventListener('change', render)
byId('clear-categories').addEventListener('click', () => {
  activeCategories.clear()
  movieFilterValues.clear()
  render()
})

function setMode(isOwner, records, viewerQueue = null, viewerKey = null) {
  frameVersion++
  ownerMode = isOwner
  viewerMode = viewerQueue !== null
  const mode = isOwner ? 'dymon' : viewerMode ? 'viewer' : 'demo'
  document.body.dataset.mode = mode
  viewer.setMode(mode)
  mailbox.setMode(mode, viewerKey)
  queue.setOwner(isOwner, viewerQueue)
  entries = records
  categoryEditor.setOwner(isOwner && archiveDetails)
  dragging = null
  filter = defaultMedia
  document.body.dataset.media = filter
  if (document.body.dataset.view !== 'queue') mailbox.setMedia(filter)
  activeCategories.clear()
  movieFilterValues.clear()
  categoryFilter.open = false
  search.value = ''
  filters.forEach((item) => item.setAttribute('aria-pressed', String(item.dataset.filter === filter)))
  if (editor.open) editor.close()
  byId('mode').textContent = isOwner ? 'Dymon mode' : viewerMode ? 'Friend mode' : 'Demo mode'
  byId('add-button').hidden = viewerMode
  accountButton.textContent = isOwner ? 'Sign out' : 'Dymon login'
  byId('footer-text').textContent = isOwner
    ? 'Your archive saves to your account.'
    : viewerMode ? 'You’re viewing Dymon’s collection in read-only mode.'
      : 'Demo edits reset when you refresh or close this tab.'
  status('')
  render()
}

accountButton.addEventListener('click', async () => {
  if (ownerMode) {
    accountButton.disabled = true
    const { error } = await db.auth.signOut({ scope: 'local' })
    accountButton.disabled = false
    if (error) status('Could not sign out. Try again.')
    return
  }
  byId('login-description').textContent = db
    ? 'Sign in with GitHub to open your private archive.'
    : 'Dymon login will be available once this site is connected to Supabase.'
  githubButton.hidden = !db
  login.showModal()
})
byId('close-login').addEventListener('click', () => login.close())
githubButton.addEventListener('click', async () => {
  githubButton.disabled = true
  const redirectTo = new URL('./', location.href).href
  const { error } = await db.auth.signInWithOAuth({ provider: 'github', options: { redirectTo } })
  if (error) {
    byId('login-description').textContent = 'Could not start GitHub sign-in. Try again.'
    githubButton.disabled = false
  }
})

initDecorations()
render()
if (db) {
  let authVersion = 0
  db.auth.onAuthStateChange((event, session) => {
    if (!['INITIAL_SESSION', 'SIGNED_IN', 'SIGNED_OUT'].includes(event)) return
    if (event === 'SIGNED_IN' && ownerMode) return
    const version = ++authVersion
    setTimeout(async () => {
      if (version !== authVersion) return
      if (!session) {
        if (ownerMode) {
          setMode(false, demo)
          status('Signed out.')
        }
        return
      }
      accountButton.disabled = true
      const { data: allowed, error: accessError } = await db.rpc('tiershelf_is_owner')
      if (version !== authVersion) return
      if (!allowed || accessError) {
        accountButton.disabled = false
        await db.auth.signOut({ scope: 'local' })
        status(accessError ? 'Could not verify archive access.' : 'This GitHub account does not have access to Dymon mode.')
        return
      }
      const loadEntries = (columns) => db.from('tiershelf_entries')
        .select(columns).order('created_at').order('id')
      let columns = rankedColumns + movieColumn + promotionColumns + extraPokemonColumn
      let result = await loadEntries(columns)
      const missingColumn = () => ['42703', 'PGRST204'].includes(result.error?.code)
      if (missingColumn()) {
        columns = rankedColumns + movieColumn + promotionColumns
        result = await loadEntries(columns)
      }
      if (missingColumn()) {
        columns = rankedColumns + movieColumn
        result = await loadEntries(columns)
      }
      if (missingColumn()) {
        columns = rankedColumns
        result = await loadEntries(columns)
      }
      if (missingColumn()) {
        columns = fullColumns + movieColumn
        result = await loadEntries(columns)
      }
      if (missingColumn()) {
        columns = fullColumns
        result = await loadEntries(columns)
      }
      if (missingColumn()) {
        columns = detailColumns
        result = await loadEntries(columns)
      }
      if (missingColumn()) {
        columns = basicColumns
        result = await loadEntries(columns)
      }
      if (!result.error && !columns.includes(promotionColumns)) {
        let addedColumns = promotionColumns + extraPokemonColumn
        let extras = await loadEntries('id' + addedColumns)
        if (['42703', 'PGRST204'].includes(extras.error?.code)) {
          addedColumns = promotionColumns
          extras = await loadEntries('id' + addedColumns)
        }
        if (!extras.error) {
          const byEntry = new Map(extras.data.map((entry) => [entry.id, entry]))
          result.data = result.data.map((entry) => ({ ...entry, ...byEntry.get(entry.id) }))
          columns += addedColumns
        }
      }
      const { data, error } = result
      if (version !== authVersion) return
      accountButton.disabled = false
      if (error) {
        await db.auth.signOut({ scope: 'local' })
        status('Could not load your archive. Try signing in again.')
        return
      }
      archiveColumns = columns
      canRank = columns.includes(',tier_position')
      archiveDetails = columns.includes(',categories')
      setMode(true, data)
      if (!archiveDetails) status('Run the Supabase entry details migration to save categories and posters.')
      else if (!columns.includes(',author')) status('Run the Supabase book author migration to save authors.')
      else if (!columns.includes(movieColumn) && canRank) status('Run the Supabase movie details migration to save the new movie fields.')
      else status('')
    }, 0)
  })
}
