# TierShelf

A personal tier list for movies, books, and anime. Demo changes live in memory and reset on refresh. Dymon mode uses GitHub sign-in and saves private titles in Supabase.

## Run locally

Install Node.js 24, then run `npm ci` and `npm run dev`. Run `npm run build` to create the static site in `dist`.

## Connect Supabase

1. Create a free project in the [Supabase dashboard](https://supabase.com/dashboard). Keep the database password private.
2. Paste and run [schema.sql](supabase/schema.sql) in the project's SQL Editor. It permits only the GitHub account Dymon18 to read and change its own entries.
3. Open **Authentication → Sign In / Providers → GitHub** in Supabase and copy the OAuth callback URL shown there.
4. Go to [GitHub's new OAuth app form](https://github.com/settings/applications/new). Use **TierShelf** as the application name, the deployed GitHub Pages URL as the homepage, and the Supabase callback from step 3 as the authorization callback.
5. In GitHub, generate a client secret. Paste the client ID and secret into the GitHub provider settings in Supabase, enable the provider, and save. Keep that secret in Supabase.
6. In **Authentication → URL Configuration**, set the Site URL to the deployed GitHub Pages URL, including its trailing slash, and add the same URL under Redirect URLs. Add the actual local development URL if testing sign-in locally.
7. In the Supabase project's **Connect** panel, copy the project URL and the **publishable** key. Set both in [src/config.js](src/config.js). The publishable key is designed for browser use. Keep the secret key, service role key, and database password out of this file.
8. Push your changes to GitHub. Under **Settings → Pages**, select **GitHub Actions** as the source. Run the **Deploy TierShelf** workflow if enabling Pages after the first push.

Use **Dymon login** to sign in and save a title. Open the site on another device and sign in with the same GitHub account to check that the title appears.


## Credits

The Demo mode background uses the [Chromium offline error artwork](https://github.com/chromium/chromium/blob/main/components/neterror/resources/images/default_100_percent/offline/100-error-offline.png). [Chromium license](public/credits/chromium-license.txt)

PokéQueue uses the species list, Pokémon sprites, and Poké Ball item sprite from [PokéAPI](https://pokeapi.co/). Pokémon artwork belongs to its respective rights holders.
