export function readViewState(view) {
  try {
    const state = JSON.parse(sessionStorage.getItem(storageKey(view)))
    return state && typeof state === 'object' ? state : {}
  } catch {
    return {}
  }
}

export function saveViewState(view, state) {
  try {
    sessionStorage.setItem(storageKey(view), JSON.stringify(state))
  } catch {
    // The current view still works if browser storage is unavailable.
  }
}

function storageKey(view) {
  return `tiershelf:${document.body.dataset.mode}:${view}`
}
