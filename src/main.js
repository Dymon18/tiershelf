import { createClient } from '@supabase/supabase-js'
import './style.css'
import { config } from './config.js'
import { findBookCover, findEntryDetails, findPoster, httpsUrl, normalizeTitle, wikipediaTitle } from './posters.js'

const grades = {
  S: '#f1a59c', A: '#f3bc91', B: '#f0db97', C: '#cfe69e',
  D: '#a6dbbc', E: '#a6cde8', F: '#c4b9ed',
}
const types = { movie: 'Movie', book: 'Book', anime: 'Series' }
const starterCategories = {
  movie: ['Studio Ghibli', 'Barbie', 'Marvel', 'DreamWorks', 'Disney', 'Animation', 'Musical', 'Action'],
  book: ['Fantasy', 'Sci-fi', 'Mystery', 'Romance', 'Nonfiction'],
  anime: ['Animation', 'Anime', 'K-drama', 'TV Show'],
}
const basicColumns = 'id,title,media_type,grade'
const detailColumns = basicColumns + ',categories,release_year,wikipedia_url,poster_url'
const fullColumns = detailColumns + ',author'
const rankedColumns = fullColumns + ',tier_position'
const db = config?.supabaseUrl && config?.supabasePublishableKey
  ? createClient(config.supabaseUrl, config.supabasePublishableKey, { auth: { flowType: 'pkce' } })
  : null

const byId = (id) => document.getElementById(id)
const board = byId('board')
const editor = byId('editor')
const login = byId('login-dialog')
const search = byId('search')
const accountButton = byId('account-button')
const githubButton = byId('github-login')
const titleInput = byId('entry-title')
const authorInput = byId('entry-author')
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
let filter = 'movie'
const activeCategories = new Set()
let canRank = true
let archiveDetails = true
let archiveColumns = fullColumns
let selectedCategories = new Set()
let lookupVersion = 0
let posterSuggestions = []
let selectedArtwork = null
let autofillVersion = 0
let ownerMode = false
let editing = null
let dragging = null
let pending = false
let pendingChanges = 0
let frameVersion = 0

function status(message) {
  byId('status').textContent = message
}

function categoriesFor(type) {
  const items = [...starterCategories[type]]
  for (const entry of entries) {
    if (entry.media_type === type) items.push(...(entry.categories ?? []))
  }
  const unique = new Map()
  for (const item of items) {
    const key = item.toLowerCase()
    if (!unique.has(key)) unique.set(key, item)
  }
  return [...unique.values()].sort((a, b) => a.localeCompare(b))
}

function renderCategoryFilter() {
  const heading = filter === 'book' ? 'Genres' : 'Categories'
  categoryFilter.hidden = ownerMode && !archiveDetails
  const options = categoriesFor(filter)
  const available = new Set(options.map((name) => name.toLowerCase()))
  for (const key of activeCategories) if (!available.has(key)) activeCategories.delete(key)
  byId('category-filter-label').textContent = activeCategories.size ? `${heading} (${activeCategories.size})` : heading
  const focused = document.activeElement?.dataset.category
  filterOptions.replaceChildren()
  let restoreFocus
  for (const name of options) {
    const key = name.toLowerCase()
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
  renderCategoryFilter()
  const query = normalizeTitle(search.value)
  const shelf = entries.filter((entry) => entry.media_type === filter)
  const keys = [...activeCategories]
  const matchCategory = (entry) => {
    if (!keys.length) return true
    const tags = new Set((entry.categories ?? []).map((name) => name.toLowerCase()))
    return categoryMatch.value === 'any' ? keys.some((key) => tags.has(key)) : keys.every((key) => tags.has(key))
  }
  const visible = shelf.filter((entry) =>
    matchCategory(entry) &&
    (normalizeTitle(entry.title).includes(query) || normalizeTitle(entry.author ?? '').includes(query)),
  )
  byId('count').textContent = visible.length === shelf.length
    ? `${shelf.length} ${shelf.length === 1 ? 'title' : 'titles'}`
    : `${visible.length} of ${shelf.length} titles`
  byId('hint').textContent = matchMedia('(pointer: coarse)').matches
    ? 'Tap a title to change its tier'
    : 'Drag titles within or between tiers'
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
      empty.textContent = query || activeCategories.size ? 'No matching titles' : 'No titles yet'
      cards.append(empty)
    }

    const add = document.createElement('button')
    add.type = 'button'
    add.className = 'add-tier'
    add.textContent = `+ Add New ${grade} Tier`
    add.addEventListener('click', () => openEditor(null, grade))
    cards.append(add)

    row.addEventListener('dragover', (event) => {
      if (!dragging) return
      event.preventDefault()
      event.dataTransfer.dropEffect = 'move'
      row.classList.add('over')
      clearDropMarkers()
      const target = event.target.closest('.card')
      if (target && target.dataset.entry !== dragging.id) {
        target.classList.add(isAfter(event, target) ? 'drop-after' : 'drop-before')
      }
    })
    row.addEventListener('dragleave', (event) => {
      if (row.contains(event.relatedTarget)) return
      row.classList.remove('over')
      clearDropMarkers()
    })
    row.addEventListener('drop', (event) => {
      event.preventDefault()
      row.classList.remove('over')
      clearDropMarkers()
      const entry = dragging
      dragging = null
      const target = event.target.closest('.card')
      if (entry && target?.dataset.entry !== entry.id) {
        moveEntry(entry, grade, target?.dataset.entry, target && isAfter(event, target))
      }
    })
    row.append(heading, cards)
    board.append(row)
  }
}

function isAfter(event, card) {
  const bounds = card.getBoundingClientRect()
  return event.clientX >= bounds.left + bounds.width / 2
}

function clearDropMarkers() {
  board.querySelectorAll('.drop-before, .drop-after').forEach((card) => card.classList.remove('drop-before', 'drop-after'))
}

async function moveEntry(entry, grade, anchorId, after = false, restoreFocus = false) {
  if (pendingChanges) return
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
      if (error) throw new Error('Could not move this title. If the archive changed on another device, refresh and try again.')
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
    if (restoreFocus) board.querySelector(`[data-entry="${CSS.escape(entry.id)}"]`)?.focus()
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
  card.draggable = true
  card.dataset.entry = entry.id
  const name = document.createElement('strong')
  name.textContent = entry.title
  const type = document.createElement('span')
  type.textContent = entry.author || types[entry.media_type]
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
  card.addEventListener('click', () => openEditor(entry))
  card.addEventListener('dragstart', (event) => {
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
  editing = entry ?? null
  byId('editor-title').textContent = entry ? 'Edit title' : 'Add title'
  titleInput.value = entry?.title ?? ''
  authorInput.value = entry?.author ?? ''
  typeInput.value = entry?.media_type ?? filter
  byId('entry-details').hidden = ownerMode && !archiveDetails
  byId('entry-artwork').hidden = ownerMode && !archiveDetails
  selectedCategories = new Set(entry?.categories ?? [])
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
  deleteButton.hidden = !entry
  editorStatus.textContent = ''
  editor.showModal()
  titleInput.focus()
}

function renderTypeFields() {
  const isBook = typeInput.value === 'book'
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
    const key = name.toLowerCase()
    if (!options.has(key)) options.set(key, name)
  }
  categoryList.replaceChildren()
  for (const [key, name] of options) {
    const label = document.createElement('label')
    const checkbox = document.createElement('input')
    checkbox.type = 'checkbox'
    checkbox.checked = [...selectedCategories].some((item) => item.toLowerCase() === key)
    checkbox.addEventListener('change', () => {
      if (checkbox.checked) selectedCategories.add(name)
      else for (const item of selectedCategories) {
        if (item.toLowerCase() === key) selectedCategories.delete(item)
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
  const canonical = [...selectedCategories, ...categoriesFor(typeInput.value)]
    .find((item) => item.toLowerCase() === name.toLowerCase()) ?? name
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
  if (pendingChanges) throw new Error('Please wait for the current change to finish.')
  const version = frameVersion
  const target = entries
  const { id, ...fields } = record
  let result = record
  if (ownerMode) {
    pendingChanges++
    accountButton.disabled = true
    try {
      const request = id
        ? db.from('tiershelf_entries').update(fields).eq('id', id)
        : db.from('tiershelf_entries').insert(fields)
      const { data, error } = await request.select(archiveColumns).single()
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
}

async function remove(entry) {
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
    await action()
    editor.close()
    const editedCard = focusId && document.querySelector(`[data-entry="${CSS.escape(focusId)}"]`)
    ;(editedCard || byId('add-button')).focus()
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
  selectedCategories = new Set(typeInput.value === editing?.media_type ? editing.categories ?? [] : [])
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
  byId('poster-options-field').hidden = true
  posterOptions.replaceChildren()
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
    posterStatus.textContent = 'This article has no available image. You can paste a direct image URL.'
  }
}

function showPosterSuggestions(result) {
  posterSuggestions = result.suggestions
  byId('poster-options-label').textContent = result.ambiguous ? 'Choose a match' : 'Did you mean?'
  posterOptions.replaceChildren(new Option('Select a Wikipedia title', ''))
  posterSuggestions.forEach((entry, index) => {
    const label = entry.description ? `${entry.title} — ${entry.description}` : entry.title
    posterOptions.add(new Option(label, String(index)))
  })
  byId('poster-options-field').hidden = false
  posterStatus.textContent = 'Choose a result to select its image.'
}

posterOptions.addEventListener('change', () => {
  const selected = posterOptions.selectedIndex > 0 ? posterSuggestions[Number(posterOptions.value)] : null
  resetAutofill()
  matchTitleButton.hidden = !selected || selected.title === titleInput.value
  if (selected) usePoster(selected)
  else previewPoster()
})
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
  const isBook = typeInput.value === 'book'
  posterStatus.textContent = isBook ? 'Looking for a cover…' : 'Looking for a poster…'
  try {
    const title = titleInput.value.trim()
    const poster = isBook && !page
      ? await findBookCover({ title, author: authorInput.value.trim() })
      : await findPoster({ title, type: typeInput.value, year: yearInput.value, page })
    if (version !== lookupVersion || !editor.open) return
    if (poster.suggestions) showPosterSuggestions(poster)
    else usePoster(poster)
  } catch (error) {
    if (version === lookupVersion && editor.open) posterStatus.textContent = error.message
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
    const knownCategories = categoriesFor(type)
    if (type === 'movie') {
      for (const name of ['Adventure', 'Comedy', 'Drama', 'Fantasy', 'Horror', 'Romance', 'Sci-fi', 'Thriller']) {
        if (!knownCategories.some((item) => normalizeTitle(item) === normalizeTitle(name))) knownCategories.push(name)
      }
    }
    const categories = knownCategories.filter((name) => {
      const key = normalizeTitle(name)
      return genres.some((genre) => genre === key || genre === key + ' film' || genre === key + ' novel' ||
        genreAliases[key]?.test(genre))
    })
    if (!selectedCategories.size && categories.length) {
      selectedCategories = new Set(categories.slice(0, 30))
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
      categories: [...selectedCategories], release_year: yearInput.value ? Number(yearInput.value) : null,
      wikipedia_url: page || null, poster_url: image || null,
    })
  }
  if (!ownerMode || archiveColumns.includes(',author')) {
    record.author = typeInput.value === 'book' ? authorInput.value.trim() || null : null
  }
  if ((!ownerMode || canRank) && editing &&
    (editing.grade !== record.grade || editing.media_type !== record.media_type)) record.tier_position = null
  else if (!ownerMode && editing) record.tier_position = editing.tier_position
  submitEditor(() => save(record), editing?.id)
})
deleteButton.addEventListener('click', () => submitEditor(() => remove(editing)))
filters.forEach((button) => button.addEventListener('click', () => {
  filter = button.dataset.filter
  activeCategories.clear()
  categoryFilter.open = false
  filters.forEach((item) => item.setAttribute('aria-pressed', String(item === button)))
  render()
}))
search.addEventListener('input', render)
categoryMatch.addEventListener('change', render)
byId('clear-categories').addEventListener('click', () => {
  activeCategories.clear()
  render()
})

function setMode(isOwner, records) {
  frameVersion++
  ownerMode = isOwner
  entries = records
  filter = 'movie'
  activeCategories.clear()
  categoryFilter.open = false
  search.value = ''
  filters.forEach((item) => item.setAttribute('aria-pressed', String(item.dataset.filter === filter)))
  if (editor.open) editor.close()
  byId('mode').textContent = isOwner ? 'Dymon mode' : 'Demo mode'
  accountButton.textContent = isOwner ? 'Sign out' : 'Dymon login'
  byId('footer-text').textContent = isOwner
    ? 'Your archive is private and saves to your account.'
    : 'Demo edits reset when you refresh or close this tab.'
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
      let columns = rankedColumns
      let result = await loadEntries(columns)
      const missingColumn = () => ['42703', 'PGRST204'].includes(result.error?.code)
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
      const { data, error } = result
      if (version !== authVersion) return
      accountButton.disabled = false
      if (error) {
        await db.auth.signOut({ scope: 'local' })
        status('Could not load your archive. Try signing in again.')
        return
      }
      archiveColumns = columns
      canRank = columns === rankedColumns
      archiveDetails = columns !== basicColumns
      setMode(true, data)
      if (!archiveDetails) status('Run the Supabase entry details migration to save categories and posters.')
      else if (!columns.includes(',author')) status('Run the Supabase book author migration to save authors.')
      else if (!canRank) status('Run the Supabase tier order migration to save custom positions.')
      else status('')
    }, 0)
  })
}
