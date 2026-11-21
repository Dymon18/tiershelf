import { media, mediaKeys } from './media.js'

const reduceMotion = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches

export function enterView(element) {
  if (reduceMotion() || !element.animate) return
  element.getAnimations?.().filter((animation) => animation.id === 'tiershelf-enter')
    .forEach((animation) => animation.cancel())
  const animation = element.animate([
    { opacity: .45, transform: 'translateY(5px)' },
    { opacity: 1, transform: 'translateY(0)' },
  ], { duration: 230, easing: 'cubic-bezier(.22,.68,.32,1)' })
  animation.id = 'tiershelf-enter'
}

export function initDecorations() {
  const patternRoot = document.getElementById('media-patterns')
  for (const kind of mediaKeys) {
    const pattern = document.createElement('div')
    pattern.className = 'media-pattern'
    pattern.dataset.pattern = kind
    const { icons } = media[kind]
    for (let index = 0; index < 40; index++) {
      const icon = document.createElement('span')
      icon.textContent = icons[index % icons.length]
      pattern.append(icon)
    }
    patternRoot.append(pattern)
  }

  const cookieButton = document.getElementById('cookie-surprise')
  cookieButton.addEventListener('click', () => {
    const cookie = document.createElement('span')
    const rect = cookieButton.getBoundingClientRect()
    cookie.className = 'falling-cookie'
    cookie.textContent = '🍪'
    cookie.setAttribute('aria-hidden', 'true')
    cookie.style.left = (rect.left + rect.width / 2) + 'px'
    cookie.style.top = (rect.top + rect.height / 2) + 'px'
    document.body.append(cookie)
    document.querySelectorAll('.falling-cookie').forEach((item, i, items) => {
      if (i < items.length - 4) item.remove()
    })
    window.setTimeout(() => cookie.remove(), 1450)
  })
}

export function celebrate(kind, parent = document.body) {
  const effect = document.createElement('div')
  effect.className = 'celebration celebration-' + kind
  effect.setAttribute('aria-hidden', 'true')
  parent.querySelector(':scope > .celebration')?.remove()

  const icon = document.createElement('span')
  icon.className = 'celebration-icon'
  icon.textContent = { mailbox: '📫', sidequest: '📚', shelf: '📖' }[kind]
  effect.append(icon)
  if (kind === 'mailbox') {
    const letter = document.createElement('span')
    letter.className = 'celebration-letter'
    letter.textContent = '✉️'
    effect.append(letter)
  }
  if (!reduceMotion()) {
    const colors = ['#ffd897', '#f1a59c', '#c4b9ed', '#a6dbbc', '#a6cde8']
    for (let i = 0; i < 16; i++) {
      const spark = document.createElement('span')
      const angle = i * (2 * Math.PI / 16)
      const radius = 43 + ((i * 7) % 5) * 13
      spark.className = 'celebration-spark'
      spark.textContent = i % 3 ? '✦' : '✧'
      spark.style.setProperty('--spark-x', Math.round(Math.cos(angle) * radius) + 'px')
      spark.style.setProperty('--spark-y', Math.round(Math.sin(angle) * radius) + 'px')
      spark.style.setProperty('--spark-color', colors[i % colors.length])
      effect.append(spark)
    }
  }
  parent.append(effect)
  window.setTimeout(() => effect.remove(), 1600)
}
