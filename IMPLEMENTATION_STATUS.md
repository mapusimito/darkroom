# Darkroom — Implementation Status

> **Last Updated**: 2026-02-27
> **Current Milestone**: M13/M14/M15 🔄 In Progress
> **Project**: Darkroom — Drive Media Manager (V2 pivot)
> **Vision**: V2 — Collaborative event photo collection. Host creates event → QR code → guests upload → cinematic gallery.

---

## Status Legend

| Symbol | Meaning |
|--------|---------|
| ⬜ | Not Started |
| 🔄 | In Progress |
| ✅ | Completed |
| ⚠️ | Blocked/Issues |

---

## Milestone Summary

| Milestone | Name | Tasks | Status | Target |
|-----------|------|-------|--------|--------|
| 1 | MVP Core Gallery | 6 | ✅ 100% | 2026-02-26 |
| 2 | Slideshow Mode | 5 | ✅ 100% | 2026-02-26 |
| 3 | Favorites & Shortlist | 4 | ✅ 100% | 2026-02-26 |
| 4 | Multi-file ZIP Download | 4 | ✅ 100% | 2026-02-26 |
| 5 | Date Auto-Grouping | 5 | ✅ 100% | 2026-02-26 |
| 6 | URL Sharing & Deep Links | 4 | ✅ 100% | 2026-02-27 |
| 7 | Private Folder OAuth | 6 | ✅ 100% | 2026-02-27 |
| 8 | AI Tagging (On-Device) | 7 | ✅ 100% | 2026-02-27 |
| 9 | Embeddable Gallery Widget | 5 | ✅ 100% | 2026-02-27 |
| 10 | Timeline View | 6 | ✅ 100% | 2026-02-27 |
| 11 | Pricing Page & Onboarding | 5 | ✅ 100% | 2026-02-27 |
| 12 | Password-Protected Galleries | 5 | ✅ 100% | 2026-02-27 |
| 13 | Event Creation & QR Upload Portal | 11 | ✅ 100% | 2026-02-27 |
| 14 | Live Event Experience | 8 | ✅ 100% | 2026-02-27 |
| 15 | Post-Event Delivery & Sharing | 9 | ✅ 100% | 2026-02-27 |

---

## Milestone 1 — MVP Core Gallery ✅

> **Goal**: Paste a public Drive folder link → browse a beautiful cinematic gallery.
> **Status**: Complete (QA pass 2026-02-26)
> **Completed**: 2026-02-26

### Tasks

| # | Task | Status | Notes |
|---|------|--------|-------|
| 1.1 | Google Drive API v3 integration (files.list, files.get) | ✅ | Clean — `apiFetch` / `apiFolderName` wired correctly |
| 1.2 | Responsive masonry/grid with skeleton loading | ✅ | Clean — skeleton classes all present in CSS |
| 1.3 | Lightbox viewer — full-res images + video iframe embed | ✅ | Clean — onerror fallback safe; `esc()` used on file.id |
| 1.4 | Search, filter by type, sort controls | ✅ | Clean — all DOM IDs match; filter/sort/search flow correct |
| 1.5 | Subfolder drill-down with breadcrumb navigation | ✅ | Fixed on QA pass — see QA Notes #1 |
| 1.6 | Mobile responsive + touch swipe in lightbox | ✅ | Clean — breakpoints at 768px and 480px complete; touch swipe present |

### Notes
- Modularized into `index.html` / `style.css` / `script.js`
- API key stored in localStorage via settings modal (never committed)
- Auto-loads up to 200 items, pagination for larger folders
- URL param `?folder=<id>` for deep linking

### QA Notes (2026-02-26)

All DOM ID references between `index.html` and `script.js` verified — no mismatches found. All CSS classes used in JS template strings verified against `style.css` — no missing classes. Settings modal (`settingsBtn`, `settingsMod`, `apiKeyInput`, `apiKeySave`, `apiKeyClear`, `apiKeyClose`, `apiKeyDot`) all wire up correctly. Breadcrumb `renderCrumb()` uses `esc()` on both `f.id` and `f.name` before writing to HTML attributes — no XSS risk.

**Bugs fixed:**

1. **`loadMore()` permanent lock** (`script.js` line ~234): If `S.stack` was somehow empty when "Load more" was clicked, the early `return` exited before the `finally` block, leaving `S.loading = true` and the button disabled forever. Fixed by resetting `S.loading` and button state before returning.

2. **Missing `noreferrer` on card action links** (`script.js` `renderGrid()`): Both the "Open" and "Save" `<a>` buttons used `rel="noopener"` but omitted `noreferrer`. This leaks the `Referer` header to the Drive destination and (in older browsers) does not fully isolate `window.opener`. Fixed to `rel="noopener noreferrer"` on both links.

3. **Missing `noreferrer` in `window.open` call** (`script.js` `renderGrid()`): The fallback click handler for non-media, non-folder files called `window.open(..., 'noopener')`. Updated to `'noopener,noreferrer'` for consistency with the anchor links.

**No issues found in:**
- All DOM ID lookups (`D` object) match HTML exactly
- All CSS classes referenced in JS template strings exist in `style.css`
- `esc()` used consistently for all user/API-sourced strings in `innerHTML`
- Lightbox `onerror` fallback URL is safe (file.id is `esc()`-encoded; Drive IDs are alphanumeric-only)
- Breadcrumb click handlers use `el.dataset.id` / `el.dataset.name` (browser-decoded from the `esc()`-encoded attributes) — safe
- Mobile breakpoints at 768px and 480px are complete for M1 scope
- Settings modal overlay click-to-close, Escape key, and Enter-to-save all wired correctly

---

## Milestone 2 — Slideshow Mode ✅

> **Goal**: Auto-advancing full-screen slideshow with cinematic transitions — great for TV casting or family gatherings.
> **Status**: Complete
> **Completed**: 2026-02-26

### Tasks

| # | Task | Status |
|---|------|--------|
| 2.1 | Slideshow button in toolbar | ✅ |
| 2.2 | Auto-advance timer with configurable interval (4s default) | ✅ |
| 2.3 | Ken Burns pan & zoom CSS animation on each image | ✅ |
| 2.4 | Full-screen API integration (Fullscreen API) | ✅ |
| 2.5 | Pause/resume on click + keyboard spacebar | ✅ |

### Notes
- Ken Burns effect: slow scale(1.0→1.07) + 4 variant translate directions, 5s duration each
- Respects current filter — uses S.media[] (filtered image+video items)
- Progress bar at bottom animates linearly over the 4s interval
- Keyboard: Space=pause/resume, Escape=close, ArrowLeft/Right=navigate
- Touch swipe left/right navigates slides
- Fullscreen API via document.requestFullscreen on the overlay element

---

## Milestone 3 — Favorites & Shortlist ✅

> **Goal**: Let viewers star items without editing the Drive folder — stored locally via localStorage.
> **Status**: Complete
> **Completed**: 2026-02-26

### Tasks

| # | Task | Status |
|---|------|--------|
| 3.1 | Heart toggle button on each card (top-right of thumb) | ✅ |
| 3.2 | LocalStorage persistence keyed by Drive file ID | ✅ |
| 3.3 | "♡ Favs" filter tab in toolbar | ✅ |
| 3.4 | Favorites count badge (♥ N pill) in header | ✅ |

### Notes
- In-memory `_favs` Set cache — serialized to localStorage only on toggle (no repeated parsing)
- Fav button: hidden by default, visible on card hover; always visible (pink) when faved
- Header badge hidden when count = 0; click jumps to favorites view if gallery is open
- Favorites empty-state shows ♡ icon with hint text ("Hover a card and tap ♡ to save…")
- `S.filter === 'favorites'` filters current folder's files by `isFav(id)`
- Cross-session: IDs stored as JSON array in `localStorage['darkroom_favs']`

---

## Milestone 4 — Multi-file ZIP Download ✅

> **Goal**: Let users select multiple files and download them as a ZIP — without leaving the app.
> **Status**: Complete
> **Completed**: 2026-02-26

### Tasks

| # | Task | Status |
|---|------|--------|
| 4.1 | Multi-select mode toggle (checkbox overlay on cards) | ✅ |
| 4.2 | Selection state management and count badge | ✅ |
| 4.3 | Client-side ZIP packaging with JSZip | ✅ |
| 4.4 | Progress indicator during ZIP generation | ✅ |

### Notes
- JSZip v3.10.1 via CDN — runs entirely in browser, no server needed
- `googleapis.com/drive/v3/files/{id}?alt=media&key=…` for CORS-safe binary fetch
- Google Workspace files (Docs, Sheets, Slides) skipped — no binary content; detected via `application/vnd.google-apps.` mime prefix
- 2-phase progress: fetch phase (0→80%) + DEFLATE compress phase (80→100%)
- Warns before downloading >50 files (memory safety)
- "Select all" selects all non-folder items in the current filtered view
- `body.select-mode` CSS class drives checkbox visibility without JS per-card style changes
- `S.selected` Set persists across filter changes while in select mode

---

## Milestone 5 — Date Auto-Grouping ✅

> **Goal**: Automatically cluster media by date (year → month → day) so people can navigate memories chronologically.
> **Status**: Complete
> **Completed**: 2026-02-26

### Tasks

| # | Task | Status |
|---|------|--------|
| 5.1 | Parse `modifiedTime` into year/month groups | ✅ |
| 5.2 | Group header rows in grid (sticky date labels) | ✅ |
| 5.3 | "Timeline" sort mode option | ✅ |
| 5.4 | Collapse/expand group sections | ✅ |
| 5.5 | Jump-to-date quick nav sidebar | ✅ |

### Notes
- `groupFiles()` clusters `S.filtered` into `{key, label, shortLabel, files[]}` sorted newest-first
- "Timeline" added as a sort option in the dropdown — triggers `renderGridGrouped()` instead of the flat `renderGrid()`
- Group headers: `position: sticky; top: 62px` — stick just below the app header while scrolling through their group
- Collapse/expand: clicking a header toggles `S.collapsedGroups` Set and directly toggles `.group-hidden` on child cards (no full re-render)
- Sidebar (`#date-nav`): fixed right-side, hidden on screens <1280px; IntersectionObserver highlights the active group; click smooth-scrolls to the group header
- Flat rendering refactored into `buildCardHtml(file, idx, gkey)` + `wireCardEvents()` shared by both renderers
- `S.collapsedGroups` cleared on folder navigation to start fresh

---

## Milestone 6 — URL Sharing & Deep Links ✅

> **Goal**: Every gallery state (folder, filters, open lightbox item) should be shareable as a URL.
> **Status**: Complete
> **Completed**: 2026-02-27

### Tasks

| # | Task | Status |
|---|------|--------|
| 6.1 | Sync folder ID to URL param `?folder=<id>` on navigate | ✅ |
| 6.2 | Sync filter/sort state to URL params | ✅ |
| 6.3 | Sync open lightbox item to URL param `?item=<id>` | ✅ |
| 6.4 | "Copy gallery link" button in header | ✅ |

### Notes
- `syncUrl()` — single function reads `S.stack`, `S.filter`, `S.sort`, `S.search`, `S.lbIdx` and calls `replaceState` or `pushState`
- `_nextSyncPush` flag: set `true` in `browse()` when drilling into a new subfolder; consumed once by `syncUrl()`
- `_skipNextSync` flag: set `true` in `popstate` handler to force replaceState even if `_nextSyncPush` is true
- URL params: `?folder=<id>` (always) + optional `&filter=<f>&sort=<s>&q=<search>&item=<id>`
- `applyFilter()` calls `syncUrl()` at end — covers filter/sort/search changes automatically
- `openLb()` / `closeLb()` both call `syncUrl()` to add/remove `?item=` param
- Boot: reads all params from URL, sets `_pending*` variables consumed by `applyFilter()` on first render
- `popstate` handler: restores full state from URL + triggers `browse()` for back/forward navigation
- "Copy link" button (🔗 icon): visible when gallery is open; copies `location.href` with `navigator.clipboard`; toast confirms success/failure
- Copy link button CSS: `.copy-link-btn` — same size as settings-btn, accent highlight on hover

---

## Milestone 7 — Private Folder OAuth ✅

> **Goal**: Allow users to browse their own private Drive folders securely via Google OAuth — without making anything public.
> **Status**: Complete
> **Completed**: 2026-02-27

### Tasks

| # | Task | Status |
|---|------|--------|
| 7.1 | Google OAuth 2.0 token client via Google Identity Services (GIS) | ✅ |
| 7.2 | "Sign in" button in header + user profile pill (name/avatar) | ✅ |
| 7.3 | Token stored in `sessionStorage` with expiry; restored on boot | ✅ |
| 7.4 | API calls use `Authorization: Bearer <token>` when signed in (no API key needed) | ✅ |
| 7.5 | "My Drive" sidebar — root-level folders, clicking browses to that folder | ✅ |
| 7.6 | Sign-out with `google.accounts.oauth2.revoke()` + token/session cleared | ✅ |

### Notes
- GIS library (`accounts.google.com/gsi/client`) is lazy-loaded on first "Sign in" click — no impact for non-OAuth users
- `initTokenClient` scope: `drive.readonly profile email` (profile/email for showing user name in pill)
- `_tokenClient` initialized via `initGIS()` after GIS script loads; re-initialized if client ID changes
- `authHeaders()` returns `{ Authorization: Bearer }` when signed in, `{}` otherwise; API key param added only when not signed in
- 401 response clears auth state gracefully via `handleTokenExpiry()`
- `tryRestoreAuth()` runs at boot — restores session from `sessionStorage` if token has >1 min remaining
- My Drive sidebar: fixed left panel (hidden below 1280px), lazy-loads root folders after sign-in
- OAuth client ID stored in `localStorage` as `darkroom_client_id`; also supports `DARKROOM_CONFIG.clientId` in config.js
- Settings modal now has two sections: API Key (existing) + Private Folders (new OAuth section)
- Public folder browsing via API key still fully supported — OAuth is opt-in

---

## Milestone 8 — AI Tagging (On-Device) ✅

> **Goal**: Auto-label photos by scene, object, and content so users can search "beach", "birthday cake", "dog" — without uploading to any AI service.
> **Status**: Complete
> **Completed**: 2026-02-27

### Tasks

| # | Task | Status |
|---|------|--------|
| 8.1 | Integrate TensorFlow.js MobileNet for on-device image classification | ✅ |
| 8.2 | Background tag generation after gallery loads | ✅ |
| 8.3 | Tag display on card hover | ✅ |
| 8.4 | Tag-based search integration | ✅ |
| 8.5 | Tag index persistence in localStorage | ✅ |
| 8.6 | Progress indicator while tagging batch | ✅ |
| 8.7 | Opt-in toggle (AI tagging is off by default) | ✅ |

### Notes
- TF.js (`@tensorflow/tfjs@4.20.0`) + MobileNet v2 (`@tensorflow-models/mobilenet@2.1.0`) lazy-loaded from CDN — zero impact for users who don't enable it
- `AI_THRESHOLD = 0.30` confidence cutoff, `AI_SHOW_TAGS = 3` per card, `AI_MAX_PREDS = 5` requested from model
- `loadTFScripts()` chains TF.js → MobileNet script injection; only loads once (`window.mobilenet` guard)
- `enableAiTagging()` loads model, then calls `startAiTagging()`; handles load errors gracefully with toast
- `startAiTagging()` builds queue of untagged `thumbnailLink` images (`hasOwnProperty` check — files without `thumbnailLink` skipped)
- `processAiQueue()` async loop: sequential classification; saves each result (even empty) to prevent re-processing on next render
- `classifyImage()` uses `img.crossOrigin = 'anonymous'` before `.src` — required for lh3.googleusercontent.com CORS
- `paintAiTags()` updates `.ai-tags` div in-place without re-rendering the whole card
- `_aiTags` stored in `localStorage['darkroom_ai_tags']` as `{ [fileId]: string[] }`; opt-in state in `darkroom_ai_enabled`
- `browse()` clears `_aiQueue` on folder navigation to cancel in-flight batch
- `applyFilter()` auto-starts tagging when AI is enabled and grid re-renders; also integrates AI tag search
- Tag colors: green monospace pills (`.ai-tag`) to visually distinguish from filename/meta text
- AI status indicator (`.ai-status`) shows "AI: N/M" count during processing, hidden when idle

---

## Milestone 9 — Embeddable Gallery Widget ✅

> **Goal**: Generate a `<iframe>` embed code so any blog, portfolio, or website can show a live Darkroom gallery inline.
> **Status**: Complete
> **Completed**: 2026-02-27

### Tasks

| # | Task | Status |
|---|------|--------|
| 9.1 | Embed mode URL param `?embed=1` for minimal iframe UI | ✅ |
| 9.2 | Hide header in embed mode, show compact toolbar only | ✅ |
| 9.3 | "Get embed code" button — generates `<iframe src="...">` snippet | ✅ |
| 9.4 | Copy-to-clipboard with code preview modal | ✅ |
| 9.5 | Postmessage API for parent page communication (optional) | ✅ |

### Notes
- `_isEmbed` const evaluated once at boot from `?embed=1` URL param; adds `body.embed-mode` class
- `body.embed-mode` CSS hides the header, drive sidebar, and date nav sidebar
- Embed button (`#embed-btn`) shown in the header when a gallery is open, hidden in embed mode itself
- `openEmbedModal()` builds the `<iframe>` snippet using `buildEmbedSrc()` — mirrors current URL with `?embed=1` + current folder/filter/sort state
- Width/height inputs (default `100%` / `600px`) update the snippet live via `input` events
- "Copy Code" button copies snippet via `navigator.clipboard`, shows toast, closes modal
- `syncUrl()` preserves `?embed=1` in URL history entries when in embed mode (so back/forward navigation doesn't lose embed state)
- PostMessage: `postParent()` sends `{ source: 'darkroom', type: 'lightbox:open'|'lightbox:close', fileId, fileName }` to `window.parent` when lightbox is opened/closed inside an iframe
- Lightbox, search, filter, and folder navigation all fully functional inside the embed

---

## Milestone 10 — Timeline View ✅

> **Goal**: A vertical scrollable timeline of all media — a visual diary of memories organized chronologically.
> **Status**: Complete
> **Completed**: 2026-02-27

### Tasks

| # | Task | Status |
|---|------|--------|
| 10.1 | Timeline view toggle (alongside grid view) | ✅ |
| 10.2 | Vertical scroll layout with date milestone markers | ✅ |
| 10.3 | Year/month header anchors with smooth scroll jump | ✅ |
| 10.4 | Mixed media rows (photos + videos in chronological strip) | ✅ |
| 10.5 | "Jump to year" mini-map on the right edge | ✅ |
| 10.6 | Print/export timeline as PDF (optional stretch goal) | ✅ |

### Notes
- View toggle button group in toolbar (Grid ⊞ | Timeline ≡) — `S.viewMode = 'grid' | 'timeline'`, persisted in `localStorage['darkroom_view_mode']`
- View mode synced to URL as `?view=timeline`; restored on boot (URL takes precedence over localStorage) and on browser back/forward
- `renderTimeline()` — dedicated renderer; calls `groupFiles()` (same as M5 grouped grid) for chronological clustering
- Timeline layout: editorial year banners (`.tl-year-sep`) with orange gradient text, then month sections (`.tl-section`) with header and wrapping strip of 156×156px square cards
- All file types shown in timeline: images/videos as thumbnails, folders/docs as icon cards; clicking opens lightbox or browses folder
- Fav-btn hover toggle works on timeline cards same as grid cards
- Year mini-map (`.tl-minimap`): fixed right side, hidden below 1280px; IntersectionObserver on `.tl-year-sep` elements drives active state; click smooth-scrolls to year banner
- `buildTlMinimap(years)` — year array from `groupFiles()` result; re-disconnects previous observer on re-render
- Print button (toolbar, visible only in timeline mode) calls `window.print()`; `@media print` CSS hides all UI chrome and renders timeline cleanly for PDF export
- `renderGrid()` checks `S.viewMode === 'timeline'` first, dispatching to `renderTimeline()` before any other render path

---

---

## Milestone 11 — Pricing Page & Onboarding ✅

> **Goal**: Add a pricing page and landing page improvements to help users understand the product and upgrade.
> **Status**: Complete
> **Completed**: 2026-02-27

### Tasks

| # | Task | Status |
|---|------|--------|
| 11.1 | Tagline cycler on landing (rotating phrases, fade transition) | ✅ |
| 11.2 | Social proof section + demo link button on landing | ✅ |
| 11.3 | "Pricing" link in header pointing to `pricing.html` | ✅ |
| 11.4 | `pricing.html` — 3-tier standalone pricing page (Free / Pro / Creator) | ✅ |
| 11.5 | "Your Plan" section in settings modal with upgrade link | ✅ |

### Notes
- `startTaglineCycle()` rotates 5 taglines every 3.5s with `.tagline-out` fade (0.35s CSS transition)
- `DEMO_FOLDER_ID = ''` constant — set to a public Drive ID to enable the "Try demo" button
- `pricing.html` is a standalone page with inline pricing CSS; imports `style.css` for design tokens
- Three tiers: Free (public folders, 500 files, core gallery) / Pro ($8/mo, full features) / Creator ($20/mo, white-label)
- Settings modal plan section shows "Free" badge with link to `pricing.html`
- `pricing-link` in header is always visible; collapses gracefully on small screens

---

## Milestone 12 — Password-Protected Galleries ✅

> **Goal**: Let gallery owners generate a password-protected share link — visitors must enter the password to see the gallery.
> **Status**: Complete
> **Completed**: 2026-02-27

### Tasks

| # | Task | Status |
|---|------|--------|
| 12.1 | Protect button in header (visible when gallery is open) | ✅ |
| 12.2 | Protect modal: enter password → generate protected URL with SHA-256 hash | ✅ |
| 12.3 | Lock gate overlay: shown on boot when `?lock=<hash>` in URL | ✅ |
| 12.4 | `hashPassword()` using `crypto.subtle.digest('SHA-256')` — no dependencies | ✅ |
| 12.5 | `syncUrl()` and popstate preserve `?lock=` param across navigation | ✅ |

### Notes
- `hashPassword(pw)` → SHA-256 hex string using browser-native `crypto.subtle` (no library needed)
- `S.lockHash` stores the expected hash; set on boot from `?lock=` URL param
- Boot sequence: if `?lock=` + `?folder=` both present → show lock gate instead of browsing; browsing happens only after correct password in `tryUnlock()`
- Wrong password: `.lock-shake` CSS animation on the card (`@keyframes lockShake`); error message shown; input re-focused
- Protected URL format: `?folder=<id>&lock=<sha256hex>` — the hash is the password verifier, not the password itself
- Copy-to-clipboard button in protect modal; toast confirms success
- `protect-btn` shown in header only when a gallery is open and not in embed mode
- `syncUrl()` preserves `?lock=<hash>` in URL history entries so back/forward navigation doesn't lose lock state

---

## Milestone 13 — Event Creation & QR Upload Portal ✅

> **Goal**: V2 pivot — hosts create events, guests scan QR to upload photos to Drive.
> **Status**: Complete
> **Completed**: 2026-02-27

### Tasks

| # | Task | Status |
|---|------|--------|
| 13.1 | Event CRUD (create/delete) stored in localStorage | ✅ |
| 13.2 | Drive folder creation via API (POST /drive/v3/files) | ✅ |
| 13.3 | Set folder public-editable permission (POST /permissions) | ✅ |
| 13.4 | QR code generation (qrcode-generator CDN, canvas render) | ✅ |
| 13.5 | QR share modal (copy URL, download QR, WhatsApp, Email) | ✅ |
| 13.6 | Guest upload page (mobile-first, `?event=<id>&upload=1`) | ✅ |
| 13.7 | Guest OAuth (`drive.file` scope, GIS token client) | ✅ |
| 13.8 | File upload via XHR multipart with per-file progress | ✅ |
| 13.9 | Event dashboard on landing (event cards with counts) | ✅ |
| 13.10 | Close Uploads (DELETE permission) | ✅ |
| 13.11 | Cover style picker (4 themes: warm-gold, cool-blue, forest-green, sunset-pink) | ✅ |

### Notes
- Separate `_hostWriteToken` (drive.file) for folder creation; existing M7 `drive.readonly` unchanged
- Separate `_guestToken` (drive.file) for guest uploads — narrowest possible scope
- Guest name stored as `description` field on uploaded files (for M15 contributor attribution)
- QR generated client-side via qrcode-generator (lazy-loaded CDN); rendered to `<canvas>` for download
- Upload URL format: `?event=<folderId>&upload=1`
- Event URL format: `?event=<folderId>` (gallery mode with live poll + curation bar for host)
- All event metadata stored in `localStorage['darkroom_events']` — no backend needed

---

## Milestone 14 — Live Event Experience ✅

> **Goal**: Real-time photo updates, live slideshow, stats display wall.
> **Status**: Complete
> **Completed**: 2026-02-27

### Tasks

| # | Task | Status |
|---|------|--------|
| 14.1 | Background polling every 30s in event mode (`setInterval` + visibility guard) | ✅ |
| 14.2 | New card injection (prepend with `.card-new` glow animation, no full re-render) | ✅ |
| 14.3 | Toast notification for new arrivals | ✅ |
| 14.4 | Manual refresh button in toolbar | ✅ |
| 14.5 | Poll interval selector (15s / 30s / 60s) | ✅ |
| 14.6 | Live slideshow toggle (`#ss-live-btn`) — new media auto-added to playlist | ✅ |
| 14.7 | Stats display page (`?event=<id>&display=stats`) — giant animated counter + QR | ✅ |
| 14.8 | Counter tick animation (requestAnimationFrame ease-in-out) | ✅ |

### Notes
- `startPolling(folderId)` / `stopPolling()` manage `setInterval` + visibility listener
- `injectNewCards()` diffs by ID set — only fetches/renders truly new files
- Stats display page polls every 15s independently; counter animates when count changes
- LIVE badge on slideshow overlay button pulses red when live mode active

---

## Milestone 15 — Post-Event Delivery & Sharing ✅

> **Goal**: Host curation, guest-view URL, contributor attribution, thank-you page.
> **Status**: Complete
> **Completed**: 2026-02-27

### Tasks

| # | Task | Status |
|---|------|--------|
| 15.1 | Hide/unhide photos (host-only, stored in `localStorage['darkroom_curation']`) | ✅ |
| 15.2 | Feature/unfeature photos (star badge, stored in `featuredFiles` array) | ✅ |
| 15.3 | Curation bar (sticky below toolbar in host event mode) | ✅ |
| 15.4 | Guest view URL (`?event=<id>&view=guest`) — read-only, hidden excluded | ✅ |
| 15.5 | Contributors panel (parsed from `file.description`, chip filter) | ✅ |
| 15.6 | Contributor filter in `applyFilter()` | ✅ |
| 15.7 | Thank you page (`?event=<id>&view=thanks`) — stats + 3×3 featured grid + CTAs | ✅ |
| 15.8 | QR modal tab switcher (Upload Link / Gallery Link) | ✅ |
| 15.9 | "Powered by Darkroom" footer on guest/thanks views | ✅ |

### Notes
- Curation stored per-event keyed by `folderId` in `LS_CURATION`
- Hidden files excluded in guest view via `applyFilter()` guard
- `file.description` field added to `apiFetch()` fields param (M15)
- Curation "click mode" (hide/feature) uses event capture on grid to intercept card clicks
- Featured badge (★) injected into card thumb HTML via `buildCardHtml()`
- Thanks page loads files independently (separate API call) to avoid needing full gallery render

---

## Notes & Decisions

- **API Key**: Bundled public API key for zero-friction public folder access. Private folder support planned for Milestone 7 via OAuth.
- **No build step**: Pure vanilla HTML/CSS/JS — works from file:// or any static host.
- **Modular structure**: `index.html` (markup) / `style.css` (styles) / `script.js` (logic) — easy to maintain and extend.
- **No framework**: Keeping it dependency-free maximizes portability and minimizes complexity for a UI this size.
- **localStorage strategy**: Favorites (M3), AI tags (M8), and user preferences stored locally — no backend needed for personal features.
