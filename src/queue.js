import { createPokemonPicker, ditto, extraPokemonColumn, pokemonName, pokemonSprite,
  populatePokemonOptions, recommenderIds } from './pokemon.js'
import { findArtworkOptions, findBookOptions, httpsUrl, normalizeTitle } from './posters.js'
import { readingTags, suggestBookTags } from './reading-tags.js'
import { celebrate, enterView } from './effects.js'
import { defaultMedia, media, mediaKeys, mediaKind, mediaSetup } from './media.js'
import { readViewState, saveViewState } from './view-state.js'

const sources = [
  { key: 'recommended', label: 'SideQuest', description: 'Recommendations', add: 'Add to SideQuest', icon: '🧭' },
  { key: 'self', label: 'BackLog', description: 'Personal hunts', add: 'Add to BackLog', icon: '🪵' },
]
const tableName = 'tiershelf_queue'
const basicColumns = 'id,title,media_type,author,source,pokemon_id,created_at'
const artworkColumns = basicColumns + ',artwork_url'
const priorityColumn = ',queue_position'
const readingColumns = ',reading_tags,source_recommendation_id'
const standardColumns = artworkColumns + priorityColumn
const queueHash = '#questlog'
const queueHashes = new Set([queueHash, '#pokequeue'])
const byId = (id) => document.getElementById(id)
function cell(tag, value) {
  const node = document.createElement(tag)
  node.textContent = value
  return node
}

export function createQueue(db, openTierEditor, onMedia) {
  const nav = byId('archive-nav')
  const archive = byId('archive-view')
  const view = byId('queue-view')
  const board = byId('queue-columns')
  const status = byId('queue-status')
  const setup = byId('queue-setup')
  const retry = byId('queue-retry')
  const dialog = byId('queue-editor')
  const form = byId('queue-form')
  const title = byId('queue-title')
  const author = byId('queue-author')
  const lookup = byId('queue-find-artwork')
  const titleOptions = byId('queue-title-options')
  const matchTitle = byId('queue-match-title')
  const artwork = byId('queue-artwork-url')
  const artworkPreview = byId('queue-artwork-preview')
  const lookupStatus = byId('queue-lookup-status')
  const alias = byId('queue-alias')
  const preview = byId('queue-alias-preview')
  const picker = createPokemonPicker(alias, preview, byId('queue-add-pokemon'))
  const formStatus = byId('queue-editor-status')
  const save = byId('queue-save')
  const remove = byId('queue-delete')
  const close = byId('close-queue-editor')
  const archiveButton = byId('show-archive')
  const queueButton = byId('show-queue')
  const compactButton = byId('queue-compact')
  const readingFilter = byId('queue-reading-filter')
  const filterPanel = readingFilter.closest('details')
  const readingTagField = byId('queue-reading-tags')
  const tagSuggestion = byId('queue-tag-suggestion')
  const suggestTags = byId('queue-suggest-tags')
  const tagStatus = byId('queue-tag-status')
  const readingInputs = new Map()
  for (const [id, name] of readingTags) {
    readingFilter.add(new Option(name, id))
    const label = cell('label', name)
    const input = document.createElement('input')
    input.type = 'checkbox'
    label.prepend(input)
    readingTagField.insertBefore(label, tagSuggestion)
    readingInputs.set(id, input)
  }
  const sourceFilters = new Map(sources.map(({ key }) => [key, byId('queue-filter-' + key)]))
  let compact = false
  let promoted = new Set()
  let canPromote = false
  let dragging = null
  const expanded = new Set(mediaKeys)
  let queueMedia = defaultMedia
  let lookupVersion = 0
  let tagLookupVersion = 0
  let matches = []
  let autofilledAuthor = ''
  let columns = standardColumns + readingColumns + extraPokemonColumn
  let owner = false
  let viewer = false
  let version = 0
  let entries = []
  let loadRequest = null
  let loaded = false
  let pending = false
  let activeEntry = null
  let trigger = null

  function rememberQueueView() {
    saveViewState('queue', {
      media: queueMedia,
      expanded: [...expanded],
      compact,
      sources: [...sourceFilters].filter(([, input]) => input.checked).map(([key]) => key),
      readingTag: readingFilter.value,
      filtersOpen: filterPanel.open,
    })
  }

  function restoreQueueView() {
    const state = readViewState('queue')
    compact = state.compact === true
    queueMedia = compact ? defaultMedia : mediaKind(state.media)
    expanded.clear()
    for (const key of mediaKeys) {
      if (!Array.isArray(state.expanded) || state.expanded.includes(key)) expanded.add(key)
    }
    for (const [key, input] of sourceFilters) {
      input.checked = !Array.isArray(state.sources) || state.sources.includes(key)
    }
    readingFilter.value = readingTags.has(state.readingTag) ? state.readingTag : ''
    filterPanel.open = state.filtersOpen === true
    compactButton.setAttribute('aria-pressed', String(compact))
  }

  function selectMedia(type) {
    queueMedia = type
    document.body.dataset.queueMedia = type
    onMedia(type)
  }

  function switchView(showQueue, remember = false) {
    const switched = archive.hidden !== showQueue
    if (remember) {
      const url = new URL(location.href)
      if (showQueue) url.hash = queueHash
      else if (queueHashes.has(url.hash)) url.hash = ''
      history.replaceState(history.state, '', url)
    }
    document.body.dataset.view = showQueue ? 'queue' : 'archive'
    view.hidden = !showQueue
    archive.hidden = showQueue
    archiveButton.setAttribute('aria-pressed', String(!showQueue))
    queueButton.setAttribute('aria-pressed', String(showQueue))
    if (showQueue) selectMedia(queueMedia)
    else onMedia(null)
    if (switched) enterView(showQueue ? view : archive)
  }

  function render() {
    board.replaceChildren()
    board.dataset.compact = String(compact)
    const visibleTypes = compact ? [defaultMedia] : mediaKeys
    for (const key of visibleTypes) {
      const column = document.createElement('section')
      column.className = 'queue-column'
      column.dataset.queueType = key
      column.dataset.expanded = String(expanded.has(key))
      const header = document.createElement('h2')
      const toggle = document.createElement('button')
      toggle.type = 'button'
      toggle.className = 'queue-toggle'
      toggle.setAttribute('aria-expanded', String(expanded.has(key)))
      toggle.setAttribute('aria-controls', `queue-${key}-body`)
      const chevron = cell('span', '⌄')
      chevron.setAttribute('aria-hidden', 'true')
      toggle.append(media[key].label, chevron)
      header.append(toggle)

      const body = document.createElement('div')
      body.id = `queue-${key}-body`
      body.className = 'queue-column-body'
      body.inert = !expanded.has(key)
      const content = document.createElement('div')
      content.className = 'queue-column-content'
      const group = entries.filter((entry) => entry.media_type === key)
      const visibleSources = sources.filter(({ key: source }) => sourceFilters.get(source).checked)
      if (!visibleSources.length) content.append(cell('p', 'Choose SideQuest or BackLog to show entries.'))
      for (const source of visibleSources) content.append(renderBucket(key, source, group))
      body.append(content)
      column.append(header, body)

      toggle.addEventListener('click', () => {
        selectMedia(key)
        if (expanded.has(key)) expanded.delete(key)
        else expanded.add(key)
        const open = expanded.has(key)
        body.inert = !open
        toggle.setAttribute('aria-expanded', String(open))
        column.dataset.expanded = String(open)
        rememberQueueView()
      })
      board.append(column)
    }
  }

  function renderBucket(type, source, group) {
    const bucket = document.createElement('section')
    bucket.className = 'queue-bucket'
    const heading = cell('h3', source.label)
    const icon = cell('span', source.icon)
    icon.className = 'queue-source-icon'
    icon.setAttribute('aria-hidden', 'true')
    heading.prepend(icon)
    heading.id = `queue-${type}-${source.key}`
    bucket.setAttribute('aria-labelledby', heading.id)
    bucket.append(heading, cell('p', source.description))

    const entriesInBucket = group.filter((entry) => entry.source === source.key)
      .sort((a, b) => (a.queue_position ?? Infinity) - (b.queue_position ?? Infinity))
    const tag = type === 'book' && !byId('queue-reading-filter-field').hidden ? readingFilter.value : ''
    const visibleEntries = tag ? entriesInBucket.filter((entry) => entry.reading_tags?.includes(tag)) : entriesInBucket
    if (visibleEntries.length) {
      const list = document.createElement('ol')
      list.className = 'queue-entry-grid'
      visibleEntries.forEach((entry, index) => {
        const card = document.createElement('li')
        card.className = 'queue-entry'
        card.dataset.queueRow = entry.id
        const rank = cell('span', String((tag ? entriesInBucket.indexOf(entry) : index) + 1))
        rank.className = 'queue-rank'
        const text = document.createElement('div')
        text.className = 'queue-entry-text'
        const title = cell(owner ? 'button' : 'strong', entry.title)
        if (owner) {
          title.type = 'button'
          title.className = 'queue-edit'
          title.dataset.queueId = entry.id
          title.setAttribute('aria-label', `Edit ${entry.title}`)
          title.addEventListener('click', () => openEditor(entry, title))
        }
        text.append(title)
        card.append(rank)
        const url = httpsUrl(entry.artwork_url)
        if (url && !compact) {
          const cover = document.createElement('img')
          cover.alt = ''
          cover.className = 'queue-thumbnail'
          cover.loading = 'lazy'
          cover.referrerPolicy = 'no-referrer'
          cover.addEventListener('error', () => { cover.hidden = true }, { once: true })
          cover.src = url.href
          card.append(cover)
        }
        card.append(text)
        if (!compact) {
          if (type === 'book' && entry.author) text.append(cell('span', entry.author))
          const aliases = recommenderIds(entry.pokemon_id, entry.extra_pokemon_ids)
          for (const id of aliases) {
            const badge = cell('span', source.key === 'self' ? '' : pokemonName(id))
            badge.className = 'queue-pokemon-name'
            badge.prepend(pokemonSprite(id))
            if (source.key === 'self') badge.firstChild.alt = 'Ditto'
            text.append(badge)
          }
          const names = (entry.reading_tags ?? []).map((id) => readingTags.get(id)).filter(Boolean)
          if (names.length) {
            const tags = document.createElement('ul')
            tags.className = 'queue-tag-list'
            tags.setAttribute('aria-label', 'Reading tags')
            tags.append(...names.map((name) => cell('li', name)))
            text.append(tags)
          }
        }
        if (owner) card.append(renderRowActions(entry, visibleEntries, index, card))
        else if (promoted.has(entry.id) && !compact) text.append(cell('span', 'In MyShelf'))
        list.append(card)
      })
      bucket.append(list)
    } else bucket.append(cell('p', tag ? 'No books match this tag.' : 'Empty'))

    if (owner) {
      const add = cell('button', '+ ' + source.add)
      add.type = 'button'
      add.className = 'button queue-add'
      add.dataset.queueAdd = `${type}-${source.key}`
      add.addEventListener('click', () => openEditor({ media_type: type, source: source.key }, add))
      bucket.append(add)
    }
    return bucket
  }

  function renderRowActions(entry, entriesInBucket, index, row) {
    const actions = document.createElement('div')
    actions.className = 'queue-row-actions'
    const canRank = columns.includes(priorityColumn)
    for (const [direction, symbol] of [[-1, '↑'], [1, '↓']]) {
      const button = cell('button', symbol)
      button.type = 'button'
      button.className = 'button'
      const label = direction < 0 ? 'up' : 'down'
      button.dataset.queueMove = label
      button.setAttribute('aria-label', `Move ${entry.title} ${label}`)
      const target = entriesInBucket[index + direction]
      button.disabled = !canRank || !target
      button.addEventListener('click', () => move(entry, target, direction > 0, label))
      actions.append(button)
    }

    const promote = cell('button', promoted.has(entry.id) ? 'In MyShelf' : 'Promote to MyShelf')
    promote.type = 'button'
    promote.className = 'button'
    promote.dataset.queuePromote = entry.id
    promote.disabled = !canPromote || promoted.has(entry.id)
    promote.addEventListener('click', () => {
      if (!owner || pending || !canPromote || promoted.has(entry.id)) return
      openTierEditor(entry)
    })
    actions.append(promote)

    if (!canRank || entriesInBucket.length < 2) return actions
    row.draggable = true
    row.addEventListener('dragstart', (event) => {
      if (pending || event.target.closest('button')) { event.preventDefault(); return }
      dragging = entry
      event.dataTransfer.setData('text/plain', entry.id)
      event.dataTransfer.effectAllowed = 'move'
    })
    const isTarget = () => dragging && dragging.id !== entry.id &&
      dragging.media_type === entry.media_type && dragging.source === entry.source
    const after = (event) => {
      const bounds = row.getBoundingClientRect()
      return compact || matchMedia('(max-width: 540px)').matches
        ? event.clientY >= bounds.top + bounds.height / 2
        : event.clientX >= bounds.left + bounds.width / 2
    }
    row.addEventListener('dragover', (event) => {
      if (!isTarget()) return
      event.preventDefault()
      event.dataTransfer.dropEffect = 'move'
      row.classList.toggle('queue-drop-after', after(event))
      row.classList.toggle('queue-drop-before', !after(event))
    })
    row.addEventListener('dragleave', (event) => {
      if (!row.contains(event.relatedTarget)) row.classList.remove('queue-drop-before', 'queue-drop-after')
    })
    row.addEventListener('drop', (event) => {
      if (!isTarget()) return
      event.preventDefault()
      row.classList.remove('queue-drop-before', 'queue-drop-after')
      move(dragging, entry, after(event))
      dragging = null
    })
    row.addEventListener('dragend', () => {
      dragging = null
      board.querySelectorAll('.queue-drop-before, .queue-drop-after')
        .forEach((node) => node.classList.remove('queue-drop-before', 'queue-drop-after'))
    })
    return actions
  }

  async function move(entry, anchor, after, focusDirection) {
    if (!owner || pending || !anchor || !columns.includes(priorityColumn)) return
    const session = version
    pending = true
    try {
      const { data, error } = await db.rpc('tiershelf_move_queue_entry', {
        entry_id: entry.id, anchor_id: anchor.id, place_after: after,
      })
      if (session !== version) return
      if (error) throw error
      const positions = new Map(data.map((row) => [row.id, row.queue_position]))
      for (const item of entries) if (positions.has(item.id)) item.queue_position = positions.get(item.id)
      render()
      if (focusDirection) {
        const row = [...board.querySelectorAll('[data-queue-row]')].find((node) => node.dataset.queueRow === entry.id)
        const button = row?.querySelector(`[data-queue-move="${focusDirection}"]:not(:disabled)`) ?? row?.querySelector('.queue-edit')
        button?.focus({ preventScroll: true })
      }
      status.textContent = `Moved ${entry.title}.`
    } catch {
      if (session === version) status.textContent = 'Could not reorder this entry. Refresh and try again.'
    } finally {
      if (session === version) pending = false
    }
  }

  function renderSetup() {
    byId('queue-priority-setup').hidden = !owner || !loaded || (columns.includes(priorityColumn) && canPromote)
    byId('queue-reading-setup').hidden = !owner || !loaded || columns.includes(readingColumns)
    byId('queue-reading-filter-field').hidden = !viewer && (!owner || !loaded || !columns.includes(readingColumns))
  }

  function load() {
    if (!owner || loaded) return
    const session = version
    loadRequest ??= loadRecords(session).finally(() => {
      if (session === version) loadRequest = null
    })
    return loadRequest
  }

  async function loadRecords(session) {
    status.textContent = 'Loading QuestLog…'
    setup.hidden = true
    retry.hidden = true
    try {
      const records = []
      const pageSize = 500
      const fetchPage = (offset) => db.from(tableName).select(columns).order('created_at').order('id')
        .range(offset, offset + pageSize - 1)
      for (let offset = 0; ; offset += pageSize) {
        let result = await fetchPage(offset)
        if (session !== version) return
        if (offset === 0) {
          for (const fallback of [
            standardColumns + readingColumns, standardColumns, artworkColumns + readingColumns,
            basicColumns + priorityColumn + readingColumns, basicColumns + readingColumns, artworkColumns,
            basicColumns + priorityColumn, basicColumns,
          ]) {
            if (!['42703', 'PGRST204'].includes(result.error?.code)) break
            columns = fallback
            result = await fetchPage(offset)
            if (session !== version) return
          }
        }
        if (result.error) throw result.error
        records.push(...result.data)
        if (result.data.length < pageSize) break
      }
      byId('queue-artwork-setup').hidden = columns.includes(',artwork_url')
      entries = records
      loaded = true
      renderSetup()
      render()
      status.textContent = ''
    } catch (error) {
      if (session !== version) return
      const missing = ['42P01', 'PGRST205'].includes(error.code)
      status.textContent = missing ? 'QuestLog needs its Supabase table.' : 'Could not load QuestLog.'
      setup.hidden = false
      setup.querySelector('p').hidden = !missing
      retry.textContent = missing ? 'Check again' : 'Try again'
      retry.hidden = false
    }
  }

  function openEditor(entry, button) {
    if (!owner || !loaded || pending) return
    activeEntry = entry
    trigger = button
    title.value = entry.title ?? ''
    author.value = entry.author ?? ''
    autofilledAuthor = ''
    artwork.value = entry.artwork_url ?? ''
    resetArtworkLookup()
    renderArtwork()
    const book = entry.media_type === 'book'
    byId('queue-author-field').hidden = !book
    author.disabled = !book
    readingTagField.hidden = !book || !columns.includes(readingColumns)
    readingTagField.disabled = readingTagField.hidden
    for (const [id, input] of readingInputs) input.checked = entry.reading_tags?.includes(id) ?? false
    lookup.textContent = book ? 'Find cover' : 'Find poster'
    byId('queue-artwork-field').firstChild.textContent = book ? 'Cover image URL' : 'Poster image URL'
    const self = entry.source === 'self'
    byId('queue-alias-field').hidden = self
    picker.reset(recommenderIds(entry.pokemon_id, entry.extra_pokemon_ids), columns.includes(extraPokemonColumn), self)
    if (self) preview.append(pokemonSprite(ditto), 'Ditto · BackLog')
    remove.hidden = !entry.id
    byId('queue-editor-heading').textContent = entry.id ? 'Edit QuestLog entry'
      : self ? 'Add to BackLog' : 'Add to SideQuest'
    formStatus.textContent = ''
    dialog.showModal()
    title.focus()
    return true
  }

  function renderArtwork() {
    const url = httpsUrl(artwork.value.trim())
    artworkPreview.hidden = !url
    if (url) artworkPreview.src = url.href
    else artworkPreview.removeAttribute('src')
  }

  function resetArtworkLookup() {
    lookupVersion++
    resetTagLookup()
    matches = []
    lookup.disabled = false
    titleOptions.disabled = true
    titleOptions.replaceChildren(new Option('Find a cover or poster to see matches', ''))
    matchTitle.disabled = true
    lookupStatus.textContent = ''
  }

  function selectedMatch() {
    return titleOptions.value === '' ? null : matches[Number(titleOptions.value)]
  }

  function applyArtworkMatch() {
    resetTagLookup()
    const result = selectedMatch()
    matchTitle.disabled = !result || result.title === title.value
    if (!result) return
    artwork.value = result.image ?? ''
    renderArtwork()
    if (!author.disabled && (!author.value.trim() || author.value === autofilledAuthor)) {
      autofilledAuthor = result.author?.slice(0, 200) ?? ''
      author.value = autofilledAuthor
    }
    lookupStatus.textContent = result.image ? 'Image found.' : 'This result has no image. You can paste a direct image URL.'
  }

  async function findArtwork() {
    if (!activeEntry || !owner || lookup.disabled) return
    const name = title.value.trim()
    if (!name) {
      lookupStatus.textContent = 'Enter a title first.'
      title.focus()
      return
    }
    resetArtworkLookup()
    const lookupId = lookupVersion
    lookup.disabled = true
    lookupStatus.textContent = 'Looking up titles…'
    const type = activeEntry.media_type
    try {
      const manualAuthor = author.value === autofilledAuthor ? '' : author.value.trim()
      const result = type === 'book' ? await findBookOptions({ title: name, author: manualAuthor })
        : await findArtworkOptions({ title: name, type, year: '', page: '', author: '' })
      if (lookupId !== lookupVersion || !dialog.open) return
      matches = result.suggestions
      titleOptions.replaceChildren(new Option('Choose a result', ''))
      matches.forEach((item, index) => titleOptions.add(new Option(
        item.description ? `${item.title} — ${item.description}` : item.title, String(index),
      )))
      titleOptions.disabled = false
      if (result.preferred) {
        titleOptions.value = String(matches.indexOf(result.preferred))
        applyArtworkMatch()
      } else lookupStatus.textContent = 'Choose a result under Title.'
    } catch (error) {
      if (lookupId === lookupVersion && dialog.open) lookupStatus.textContent = error.message
    } finally {
      if (lookupId === lookupVersion) lookup.disabled = false
    }
  }

  title.addEventListener('input', resetArtworkLookup)
  author.addEventListener('input', resetTagLookup)
  title.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter' || event.isComposing) return
    event.preventDefault()
    findArtwork()
  })
  lookup.addEventListener('click', findArtwork)
  titleOptions.addEventListener('change', applyArtworkMatch)
  matchTitle.addEventListener('click', () => {
    const result = selectedMatch()
    if (!result) return
    title.value = result.title
    resetTagLookup()
    matchTitle.disabled = true
    title.focus()
  })
  artwork.addEventListener('input', renderArtwork)
  artworkPreview.addEventListener('error', () => {
    artworkPreview.hidden = true
    lookupStatus.textContent = 'The image could not load. Try another direct image URL.'
  })

  function resetTagLookup() {
    tagLookupVersion++
    suggestTags.disabled = false
    tagStatus.textContent = ''
  }

  suggestTags.addEventListener('click', async () => {
    if (!owner || !dialog.open || pending || readingTagField.disabled || suggestTags.disabled) return
    const bookTitle = title.value.trim()
    const bookAuthor = author.value.trim()
    if (!bookTitle) {
      tagStatus.textContent = 'Enter a book title to get suggestions.'
      title.focus()
      return
    }
    const match = selectedMatch()
    if (match && normalizeTitle(match.title) !== normalizeTitle(bookTitle)) {
      tagStatus.textContent = 'Use Match title to confirm the selected book first.'
      return
    }
    const lookupId = ++tagLookupVersion
    const stillEditing = () => lookupId === tagLookupVersion && dialog.open && !pending
    suggestTags.disabled = true
    tagStatus.textContent = 'Looking up reading tags…'
    try {
      const useMatch = match && (!bookAuthor || normalizeTitle(match.author ?? '') === normalizeTitle(bookAuthor))
      const book = useMatch ? match : (await findBookOptions({ title: bookTitle, author: bookAuthor })).preferred
      if (!stillEditing()) return
      if (!book) {
        tagStatus.textContent = 'Choose the right book in Find cover or enter its author, then try again.'
        return
      }
      const tags = await suggestBookTags(book)
      if (!stillEditing()) return
      const additions = tags.filter((id) => !readingInputs.get(id).checked)
      for (const id of additions) readingInputs.get(id).checked = true
      if (additions.length) {
        tagStatus.textContent = `Suggested ${additions.map((id) => readingTags.get(id)).join(', ')}. Review before saving.`
      } else {
        tagStatus.textContent = tags.length ? 'The suggested tags are already selected.'
          : 'Open Library had no clear reading tags for this book. You can still select tags manually.'
      }
    } catch {
      if (stillEditing()) tagStatus.textContent = 'Could not look up reading tags. Try again or select them manually.'
    } finally {
      if (lookupId === tagLookupVersion) suggestTags.disabled = false
    }
  })

  async function persist(removeEntry, record) {
    if (!owner || pending) return
    const session = version
    const entry = activeEntry
    pending = true
    for (const button of [save, remove, close]) button.disabled = true
    formStatus.textContent = ''
    try {
      const table = db.from(tableName)
      const request = removeEntry ? table.delete().eq('id', entry.id)
        : entry.id ? table.update(record).eq('id', entry.id) : table.insert(record)
      const { data, error } = await request.select(columns).single()
      if (session !== version) return
      if (error) throw error
      const index = entries.findIndex((item) => item.id === data.id)
      if (removeEntry) {
        if (index >= 0) entries.splice(index, 1)
      } else if (index < 0) entries.push(data)
      else entries[index] = data
      render()
      dialog.close()
      if (!removeEntry && !entry.id && entry.media_type === 'book' && entry.source === 'recommended') celebrate('sidequest')
      const returnButton = [...board.querySelectorAll('[data-queue-id]')].find((node) => node.dataset.queueId === data.id)
        ?? board.querySelector(`[data-queue-add="${entry.media_type}-${entry.source}"]`)
      returnButton?.focus({ preventScroll: true })
      status.textContent = removeEntry ? 'Removed from QuestLog.'
        : !columns.includes(',artwork_url') && artwork.value ? 'Saved title details. The artwork migration is needed to keep the image.'
        : 'Saved to QuestLog.'
    } catch (error) {
      if (session === version) formStatus.textContent = entry.source_recommendation_id && !entry.id && error.code === '23505'
        ? 'This recommendation is already in SideQuest.'
        : error.code === '23514' && (entry.media_type === 'game' || (entry.source_recommendation_id && entry.media_type !== 'book'))
          ? mediaSetup : 'Could not save that change. Try again.'
    } finally {
      if (session === version) {
        pending = false
        for (const button of [save, remove, close]) button.disabled = false
      }
    }
  }

  populatePokemonOptions(byId('pokemon-aliases'))
  form.addEventListener('submit', (event) => {
    event.preventDefault()
    if (!activeEntry) return
    const name = title.value.trim()
    if (!name) {
      formStatus.textContent = 'Enter a title.'
      title.focus()
      return
    }
    const aliasIds = activeEntry.source === 'self' ? [ditto] : picker.read(true)
    if (!aliasIds) return
    const image = artwork.value.trim()
    if (image && !httpsUrl(image)) {
      formStatus.textContent = 'Enter a direct HTTPS image URL.'
      artwork.focus()
      return
    }
    persist(false, {
      ...(columns.includes(',artwork_url') ? { artwork_url: image || null } : {}),
      ...(columns.includes(extraPokemonColumn) ? { extra_pokemon_ids: aliasIds.slice(1) } : {}),
      ...(readingTagField.disabled ? {} : {
        reading_tags: [...readingInputs].filter(([, input]) => input.checked).map(([id]) => id),
      }),
      ...(activeEntry.id || !activeEntry.source_recommendation_id ? {} : {
        source_recommendation_id: activeEntry.source_recommendation_id,
      }),
      title: name, author: activeEntry.media_type === 'book' ? author.value.trim() || null : null,
      media_type: activeEntry.media_type, source: activeEntry.source, pokemon_id: aliasIds[0],
    })
  })
  remove.addEventListener('click', () => persist(true))
  close.addEventListener('click', () => dialog.close())
  dialog.addEventListener('cancel', (event) => { if (pending) event.preventDefault() })
  dialog.addEventListener('close', () => {
    resetTagLookup()
    if (trigger?.isConnected) trigger.focus({ preventScroll: true })
  })
  archiveButton.addEventListener('click', () => switchView(false, true))
  byId('return-to-tiershelf').addEventListener('click', (event) => {
    if (event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return
    event.preventDefault()
    switchView(false, true)
    byId('title').focus({ preventScroll: true })
    window.scrollTo(0, 0)
  })
  queueButton.addEventListener('click', () => {
    if (!owner && !viewer) return
    switchView(true, true)
    load()
  })
  retry.addEventListener('click', load)
  for (const input of [...sourceFilters.values(), readingFilter]) input.addEventListener('change', () => {
    rememberQueueView()
    if (loaded) render()
  })
  filterPanel.addEventListener('toggle', rememberQueueView)
  compactButton.addEventListener('click', () => {
    compact = !compact
    if (compact) {
      expanded.add(defaultMedia)
      selectMedia(defaultMedia)
    }
    compactButton.setAttribute('aria-pressed', String(compact))
    rememberQueueView()
    if (loaded) render()
  })

  return {
    async openRecommendation(recommendation) {
      const session = version
      await load()
      if (session !== version || !owner || !loaded || !columns.includes(readingColumns)) return false
      const kind = mediaKind(recommendation.media_type)
      const opened = openEditor({
        title: recommendation.title, author: recommendation.author, media_type: kind, source: 'recommended',
        source_recommendation_id: recommendation.id,
      }, byId('recommendation-mailbox'))
      if (opened) {
        readingFilter.value = ''
        sourceFilters.get('recommended').checked = true
        if (compact && kind !== 'book') {
          compact = false
          compactButton.setAttribute('aria-pressed', 'false')
        }
        queueMedia = kind
        expanded.add(kind)
        switchView(true, true)
        rememberQueueView()
        render()
      }
      return opened
    },
    setPromotionState(enabled, ids) {
      const updated = canPromote !== enabled || promoted.size !== ids.size || [...ids].some((id) => !promoted.has(id))
      canPromote = enabled
      promoted = ids
      renderSetup()
      if (loaded && updated) render()
    },
    finishPromotion(id) {
      const button = [...board.querySelectorAll('[data-queue-id]')].find((node) => node.dataset.queueId === id)
      button?.focus({ preventScroll: true })
      status.textContent = 'Added to MyShelf.'
    },
    setOwner(isOwner, viewerEntries = null) {
      const isViewer = viewerEntries !== null
      if (owner === isOwner && viewer === isViewer) return
      owner = isOwner
      viewer = isViewer
      version++
      entries = viewerEntries ?? []
      loadRequest = null
      loaded = viewer
      pending = false
      activeEntry = null
      trigger = null
      columns = standardColumns + readingColumns + extraPokemonColumn
      dragging = null
      byId('queue-priority-setup').hidden = true
      resetArtworkLookup()
      byId('queue-artwork-setup').hidden = true
      for (const button of [save, remove, close]) button.disabled = false
      if (dialog.open) dialog.close()
      form.reset()
      renderArtwork()
      preview.replaceChildren()
      board.replaceChildren()
      status.textContent = ''
      formStatus.textContent = ''
      setup.hidden = true
      nav.hidden = !owner && !viewer
      restoreQueueView()
      renderSetup()
      const reopenQueue = (owner || viewer) && queueHashes.has(location.hash)
      switchView(reopenQueue, reopenQueue || (!owner && !viewer))
      if (viewer) render()
      else if (reopenQueue) load()
    },
  }
}
