import preset from '../design/tailwind-preset.js'

/**
 * A identidade visual (cores, raio, sombras, fonte) mora em ../design/ e é compartilhada com o
 * painel (v5.0). Aqui fica só o que é próprio do site: onde procurar classes.
 *
 * @type {import('tailwindcss').Config}
 */
export default {
  presets: [preset],
  content: ['./src/**/*.{astro,html,ts}'],
  plugins: [],
}
