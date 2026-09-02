// cloudKeys.js - the Supabase project this app's optional cloud backup talks
// to. Both values are checked in and both end up in the public bundle. That
// is deliberate, and it is NOT the "API token in a public bundle" that
// CLAUDE.md rules out for weather providers and killed the 2026-08 cloud-sync
// idea. The difference is what the value can do on its own:
//
//   - A weather API key IS the authorisation. Whoever reads it out of the
//     bundle can spend the quota it belongs to.
//   - A Supabase PUBLISHABLE key only names the project. Every row in
//     `public.backups` sits behind row-level security keyed on auth.uid(), so
//     without a signed-in session this key can read nothing, write nothing
//     and delete nothing. It is designed to be shipped to browsers.
//
// Two things carry the actual safety, and neither lives here:
//   1. The household signs in by email magic link. That session, not this
//      key, is what RLS checks.
//   2. The payload is AES-GCM ciphertext from data/crypto.js before it is
//      ever sent. Supabase holds bytes it cannot read, so even a mistaken
//      policy exposes no household data.
//
// One dashboard setting is load-bearing and cannot be enforced from code:
// "Allow new users to sign up" must be OFF. With it on, this key lets a
// stranger create an account on the project. They still could not read the
// household's rows, but they could consume the free tier. See CLAUDE.md.
//
// Deliberately plain constants rather than import.meta.env: vite.config.js
// has no define()/loadEnv and deploy.yml has no env: block, and adding that
// plumbing would give a static public build exactly zero extra secrecy while
// creating two more places for the value to go missing.

export const SUPABASE_URL = 'https://xlhqigvzwavidsiwojiy.supabase.co';
export const SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_2e2eIVRO9BrZA7JF4o2L-w_PF_7lV1f';
