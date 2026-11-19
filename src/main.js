import { createClient } from '@supabase/supabase-js'
import './style.css'
import { config } from './config.js'

const grades = {
  S: '#f1a59c', A: '#f3bc91', B: '#f0db97', C: '#cfe69e',
  D: '#a6dbbc', E: '#a6cde8', F: '#c4b9ed',
}
const types = { movie: 'Movie', book: 'Book', anime: 'Anime' }
const samples = [
  ['Spirited Away', 'anime', 'S'], ['Piranesi', 'book', 'S'], ['Parasite', 'movie', 'S'],
  ['Arrival', 'movie', 'A'], ['The Hobbit', 'book', 'A'], ['Frieren: Beyond Journey’s End', 'anime', 'A'],
  ['Interstellar', 'movie', 'B'], ['Spy × Family', 'anime', 'B'],
  ['The Martian', 'book', 'C'], ['Tron: Legacy', 'movie', 'D'],
]
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
const gradeInput = byId('entry-grade')
const typeInput = byId('entry-type')
const editorStatus = byId('editor-status')
const saveButton = byId('save-button')
const deleteButton = byId('delete-button')
const filters = document.querySelectorAll('[data-filter]')
const demo = samples.map(([title, media_type, grade], index) => ({
  id: `demo-${index}`, title, media_type, grade,
}))
let entries = demo
let filter = 'all'
let ownerMode = false
let editing = null
let dragging = null
let pending = false
let pendingChanges = 0
let frameVersion = 0

function status(message) {
  byId('status').textContent = message
}

function render() {
  const query = search.value.trim().toLowerCase()
  const visible = entries.filter((entry) =>
    (filter === 'all' || filter === entry.media_type) && entry.title.toLowerCase().includes(query),
  )
  byId('count').textContent = visible.length === entries.length
    ? `${entries.length} ${entries.length === 1 ? 'title' : 'titles'}`
    : `${visible.length} of ${entries.length} titles`
  byId('hint').textContent = matchMedia('(pointer: coarse)').matches
    ? 'Tap a title to change its grade'
    : 'Drag titles between tiers'
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
    const ranked = visible.filter((entry) => entry.grade === grade)
    for (const entry of ranked) cards.append(createCard(entry))
    if (!ranked.length) {
      const empty = document.createElement('span')
      empty.className = 'empty'
      empty.textContent = query || filter !== 'all' ? 'No matching titles' : 'No titles yet'
      cards.append(empty)
    }

    row.addEventListener('dragover', (event) => {
      if (!dragging || dragging.grade === grade) return
      event.preventDefault()
      event.dataTransfer.dropEffect = 'move'
      row.classList.add('over')
    })
    row.addEventListener('dragleave', (event) => {
      if (!row.contains(event.relatedTarget)) row.classList.remove('over')
    })
    row.addEventListener('drop', async (event) => {
      event.preventDefault()
      row.classList.remove('over')
      const entry = dragging
      dragging = null
      if (!entry || entry.grade === grade) return
      try {
        await save({ ...entry, grade })
      } catch (error) {
        status(error.message)
      }
    })
    row.append(heading, cards)
    board.append(row)
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
  type.textContent = types[entry.media_type]
  card.append(name, type)
  card.addEventListener('click', () => openEditor(entry))
  card.addEventListener('dragstart', (event) => {
    dragging = entry
    event.dataTransfer.setData('text/plain', entry.id)
    event.dataTransfer.effectAllowed = 'move'
  })
  card.addEventListener('dragend', () => {
    dragging = null
    board.querySelectorAll('.over').forEach((row) => row.classList.remove('over'))
  })
  return card
}

function openEditor(entry) {
  editing = entry ?? null
  byId('editor-title').textContent = entry ? 'Edit title' : 'Add title'
  titleInput.value = entry?.title ?? ''
  typeInput.value = entry?.media_type ?? (filter === 'all' ? 'movie' : filter)
  gradeInput.value = entry?.grade ?? 'A'
  deleteButton.hidden = !entry
  editorStatus.textContent = ''
  editor.showModal()
  titleInput.focus()
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
      const { data, error } = await request.select('id,title,media_type,grade').single()
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
  submitEditor(() => save({
    id: editing?.id, title, media_type: typeInput.value, grade: gradeInput.value,
  }), editing?.id)
})
deleteButton.addEventListener('click', () => submitEditor(() => remove(editing)))
filters.forEach((button) => button.addEventListener('click', () => {
  filter = button.dataset.filter
  filters.forEach((item) => item.setAttribute('aria-pressed', String(item === button)))
  render()
}))
search.addEventListener('input', render)

function setMode(isOwner, records) {
  frameVersion++
  ownerMode = isOwner
  entries = records
  filter = 'all'
  search.value = ''
  filters.forEach((item) => item.setAttribute('aria-pressed', String(item.dataset.filter === 'all')))
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
      const { data, error } = await db.from('tiershelf_entries')
        .select('id,title,media_type,grade').order('created_at').order('id')
      if (version !== authVersion) return
      accountButton.disabled = false
      if (error) {
        await db.auth.signOut({ scope: 'local' })
        status('Could not load your archive. Try signing in again.')
        return
      }
      setMode(true, data)
      status('')
    }, 0)
  })
}
