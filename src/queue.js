import { ditto, pokemonId, pokemonName, pokemonSprite, populatePokemonOptions } from './pokemon.js'
import { findArtworkOptions, findBookOptions, httpsUrl } from './posters.js'

const mediaTypes = [
  { key: 'movie', label: 'Movies' },
  { key: 'book', label: 'Books' },
  { key: 'anime', label: 'Series' },
]
const sources = [
  { key: 'recommended', label: 'SideQuest', add: 'Add to SideQuest' },
  { key: 'self', label: 'BackLog', add: 'Add to BackLog' },
]
const tableName = 'tiershelf_queue'
const basicColumns = 'id,title,media_type,author,source,pokemon_id,created_at'
const artworkColumns = basicColumns + ',artwork_url'
const priorityColumn = ',queue_position'
const queueHash = '#questlog'
const queueHashes = new Set([queueHash, '#pokequeue'])
const byId = (id) => document.getElementById(id)
function cell(tag, value) {
  const node = document.createElement(tag)
  node.textContent = value
  return node
}

export function createQueue(db, openTierEditor) {
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
  const formStatus = byId('queue-editor-status')
  const save = byId('queue-save')
  const remove = byId('queue-delete')
  const close = byId('close-queue-editor')
  const archiveButton = byId('show-archive')
  const queueButton = byId('show-queue')
  const compactButton = byId('queue-compact')
  let compact = false
  let promoted = new Set()
  let canPromote = false
  let dragging = null
  const expanded = new Set(mediaTypes.map(({ key }) => key))
  let lookupVersion = 0
  let matches = []
  let autofilledAuthor = ''
  let columns = artworkColumns + priorityColumn
  let owner = false
  let version = 0
  let entries = []
  let loading = false
  let loaded = false
  let pending = false
  let activeEntry = null
  let trigger = null

  function switchView(showQueue, remember = false) {
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
  }

  function render() {
    board.replaceChildren()
    board.dataset.compact = String(compact)
    const visibleTypes = compact ? mediaTypes.filter(({ key }) => key === 'book') : mediaTypes
    for (const { key, label } of visibleTypes) {
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
      toggle.append(label, chevron)
      header.append(toggle)

      const body = document.createElement('div')
      body.id = `queue-${key}-body`
      body.className = 'queue-column-body'
      body.inert = !expanded.has(key)
      const content = document.createElement('div')
      content.className = 'queue-column-content'
      const group = entries.filter((entry) => entry.media_type === key)
      for (const source of sources) content.append(renderBucket(key, source, group))
      body.append(content)
      column.append(header, body)

      toggle.addEventListener('click', () => {
        if (expanded.has(key)) expanded.delete(key)
        else expanded.add(key)
        const open = expanded.has(key)
        body.inert = !open
        toggle.setAttribute('aria-expanded', String(open))
        column.dataset.expanded = String(open)
      })
      board.append(column)
    }
  }

  function renderBucket(type, source, group) {
    const bucket = document.createElement('section')
    bucket.className = 'queue-bucket'
    const heading = cell('h3', source.label)
    heading.id = `queue-${type}-${source.key}`
    bucket.setAttribute('aria-labelledby', heading.id)
    bucket.append(heading)
    const rows = group.filter((entry) => entry.source === source.key)
      .sort((a, b) => (a.queue_position ?? Infinity) - (b.queue_position ?? Infinity))
    if (rows.length) {
      const table = document.createElement('table')
      table.setAttribute('aria-labelledby', heading.id)
      const head = table.createTHead().insertRow()
      const labels = compact ? ['#', 'Title'] : type === 'book' ? ['#', 'Title', 'Author', 'From'] : ['#', 'Title', 'From']
      for (const label of labels) {
        const name = cell('th', label)
        name.scope = 'col'
        if (label === '#') name.setAttribute('aria-label', 'Priority')
        head.append(name)
      }
      const body = table.createTBody()
      rows.forEach((entry, index) => {
        const row = body.insertRow()
        row.dataset.queueRow = entry.id
        const number = cell('th', String(index + 1))
        number.scope = 'row'
        row.append(number)
        const titleCell = row.insertCell()
        const edit = cell('button', entry.title)
        const imageUrl = httpsUrl(entry.artwork_url)
        if (imageUrl && !compact) {
          const cover = document.createElement('img')
          cover.alt = ''
          cover.className = 'queue-thumbnail'
          cover.loading = 'lazy'
          cover.referrerPolicy = 'no-referrer'
          cover.addEventListener('error', () => { cover.hidden = true }, { once: true })
          cover.src = imageUrl.href
          edit.prepend(cover)
        }
        edit.type = 'button'
        edit.className = 'queue-edit'
        edit.dataset.queueId = entry.id
        edit.setAttribute('aria-label', `Edit ${entry.title}`)
        edit.addEventListener('click', () => openEditor(entry, edit))
        titleCell.append(edit, renderRowActions(entry, rows, index, row))
        if (compact) return
        if (type === 'book') row.insertCell().textContent = entry.author || '—'
        const from = row.insertCell()
        const name = pokemonName(entry.pokemon_id) || 'Pokémon'
        const badge = cell('span', source.key === 'self' ? '' : name)
        badge.className = 'queue-pokemon-name'
        if (source.key === 'self') badge.setAttribute('aria-label', 'Ditto (BackLog)')
        badge.prepend(pokemonSprite(entry.pokemon_id))
        if (source.key === 'self') badge.firstChild.alt = 'Ditto'
        from.append(badge)
      })
      bucket.append(table)
    } else bucket.append(cell('p', 'Empty'))
    const add = cell('button', '+ ' + source.add)
    add.type = 'button'
    add.className = 'button queue-add'
    add.dataset.queueAdd = `${type}-${source.key}`
    add.addEventListener('click', () => openEditor({ media_type: type, source: source.key }, add))
    bucket.append(add)
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
      return event.clientY >= bounds.top + bounds.height / 2
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
    byId('queue-priority-setup').hidden = !loaded || (columns.includes(priorityColumn) && canPromote)
  }

  async function load() {
    if (!owner || loading || loaded) return
    const session = version
    loading = true
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
          for (const fallback of [artworkColumns, basicColumns + priorityColumn, basicColumns]) {
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
    } finally {
      if (session === version) loading = false
    }
  }

  function updateAlias() {
    alias.setCustomValidity('')
    preview.replaceChildren()
    const id = activeEntry?.source === 'self' ? ditto : pokemonId(alias.value)
    if (id) preview.append(pokemonSprite(id), activeEntry?.source === 'self' ? 'Ditto · BackLog' : pokemonName(id))
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
    lookup.textContent = book ? 'Find cover' : 'Find poster'
    byId('queue-artwork-field').firstChild.textContent = book ? 'Cover image URL' : 'Poster image URL'
    const self = entry.source === 'self'
    byId('queue-alias-field').hidden = self
    alias.disabled = self
    alias.required = !self
    alias.value = self ? '' : pokemonName(entry.pokemon_id)
    remove.hidden = !entry.id
    byId('queue-editor-heading').textContent = entry.id ? 'Edit QuestLog entry'
      : self ? 'Add to BackLog' : 'Add to SideQuest'
    formStatus.textContent = ''
    updateAlias()
    dialog.showModal()
    title.focus()
  }

  function renderArtwork() {
    const url = httpsUrl(artwork.value.trim())
    artworkPreview.hidden = !url
    if (url) artworkPreview.src = url.href
    else artworkPreview.removeAttribute('src')
  }

  function resetArtworkLookup() {
    lookupVersion++
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
    matchTitle.disabled = true
    title.focus()
  })
  artwork.addEventListener('input', renderArtwork)
  artworkPreview.addEventListener('error', () => {
    artworkPreview.hidden = true
    lookupStatus.textContent = 'The image could not load. Try another direct image URL.'
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
      const returnButton = [...board.querySelectorAll('[data-queue-id]')].find((node) => node.dataset.queueId === data.id)
        ?? board.querySelector(`[data-queue-add="${entry.media_type}-${entry.source}"]`)
      returnButton?.focus({ preventScroll: true })
      status.textContent = removeEntry ? 'Removed from QuestLog.'
        : !columns.includes(',artwork_url') && artwork.value ? 'Saved title details. The artwork migration is needed to keep the image.'
        : 'Saved to QuestLog.'
    } catch {
      if (session === version) formStatus.textContent = 'Could not save that change. Try again.'
    } finally {
      if (session === version) {
        pending = false
        for (const button of [save, remove, close]) button.disabled = false
      }
    }
  }

  populatePokemonOptions(byId('pokemon-aliases'))
  alias.addEventListener('input', updateAlias)
  form.addEventListener('submit', (event) => {
    event.preventDefault()
    if (!activeEntry) return
    const name = title.value.trim()
    if (!name) {
      formStatus.textContent = 'Enter a title.'
      title.focus()
      return
    }
    const aliasId = activeEntry.source === 'self' ? ditto : pokemonId(alias.value)
    if (!aliasId) {
      alias.setCustomValidity('Choose a Pokémon alias from the list.')
      alias.reportValidity()
      return
    }
    const image = artwork.value.trim()
    if (image && !httpsUrl(image)) {
      formStatus.textContent = 'Enter a direct HTTPS image URL.'
      artwork.focus()
      return
    }
    persist(false, {
      ...(columns.includes(',artwork_url') ? { artwork_url: image || null } : {}),
      title: name, author: activeEntry.media_type === 'book' ? author.value.trim() || null : null,
      media_type: activeEntry.media_type, source: activeEntry.source, pokemon_id: aliasId,
    })
  })
  remove.addEventListener('click', () => persist(true))
  close.addEventListener('click', () => dialog.close())
  dialog.addEventListener('cancel', (event) => { if (pending) event.preventDefault() })
  dialog.addEventListener('close', () => { if (trigger?.isConnected) trigger.focus({ preventScroll: true }) })
  archiveButton.addEventListener('click', () => switchView(false, true))
  queueButton.addEventListener('click', () => {
    if (!owner) return
    switchView(true, true)
    load()
  })
  retry.addEventListener('click', load)
  compactButton.addEventListener('click', () => {
    compact = !compact
    if (compact) expanded.add('book')
    compactButton.setAttribute('aria-pressed', String(compact))
    if (loaded) render()
  })

  return {
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
    setOwner(isOwner) {
      if (owner === isOwner) return
      owner = isOwner
      version++
      entries = []
      loading = false
      loaded = false
      pending = false
      activeEntry = null
      trigger = null
      columns = artworkColumns + priorityColumn
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
      nav.hidden = !owner
      const reopenQueue = owner && queueHashes.has(location.hash)
      switchView(reopenQueue, reopenQueue || !owner)
      if (reopenQueue) load()
    },
  }
}
