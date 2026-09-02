// version.js - single source of truth for the app's user-facing version tag,
// shown next to the title in App.jsx. It is DERIVED from the newest changelog
// entry so the number in the header and the number in the "What's new" panel
// cannot drift apart: to release, add one entry to src/changelog.js and this
// follows. See CLAUDE.md "Versioning" for the convention.
import { LATEST } from './changelog.js';

export const APP_VERSION = LATEST.version;
