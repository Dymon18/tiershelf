import { celebrate } from './effects.js'
import { defaultMedia, legacyMediaPrefix, media, mediaKind, readRecommendation, recommendLabel } from './media.js'

const byId = (id) => document.getElementById(id)
const pageSize = 100
const inboxColumns = 'id,title,sender,author,note,created_at,tiershelf_queue!tiershelf_queue_source_recommendation_id_fkey(id)'

export function createMailbox(db, openRecommendation, askForKey) {
  const button = byId('recommendation-mailbox')
  const dialog = byId('recommendation-dialog')
  const heading = byId('recommendation-heading')
  const close = byId('close-recommendation')
  const form = byId('recommendation-form')
  const title = byId('recommendation-title')
  const type = byId('recommendation-type')
  const author = byId('recommendation-author')
  const sender = byId('recommendation-sender')
  const note = byId('recommendation-note')
  const send = byId('send-recommendation')
  const status = byId('recommendation-status')
  const setup = byId('recommendation-setup')
  const deleteSetup = byId('recommendation-delete-setup')
  const list = byId('recommendation-list')
  let mode = 'demo'
  let viewerKey = null
  let activeMedia = defaultMedia
  let version = 0
  button.hidden = !db

  function setBusy(busy) {
    close.disabled = busy
    send.disabled = busy
    type.disabled = busy
    for (const action of list.querySelectorAll('button')) action.disabled = busy
  }

  function renderType() {
    const kind = mediaKind(type.value)
    heading.textContent = recommendLabel(kind)
    byId('recommendation-title-label').textContent = media[kind].name + ' title'
    byId('recommendation-author-field').hidden = kind !== 'book'
    author.disabled = kind !== 'book'
  }

  function setMedia(kind) {
    activeMedia = mediaKind(kind)
    button.textContent = mode === 'dymon' ? 'Recommendation mailbox' : recommendLabel(activeMedia)
  }

  type.addEventListener('change', renderType)

  function clear() {
    version++
    form.reset()
    dialog.querySelector('.celebration-mailbox')?.remove()
    list.replaceChildren()
    list.hidden = true
    setup.hidden = true
    deleteSetup.hidden = true
    status.textContent = ''
    setBusy(false)
  }

  async function deleteRecommendation(recommendation, item, remove, request) {
    if (close.disabled || mode !== 'dymon' || request !== version) return
    if (!window.confirm(`Delete the recommendation for “${recommendation.title}”?`)) return

    setBusy(true)
    deleteSetup.hidden = true
    status.textContent = 'Deleting recommendation…'
    let focusTarget = remove
    try {
      const { error } = await db.from('tiershelf_recommendations').delete().eq('id', recommendation.id)
      if (request !== version) return
      if (error) throw error
      const neighbor = item.nextElementSibling ?? item.previousElementSibling
      focusTarget = neighbor?.querySelector('.danger') ?? close
      item.remove()
      list.hidden = !list.childElementCount
      status.textContent = list.hidden ? 'Recommendation deleted. The mailbox is empty.' : 'Recommendation deleted.'
    } catch (error) {
      if (request !== version) return
      deleteSetup.hidden = error.code !== '42501'
      status.textContent = deleteSetup.hidden ? 'Could not delete this recommendation. Try again.' : ''
    } finally {
      if (request === version) {
        setBusy(false)
        focusTarget.focus()
      }
    }
  }

  function renderRecommendation(recommendation, request) {
    const item = document.createElement('li')
    const name = document.createElement('h3')
    name.textContent = recommendation.title
    const details = document.createElement('p')
    details.textContent = [
      media[recommendation.media_type].name,
      recommendation.author,
      'From ' + recommendation.sender,
      new Date(recommendation.created_at).toLocaleDateString(),
    ].filter(Boolean).join(' · ')
    item.append(name, details)
    if (recommendation.note) {
      const message = document.createElement('p')
      message.className = 'recommendation-note'
      message.textContent = recommendation.note
      item.append(message)
    }
    const linked = recommendation.tiershelf_queue
    const actions = document.createElement('div')
    actions.className = 'recommendation-actions'
    if (Array.isArray(linked) ? linked.length : linked) {
      const filed = document.createElement('p')
      filed.textContent = 'In SideQuest'
      item.append(filed)
    } else {
      const add = document.createElement('button')
      add.type = 'button'
      add.className = 'button'
      add.textContent = 'Add to SideQuest'
      add.addEventListener('click', async () => {
        if (close.disabled || mode !== 'dymon' || request !== version) return
        setBusy(true)
        status.textContent = ''
        try {
          const opened = await openRecommendation(recommendation)
          if (request !== version) return
          if (opened) dialog.close()
          else status.textContent = 'Could not open the QuestLog editor. Try again.'
        } catch {
          if (request === version) status.textContent = 'Could not open the QuestLog editor. Try again.'
        } finally {
          if (request === version) setBusy(false)
        }
      })
      actions.append(add)
    }

    const remove = document.createElement('button')
    remove.type = 'button'
    remove.className = 'button danger'
    remove.textContent = 'Delete'
    remove.setAttribute('aria-label', `Delete recommendation for ${recommendation.title}`)
    remove.addEventListener('click', () => deleteRecommendation(recommendation, item, remove, request))
    actions.append(remove)
    item.append(actions)
    return item
  }

  async function loadInbox(request) {
    status.textContent = 'Loading recommendations…'
    try {
      const rows = []
      let columns = inboxColumns + ',media_type'
      const fetchPage = (offset) => db.from('tiershelf_recommendations').select(columns)
        .order('created_at', { ascending: false }).order('id').range(offset, offset + pageSize - 1)
      for (let offset = 0; ; offset += pageSize) {
        let result = await fetchPage(offset)
        if (request !== version) return
        if (offset === 0 && ['42703', 'PGRST204'].includes(result.error?.code)) {
          columns = inboxColumns
          result = await fetchPage(offset)
        }
        if (request !== version) return
        const { data, error } = result
        if (error) throw error
        rows.push(...data)
        if (data.length < pageSize) break
      }
      list.append(...rows.map((row) => renderRecommendation(readRecommendation(row), request)))
      list.hidden = !rows.length
      status.textContent = rows.length ? '' : 'No recommendations yet.'
    } catch (error) {
      if (request !== version) return
      setup.hidden = !['42P01', 'PGRST200', 'PGRST205'].includes(error.code)
      status.textContent = setup.hidden ? 'Could not load recommendations. Reopen the mailbox to retry.' : ''
    }
  }

  function open(kind = activeMedia) {
    if (!db || dialog.open) return
    if (mode === 'demo') {
      askForKey(kind)
      return
    }
    clear()
    const owner = mode === 'dymon'
    if (owner) heading.textContent = 'Recommendation mailbox'
    else {
      type.value = mediaKind(kind)
      renderType()
    }
    form.hidden = owner
    dialog.showModal()
    if (owner) loadInbox(version)
    else title.focus()
  }
  button.addEventListener('click', () => open())

  form.addEventListener('submit', async (event) => {
    event.preventDefault()
    if (mode !== 'viewer' || !viewerKey || send.disabled) return
    const nameOfWork = title.value.trim()
    const name = sender.value.trim()
    const kind = mediaKind(type.value)
    if (!nameOfWork || !name) {
      status.textContent = 'Enter the ' + media[kind].name.toLowerCase() + ' title and your name, alias or nickname.'
      const missingInput = nameOfWork ? sender : title
      missingInput.focus()
      return
    }
    const request = version
    setBusy(true)
    status.textContent = 'Sending recommendation…'
    try {
      const message = {
        access_key: viewerKey,
        recommender_name: name,
        recommendation_note: note.value.trim() || null,
      }
      const sendLegacy = (bookAuthor) => db.rpc('tiershelf_submit_recommendation', {
        ...message, book_title: nameOfWork, book_author: bookAuthor,
      })
      let result = kind === 'book' ? await sendLegacy(author.value.trim() || null)
        : await db.rpc('tiershelf_submit_media_recommendation', {
          ...message, media_kind: kind, media_title: nameOfWork, media_author: null,
        })
      if (request !== version) return
      if (kind !== 'book' && ['PGRST202', '42883'].includes(result.error?.code)) {
        result = await sendLegacy(legacyMediaPrefix + kind)
      }
      if (request !== version) return
      const { data, error } = result
      if (error) throw error
      if (!data) {
        status.textContent = 'This friend key is no longer active. Ask Dymon for the current key.'
        return
      }
      form.reset()
      type.value = kind
      renderType()
      status.textContent = 'Recommendation sent. Thanks!'
      celebrate('mailbox', dialog)
      title.focus()
    } catch (error) {
      if (request !== version) return
      const messages = {
        PGRST202: 'The recommendation mailbox is still being set up.',
        P0001: 'The mailbox is busy. Try again in a minute.',
        '22023': 'Check the title, name and field lengths, then try again.',
      }
      status.textContent = messages[error.code] ?? 'Could not send your recommendation. Try again.'
    } finally {
      if (request === version) setBusy(false)
    }
  })

  close.addEventListener('click', () => dialog.close())
  dialog.addEventListener('close', clear)
  dialog.addEventListener('cancel', (event) => { if (close.disabled) event.preventDefault() })

  return {
    open,
    setMedia,
    setMode(current, key) {
      mode = current
      viewerKey = current === 'viewer' ? key : null
      if (dialog.open) dialog.close()
      clear()
      setMedia(activeMedia)
    },
  }
}
