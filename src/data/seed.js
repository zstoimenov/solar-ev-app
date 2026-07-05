// seed.js - first-run loader. If the store is empty, fetch the shipped
// seed-data_v1.json (relative to the Vite base so it resolves on Pages),
// validate, and persist. This is the only data fetch the app ever makes.

import { getState, putState } from './db.js';
import { validate } from './schema.js';

export async function loadOrSeed() {
  const existing = await getState();
  if (existing) return existing;

  // import.meta.env.BASE_URL === '/solar-ev-app/' in build, '/' in dev.
  const url = `${import.meta.env.BASE_URL}seed-data_v1.json`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Could not load seed data (${res.status}).`);
  const seed = validate(await res.json());
  await putState(seed);
  return seed;
}
