import { media } from './media.js'

const byId = (id) => document.getElementById(id)
const categoryName = (value) => value.trim().replace(/\s+/g, ' ')
export const categoryKey = (value) => categoryName(value).toLowerCase()
const needsMigration = (error) => ['42P01', 'PGRST202', 'PGRST205'].includes(error?.code)

export function createCategoryEditor(db, { getType, getNames, onUpdate }) {
  const button = byId('manage-categories')
  const dialog = byId('category-editor')
  const form = byId('category-form')
  const current = byId('category-current')
  const next = byId('category-new-name')
  const submit = byId('save-category')
  const close = byId('close-category-editor')
  const status = byId('category-editor-status')
  const setup = byId('category-editor-setup')
  const aliases = new Map()
  let owner = false
  let version = 0
  let type
  let pending = false
  let loadRequest

  function store(rows, kind) {
    if (kind) aliases.delete(kind)
    else aliases.clear()
    for (const row of rows) {
      if (!Object.hasOwn(media, row.media_type) || !row.previous_key || !row.label) continue
      if (!aliases.has(row.media_type)) aliases.set(row.media_type, new Map())
      aliases.get(row.media_type).set(row.previous_key, row.label)
    }
  }

  function label(type, name) {
    return aliases.get(type)?.get(categoryKey(name)) ?? name
  }

  function labels(type, names) {
    const unique = new Map()
    for (const item of names) {
      if (typeof item !== 'string') continue
      const name = label(type, item)
      const key = categoryKey(name)
      if (key && !unique.has(key)) unique.set(key, name)
    }
    return [...unique.values()]
  }

  function render(currentName = '') {
    const names = getNames(type)
    current.replaceChildren(...names.map((name) => new Option(name, name)))
    if (names.includes(currentName)) current.value = currentName
    next.value = current.value
    submit.disabled = !names.length
    if (!names.length) status.textContent = 'There are no categories to rename in this section.'
  }

  function load() {
    if (!owner || loadRequest) return loadRequest
    const request = version
    loadRequest = (async () => {
      try {
        const { data, error } = await db.from('tiershelf_category_renames').select('media_type,previous_key,label')
        if (request !== version) return
        if (error) {
          if (dialog.open) setup.hidden = !needsMigration(error)
          return
        }
        store(data ?? [])
        if (dialog.open && !pending) {
          setup.hidden = true
          const selected = current.value
          const draft = next.value
          const updated = label(type, selected)
          render(updated)
          if (draft !== selected && current.value === updated) next.value = draft
        }
      } catch {
        // Existing archives and Friend mode work without the optional rename table.
      } finally {
        if (request === version) {
          loadRequest = null
          onUpdate()
        }
      }
    })()
    return loadRequest
  }

  button.addEventListener('click', () => {
    if (!owner || dialog.open) return
    type = getType()
    byId('category-editor-heading').textContent = type === 'book' ? 'Edit genres' : 'Edit categories'
    byId('category-editor-description').textContent = `Renaming updates existing ${media[type].label.toLowerCase()} with that label.`
    status.textContent = ''
    setup.hidden = true
    render()
    dialog.showModal()
    current.focus()
    load()
  })
  current.addEventListener('change', () => {
    next.value = current.value
    status.textContent = ''
    next.focus()
    next.select()
  })
  close.addEventListener('click', () => { if (!pending) dialog.close() })
  dialog.addEventListener('cancel', (event) => { if (pending) event.preventDefault() })

  form.addEventListener('submit', async (event) => {
    event.preventDefault()
    if (!owner || pending) return
    const request = version
    const existing = current.value
    const desired = categoryName(next.value)
    if (!existing || !desired || desired.length > 48) {
      status.textContent = 'Enter a new name up to 48 characters.'
      next.focus()
      return
    }
    if (existing === desired) {
      status.textContent = 'Enter a different name.'
      next.focus()
      return
    }
    const newKey = categoryKey(desired)
    if (getNames(type).some((name) => name !== existing && categoryKey(name) === newKey)) {
      status.textContent = 'That name is already in use for this media type.'
      next.focus()
      return
    }
    pending = true
    for (const control of [current, next, submit, close]) control.disabled = true
    status.textContent = 'Renaming…'
    setup.hidden = true
    let saved = false
    try {
      await loadRequest
      if (request !== version) return
      const { data, error } = await db.rpc('tiershelf_rename_category', {
        category_type: type, existing_name: existing, new_name: desired,
      })
      if (request !== version) return
      if (error) throw error
      store(data.aliases, type)
      onUpdate(type, existing, desired)
      render(desired)
      const count = data.affected
      status.textContent = `Renamed to “${desired}”.` + (count ? ` Updated ${count} ${count === 1 ? 'title' : 'titles'}.` : '')
      saved = true
    } catch (error) {
      if (request !== version) return
      setup.hidden = !needsMigration(error)
      status.textContent = !setup.hidden ? ''
        : error.code === '23505' ? 'That name is already in use for this media type.'
          : error.code === '40001' ? 'This category changed in another tab. Reopen the editor and try again.'
            : 'Could not rename the category. Try again.'
    } finally {
      if (request === version) {
        pending = false
        for (const control of [current, next, submit, close]) control.disabled = false
        if (saved) next.focus()
      }
    }
  })

  return {
    label, labels,
    get loading() { return Boolean(loadRequest) },
    preferredLabels: (type) => [...(aliases.get(type)?.values() ?? [])],
    lookupNames(type, name) {
      const key = categoryKey(name)
      return [name, ...[...(aliases.get(type) ?? [])].filter(([, label]) => categoryKey(label) === key).map(([from]) => from)]
    },
    setOwner(active) {
      version++
      owner = active && Boolean(db)
      pending = false
      loadRequest = null
      aliases.clear()
      button.hidden = !owner
      for (const control of [current, next, submit, close]) control.disabled = false
      if (dialog.open) dialog.close()
      load()
    },
  }
}
