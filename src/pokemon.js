import pokemon from './pokemon.json'
import forms from './pokemon-forms.json'

export const ditto = 132
export const extraPokemonColumn = ',extra_pokemon_ids'
const maxRecommenders = 20
const pokemonKey = (name) => name.normalize('NFD').replace(/\p{M}/gu, '')
  .toLowerCase().replaceAll('♀', 'f').replaceAll('♂', 'm').replace(/[^a-z0-9]+/g, '')
const names = { ...pokemon, ...forms }
const species = new Map(Object.entries(names).map(([id, name]) => [pokemonKey(name), Number(id)]))
species.set('greninjaash', 10117)
species.set('calyrexicerider', 10193)
species.set('calyrexshadowrider', 10194)

export function pokemonName(id) {
  return names[id] ?? ''
}

export function pokemonId(name) {
  return species.get(pokemonKey(name))
}

export function populatePokemonOptions(datalist) {
  for (const name of Object.values(names).sort((a, b) => a.localeCompare(b))) {
    datalist.append(new Option(name, name))
  }
}

export function pokemonSprite(id) {
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

export function recommenderIds(primary, extras) {
  return [...new Set([primary, ...(extras ?? [])].filter(pokemonName))]
}

export function createPokemonPicker(input, preview, add) {
  let selected = []
  let multiple = false

  function render() {
    preview.replaceChildren()
    if (input.disabled) return
    for (const id of selected) {
      const chip = document.createElement('span')
      chip.className = 'pokemon-chip'
      const remove = document.createElement('button')
      remove.className = 'icon-button'
      remove.type = 'button'
      remove.textContent = '×'
      remove.setAttribute('aria-label', 'Remove ' + pokemonName(id))
      remove.addEventListener('click', () => {
        selected = selected.filter((option) => option !== id)
        input.setCustomValidity('')
        render()
        input.focus()
      })
      chip.append(pokemonSprite(id), pokemonName(id), remove)
      preview.append(chip)
    }
    const pending = pokemonId(input.value)
    if (pending && !selected.includes(pending)) {
      const chip = document.createElement('span')
      chip.className = 'pokemon-chip pokemon-preview'
      chip.append(pokemonSprite(pending), pokemonName(pending))
      preview.append(chip)
    }
  }

  function read(required = false) {
    const value = input.value.trim()
    const id = pokemonId(value)
    const ids = id ? [...new Set([...selected, id])] : [...selected]
    const error = (value && !id) || (required && !ids.length)
      ? 'Choose a Pokémon alias from the list.'
      : ids.length > maxRecommenders ? 'Choose up to 20 Pokémon.' : ''
    input.setCustomValidity(error)
    if (!error) return ids
    input.reportValidity()
    return null
  }

  function addSelection() {
    const ids = read(true)
    if (ids) {
      selected = ids
      input.value = ''
      render()
    }
    input.focus()
  }

  input.addEventListener('input', () => {
    input.setCustomValidity('')
    render()
  })
  input.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter' || event.isComposing || !multiple || !input.value.trim()) return
    event.preventDefault()
    addSelection()
  })
  add.addEventListener('click', addSelection)

  return {
    reset(ids, allowMultiple, disabled = false) {
      multiple = allowMultiple
      selected = multiple ? ids : []
      input.disabled = disabled
      input.value = multiple || disabled ? '' : pokemonName(ids[0])
      input.setCustomValidity('')
      add.hidden = !multiple || disabled
      render()
    },
    read,
  }
}
