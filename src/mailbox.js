const byId = (id) => document.getElementById(id)
const pageSize = 100

export function createMailbox(db, openRecommendation) {
  const button = byId('recommendation-mailbox')
  const dialog = byId('recommendation-dialog')
  const heading = byId('recommendation-heading')
  const close = byId('close-recommendation')
  const form = byId('recommendation-form')
  const title = byId('recommendation-title')
  const author = byId('recommendation-author')
  const sender = byId('recommendation-sender')
  const note = byId('recommendation-note')
  const send = byId('send-recommendation')
  const status = byId('recommendation-status')
  const setup = byId('recommendation-setup')
  const list = byId('recommendation-list')
  let mode = 'demo'
  let viewerKey = null
  let version = 0

  function setBusy(busy) {
    close.disabled = busy
    send.disabled = busy
  }

  function clear() {
    version++
    form.reset()
    list.replaceChildren()
    list.hidden = true
    setup.hidden = true
    status.textContent = ''
    setBusy(false)
  }

  function renderRecommendation(recommendation, request) {
    const item = document.createElement('li')
    const name = document.createElement('h3')
    name.textContent = recommendation.title
    const details = document.createElement('p')
    details.textContent = [
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
    if (Array.isArray(linked) ? linked.length : linked) {
      const filed = document.createElement('p')
      filed.textContent = 'In SideQuest'
      item.append(filed)
      return item
    }

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
    item.append(add)
    return item
  }

  async function loadInbox(request) {
    status.textContent = 'Loading recommendations…'
    try {
      const rows = []
      for (let offset = 0; ; offset += pageSize) {
        const { data, error } = await db.from('tiershelf_recommendations')
          .select('id,title,sender,author,note,created_at,tiershelf_queue!tiershelf_queue_source_recommendation_id_fkey(id)')
          .order('created_at', { ascending: false }).order('id')
          .range(offset, offset + pageSize - 1)
        if (request !== version) return
        if (error) throw error
        rows.push(...data)
        if (data.length < pageSize) break
      }
      list.append(...rows.map((row) => renderRecommendation(row, request)))
      list.hidden = !rows.length
      status.textContent = rows.length ? '' : 'No recommendations yet.'
    } catch (error) {
      if (request !== version) return
      setup.hidden = !['42P01', 'PGRST200', 'PGRST205'].includes(error.code)
      status.textContent = setup.hidden ? 'Could not load recommendations. Reopen the mailbox to retry.' : ''
    }
  }

  button.addEventListener('click', () => {
    if (!db || mode === 'demo') return
    clear()
    const owner = mode === 'dymon'
    heading.textContent = owner ? 'Recommendation mailbox' : 'Recommend a book'
    form.hidden = owner
    dialog.showModal()
    if (owner) loadInbox(version)
    else title.focus()
  })

  form.addEventListener('submit', async (event) => {
    event.preventDefault()
    if (mode !== 'viewer' || !viewerKey || send.disabled) return
    const book = title.value.trim()
    const name = sender.value.trim()
    if (!book || !name) {
      status.textContent = 'Enter the book title and your name, alias or nickname.'
      const missingInput = book ? sender : title
      missingInput.focus()
      return
    }
    const request = version
    setBusy(true)
    status.textContent = 'Sending recommendation…'
    try {
      const { data, error } = await db.rpc('tiershelf_submit_recommendation', {
        access_key: viewerKey,
        book_title: book,
        recommender_name: name,
        book_author: author.value.trim() || null,
        recommendation_note: note.value.trim() || null,
      })
      if (request !== version) return
      if (error) throw error
      if (!data) {
        status.textContent = 'This viewer key is no longer active. Ask Dymon for the current key.'
        return
      }
      form.reset()
      status.textContent = 'Recommendation sent. Thanks!'
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
    setMode(current, key) {
      mode = current
      viewerKey = current === 'viewer' ? key : null
      button.hidden = !db || current === 'demo'
      if (dialog.open) dialog.close()
      clear()
    },
  }
}
