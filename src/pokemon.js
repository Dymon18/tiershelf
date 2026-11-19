import pokemon from './pokemon.json'
import forms from './pokemon-forms.json'

export const ditto = 132
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
