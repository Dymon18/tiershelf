import pokemon from './pokemon.json'

const mediaTypes = [
  { key: 'movie', label: 'Movies' },
  { key: 'book', label: 'Books' },
  { key: 'anime', label: 'Series' },
]
const sources = [
  { key: 'recommended', label: 'Recommended', add: 'Add recommendation' },
  { key: 'self', label: 'Self-added', add: 'Add for myself' },
]
const ditto = 132
const tableName = 'tiershelf_queue'
const columns = 'id,title,media_type,author,source,pokemon_id,created_at'
const byId = (id) => document.getElementById(id)
const pokemonKey = (name) => name.normalize('NFD').replace(/\p{M}/gu, '')
  .toLowerCase().replaceAll('♀', 'f').replaceAll('♂', 'm').replace(/[^a-z0-9]+/g, '')
const species = new Map(Object.entries(pokemon).map(([id, name]) => [pokemonKey(name), Number(id)]))
species.set('greninjaash', 10117)

function cell(tag, value) {
  const node = document.createElement(tag)
  node.textContent = value
  return node
}

function sprite(id) {
  const image = document.createElement('img')
  image.alt = ''
  image.width = 36
  image.height = 36
  image.loading = 'lazy'
  image.referrerPolicy = 'no-referrer'
  image.src = `https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/${id}.png`
  image.addEventListener('error', () => { image.hidden = true }, { once: true })
  return image
}

export function createQueue(db) {
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
  const alias = byId('queue-alias')
  const preview = byId('queue-alias-preview')
  const formStatus = byId('queue-editor-status')
  const save = byId('queue-save')
  const remove = byId('queue-delete')
  const close = byId('close-queue-editor')
  const archiveButton = byId('show-archive')
  const queueButton = byId('show-queue')
  const expanded = new Set(mediaTypes.map(({ key }) => key))
  let owner = false
  let version = 0
  let entries = []
  let loading = false
  let loaded = false
  let pending = false
  let activeEntry = null
  let trigger = null

  function switchView(showQueue) {
    view.hidden = !showQueue
    archive.hidden = showQueue
    archiveButton.setAttribute('aria-pressed', String(!showQueue))
    queueButton.setAttribute('aria-pressed', String(showQueue))
  }

  function render() {
    board.replaceChildren()
    for (const { key, label } of mediaTypes) {
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
    if (rows.length) {
      const table = document.createElement('table')
      table.setAttribute('aria-labelledby', heading.id)
      const head = table.createTHead().insertRow()
      for (const label of type === 'book' ? ['Title', 'Author', 'From'] : ['Title', 'From']) {
        const name = cell('th', label)
        name.scope = 'col'
        head.append(name)
      }
      const body = table.createTBody()
      for (const entry of rows) {
        const row = body.insertRow()
        const titleCell = row.insertCell()
        const edit = cell('button', entry.title)
        edit.type = 'button'
        edit.className = 'queue-edit'
        edit.dataset.queueId = entry.id
        edit.setAttribute('aria-label', `Edit ${entry.title}`)
        edit.addEventListener('click', () => openEditor(entry, edit))
        titleCell.append(edit)
        if (type === 'book') row.insertCell().textContent = entry.author || '—'
        const from = row.insertCell()
        const name = pokemon[entry.pokemon_id] ?? 'Pokémon'
        const badge = cell('span', source.key === 'self' ? '' : name)
        badge.className = 'queue-pokemon-name'
        if (source.key === 'self') badge.setAttribute('aria-label', 'Ditto (self-added)')
        badge.prepend(sprite(entry.pokemon_id))
        if (source.key === 'self') badge.firstChild.alt = 'Ditto'
        from.append(badge)
      }
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

  async function load() {
    if (!owner || loading || loaded) return
    const session = version
    loading = true
    status.textContent = 'Loading your queue…'
    setup.hidden = true
    retry.hidden = true
    try {
      const records = []
      const pageSize = 500
      for (let offset = 0; ; offset += pageSize) {
        const { data, error } = await db.from(tableName).select(columns).order('created_at').order('id')
          .range(offset, offset + pageSize - 1)
        if (session !== version) return
        if (error) throw error
        records.push(...data)
        if (data.length < pageSize) break
      }
      entries = records
      loaded = true
      render()
      status.textContent = ''
    } catch (error) {
      if (session !== version) return
      const missing = ['42P01', 'PGRST205'].includes(error.code)
      status.textContent = missing ? 'PokéQueue needs its Supabase table.' : 'Could not load your queue.'
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
    const id = activeEntry?.source === 'self' ? ditto : species.get(pokemonKey(alias.value))
    if (id) preview.append(sprite(id), activeEntry?.source === 'self' ? 'Ditto · Self-added' : pokemon[id])
  }

  function openEditor(entry, button) {
    if (!owner || !loaded || pending) return
    activeEntry = entry
    trigger = button
    title.value = entry.title ?? ''
    author.value = entry.author ?? ''
    const book = entry.media_type === 'book'
    byId('queue-author-field').hidden = !book
    author.disabled = !book
    const self = entry.source === 'self'
    byId('queue-alias-field').hidden = self
    alias.disabled = self
    alias.required = !self
    alias.value = self ? '' : pokemon[entry.pokemon_id] ?? ''
    remove.hidden = !entry.id
    byId('queue-editor-heading').textContent = entry.id ? 'Edit queue entry'
      : self ? 'Add for myself' : 'Add recommendation'
    formStatus.textContent = ''
    updateAlias()
    dialog.showModal()
    title.focus()
  }

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
      status.textContent = removeEntry ? 'Removed from PokéQueue.' : 'Saved to PokéQueue.'
    } catch {
      if (session === version) formStatus.textContent = 'Could not save that change. Try again.'
    } finally {
      if (session === version) {
        pending = false
        for (const button of [save, remove, close]) button.disabled = false
      }
    }
  }

  const options = Object.values(pokemon).sort((a, b) => a.localeCompare(b))
  const datalist = byId('pokemon-aliases')
  for (const name of options) datalist.append(new Option(name, name))
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
    const pokemonId = activeEntry.source === 'self' ? ditto : species.get(pokemonKey(alias.value))
    if (!pokemonId) {
      alias.setCustomValidity('Choose a Pokémon alias from the list.')
      alias.reportValidity()
      return
    }
    persist(false, {
      title: name, author: activeEntry.media_type === 'book' ? author.value.trim() || null : null,
      media_type: activeEntry.media_type, source: activeEntry.source, pokemon_id: pokemonId,
    })
  })
  remove.addEventListener('click', () => persist(true))
  close.addEventListener('click', () => dialog.close())
  dialog.addEventListener('cancel', (event) => { if (pending) event.preventDefault() })
  dialog.addEventListener('close', () => { if (trigger?.isConnected) trigger.focus({ preventScroll: true }) })
  archiveButton.addEventListener('click', () => switchView(false))
  queueButton.addEventListener('click', () => {
    if (!owner) return
    switchView(true)
    load()
  })
  retry.addEventListener('click', load)

  return {
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
      for (const button of [save, remove, close]) button.disabled = false
      if (dialog.open) dialog.close()
      form.reset()
      preview.replaceChildren()
      board.replaceChildren()
      status.textContent = ''
      formStatus.textContent = ''
      setup.hidden = true
      nav.hidden = !owner
      switchView(false)
    },
  }
}
