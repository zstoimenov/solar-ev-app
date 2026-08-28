// supabaseConfig.js - where the optional cloud-backup feature points.
//
// These two values are the project URL and the *publishable* (anon) API key.
// A publishable key is designed to be shipped in a public client bundle: it
// carries no privileges of its own, it only identifies the project. Every
// row in `public.backups` is gated by row-level security keyed on
// `auth.uid()`, so holding this key grants access to exactly nothing until
// you have signed in as a real user. That is the distinction CLAUDE.md draws
// when it says the bundle "can never carry an API token" - a service-role
// key or any bearer secret would be a token; this is not one.
//
// Still overridable at build time (VITE_SUPABASE_URL /
// VITE_SUPABASE_PUBLISHABLE_KEY) so a fork can point at its own project
// without editing source. Defaults are baked in so the GitHub Pages workflow
// needs no repository variables to keep working.

export const SUPABASE_URL =
  import.meta.env.VITE_SUPABASE_URL || 'https://xlhqigvzwavidsiwojiy.supabase.co';

export const SUPABASE_PUBLISHABLE_KEY =
  import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY || 'sb_publishable_2e2eIVRO9BrZA7JF4o2L-w_PF_7lV1f';

// The app must stay fully usable with no cloud project at all - every cloud
// entry point checks this first and renders an explanation instead of a
// broken control.
export const cloudEnabled = Boolean(SUPABASE_URL && SUPABASE_PUBLISHABLE_KEY);

// Where the emailed sign-in link comes back to. Uses Vite's BASE_URL so it
// resolves to the Pages path in production and the dev-server path locally,
// both of which must be listed in Supabase -> Authentication -> URL
// Configuration or the link will bounce to the project's Site URL.
export function authRedirectUrl() {
  if (typeof window === 'undefined') return null;
  return `${window.location.origin}${import.meta.env.BASE_URL}`;
}
