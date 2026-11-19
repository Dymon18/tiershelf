import { httpsUrl } from './posters.js'
import { pokemonName } from './pokemon.js'

const byId = (id) => document.getElementById(id)
const format = /^Kuching-[A-Za-z0-9_-]{32}$/

function createKey() {
  const bytes = crypto.getRandomValues(new Uint8Array(24))
  return 'Kuching-' + btoa(String.fromCharCode(...bytes)).replaceAll('+', '-').replaceAll('/', '_')
}

export function createViewer(db, { mode, openSnapshot, exit }) {
  const dialog = byId('viewer-dialog')
  const admin = byId('viewer-admin')
  const button = byId('viewer-button')
  const key = byId('viewer-key')
  const unlock = byId('unlock-viewer')
  const state = byId('viewer-status')
  const generate = byId('generate-viewer-key')
  const revoke = byId('revoke-viewer-key')
  const adminState = byId('viewer-admin-status')
  const output = byId('viewer-key-output')
  const generated = byId('generated-viewer-key')
  const setup = byId('viewer-setup')
  const titleDialog = byId('viewer-title-dialog')
  const art = byId('viewer-title-art')
  const details = byId('viewer-title-details')
  let accessVersion = 0
  button.hidden = !db

  function resetKeyOutput() {
    generated.value = ''
    output.hidden = true
  }

  function setMode(current) {
    accessVersion++
    button.textContent = current === 'dymon' ? 'Viewer access' : current === 'viewer' ? 'Exit viewer' : 'Viewer mode'
    button.hidden = !db
    if (dialog.open) dialog.close()
    if (admin.open) admin.close()
    if (titleDialog.open) titleDialog.close()
    byId('viewer-title').textContent = ''
    art.removeAttribute('src')
    details.replaceChildren()
    key.value = ''
    unlock.disabled = false
    generate.disabled = false
    revoke.disabled = false
    resetKeyOutput()
  }

  button.addEventListener('click', () => {
    if (mode() === 'viewer') {
      exit()
      return
    }
    if (mode() === 'dymon') {
      setup.hidden = true
      adminState.textContent = ''
      resetKeyOutput()
      admin.showModal()
      return
    }
    state.textContent = ''
    key.value = ''
    dialog.showModal()
    key.focus()
  })

  byId('viewer-form').addEventListener('submit', async (event) => {
    event.preventDefault()
    if (unlock.disabled || !db || mode() !== 'demo') return
    const submitted = key.value.trim()
    if (!format.test(submitted)) {
      state.textContent = 'Enter the full viewer key Dymon shared.'
      return
    }
    const version = ++accessVersion
    unlock.disabled = true
    state.textContent = 'Checking the key…'
    try {
      const { data, error } = await db.rpc('tiershelf_viewer_snapshot', { access_key: submitted })
      if (version !== accessVersion || mode() !== 'demo' || !dialog.open) return
      if (error) {
        state.textContent = error.code === 'PGRST202'
          ? 'Viewer access is still being set up.'
          : 'Could not check the key. Try again.'
      } else if (!Array.isArray(data?.shelf) || !Array.isArray(data?.questlog)) state.textContent = 'This key did not unlock TierShelf. Check with Dymon.'
      else openSnapshot(data)
    } catch {
      if (version === accessVersion) state.textContent = 'Could not check the key. Try again.'
    } finally {
      if (version === accessVersion) unlock.disabled = false
    }
  })

  byId('close-viewer').addEventListener('click', () => dialog.close())
  dialog.addEventListener('close', () => {
    accessVersion++
    unlock.disabled = false
    key.value = ''
  })

  async function changeKey(nextKey) {
    if (!db || mode() !== 'dymon' || generate.disabled) return
    const version = accessVersion
    generate.disabled = true
    revoke.disabled = true
    adminState.textContent = ''
    setup.hidden = true
    try {
      const { error } = await db.rpc('tiershelf_set_viewer_key', { access_key: nextKey })
      if (version !== accessVersion || mode() !== 'dymon') return
      if (error) {
        setup.hidden = error.code !== 'PGRST202'
        adminState.textContent = setup.hidden ? 'Could not update viewer access. Try again.' : ''
      } else {
        if (nextKey) {
          generated.value = nextKey
          output.hidden = false
          adminState.textContent = 'Key ready. Copy it before closing.'
        } else {
          resetKeyOutput()
          adminState.textContent = 'Viewer access is off for future visits.'
        }
      }
    } catch {
      if (version === accessVersion) adminState.textContent = 'Could not update viewer access. Try again.'
    } finally {
      if (version === accessVersion) {
        generate.disabled = false
        revoke.disabled = false
      }
    }
  }

  generate.addEventListener('click', () => changeKey(createKey()))
  revoke.addEventListener('click', () => changeKey(null))
  byId('close-viewer-admin').addEventListener('click', () => { if (!generate.disabled) admin.close() })
  admin.addEventListener('cancel', (event) => { if (generate.disabled) event.preventDefault() })
  admin.addEventListener('close', resetKeyOutput)
  byId('copy-viewer-key').addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(generated.value)
      adminState.textContent = 'Key copied.'
    } catch {
      generated.select()
      adminState.textContent = 'Copy the selected key.'
    }
  })

  art.addEventListener('error', () => { art.hidden = true })
  byId('close-viewer-title').addEventListener('click', () => titleDialog.close())

  return {
    setMode,
    inspect(entry) {
      if (mode() !== 'viewer') return
      byId('viewer-title').textContent = entry.title
      const image = httpsUrl(entry.poster_url)
      art.hidden = !image
      if (image) art.src = image.href
      else art.removeAttribute('src')
      details.replaceChildren()
      const movie = entry.movie_details
      for (const [label, value] of [
        ['Tier', entry.grade], ['Author', entry.author], ['Release year', entry.release_year],
        ['Categories', entry.categories?.join(', ')], ['Recommended by', pokemonName(entry.recommender_pokemon_id)],
        ['Director', movie?.directors?.join(', ')], ['Studio', movie?.studios?.join(', ')],
        ['Franchise', movie?.franchises?.join(', ')], ['Original language', movie?.languages?.join(', ')],
        ['Country of origin', movie?.countries?.join(', ')], ['Runtime', movie?.runtime ? `${movie.runtime} min` : null],
      ]) {
        if (!value) continue
        const name = document.createElement('dt')
        const description = document.createElement('dd')
        name.textContent = label
        description.textContent = value
        details.append(name, description)
      }
      titleDialog.showModal()
    },
  }
}
