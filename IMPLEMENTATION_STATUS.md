# Darkroom — Implementation Status

> **Last Updated**: 2026-02-27
> **Current Milestone**: 6 ✅ Complete — Next planned: 7, 8, 9
> **Project**: Darkroom — Drive Media Manager
> **Vision**: Browse Your Media, Developed. Paste a Google Drive folder link → instant cinematic gallery.

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
| 7 | Private Folder OAuth | 6 | ⬜ 0% | — |
| 8 | AI Tagging (On-Device) | 7 | ⬜ 0% | — |
| 9 | Embeddable Gallery Widget | 5 | ⬜ 0% | — |
| 10 | Timeline View | 6 | ⬜ 0% | — |

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

## Milestone 7 — Private Folder OAuth ⬜

> **Goal**: Allow users to browse their own private Drive folders securely via Google OAuth — without making anything public.
> **Status**: Not Started

### Tasks

| # | Task | Status |
|---|------|--------|
| 7.1 | Google OAuth 2.0 implicit flow with Drive readonly scope | ⬜ |
| 7.2 | "Sign in with Google" button in header | ⬜ |
| 7.3 | Token storage and refresh handling | ⬜ |
| 7.4 | Switch API calls to use Bearer token instead of API key | ⬜ |
| 7.5 | "My Drive" folder tree sidebar for authenticated users | ⬜ |
| 7.6 | Sign-out and token revocation | ⬜ |

### Notes
- Use Google Identity Services (GIS) library — not the legacy gapi auth
- Scope: `https://www.googleapis.com/auth/drive.readonly`
- Public folders still work without sign-in (API key path remains)
- Private mode is opt-in — don't force auth on load

---

## Milestone 8 — AI Tagging (On-Device) ⬜

> **Goal**: Auto-label photos by scene, object, and content so users can search "beach", "birthday cake", "dog" — without uploading to any AI service.
> **Status**: Not Started

### Tasks

| # | Task | Status |
|---|------|--------|
| 8.1 | Integrate TensorFlow.js MobileNet for on-device image classification | ⬜ |
| 8.2 | Background tag generation after gallery loads | ⬜ |
| 8.3 | Tag display on card hover | ⬜ |
| 8.4 | Tag-based search integration | ⬜ |
| 8.5 | Tag index persistence in localStorage | ⬜ |
| 8.6 | Progress indicator while tagging batch | ⬜ |
| 8.7 | Opt-in toggle (AI tagging is off by default) | ⬜ |

### Notes
- Use TensorFlow.js + MobileNet v2 (runs entirely in browser, no server)
- Process at thumbnail resolution (400px) to keep it fast
- Cache tags in localStorage keyed by file ID to avoid re-processing
- Tag confidence threshold: 0.35 (balance recall vs. noise)

---

## Milestone 9 — Embeddable Gallery Widget ⬜

> **Goal**: Generate a `<iframe>` embed code so any blog, portfolio, or website can show a live Darkroom gallery inline.
> **Status**: Not Started

### Tasks

| # | Task | Status |
|---|------|--------|
| 9.1 | Embed mode URL param `?embed=1` for minimal iframe UI | ⬜ |
| 9.2 | Hide header in embed mode, show compact toolbar only | ⬜ |
| 9.3 | "Get embed code" button — generates `<iframe src="...">` snippet | ⬜ |
| 9.4 | Copy-to-clipboard with code preview modal | ⬜ |
| 9.5 | Postmessage API for parent page communication (optional) | ⬜ |

### Notes
- Embed mode should still support lightbox (opens within iframe)
- Configurable height via URL param `?embed=1&height=600`
- Embed code generator should include width/height HTML attributes

---

## Milestone 10 — Timeline View ⬜

> **Goal**: A vertical scrollable timeline of all media — a visual diary of memories organized chronologically.
> **Status**: Not Started

### Tasks

| # | Task | Status |
|---|------|--------|
| 10.1 | Timeline view toggle (alongside grid view) | ⬜ |
| 10.2 | Vertical scroll layout with date milestone markers | ⬜ |
| 10.3 | Year/month header anchors with smooth scroll jump | ⬜ |
| 10.4 | Mixed media rows (photos + videos in chronological strip) | ⬜ |
| 10.5 | "Jump to year" mini-map on the right edge | ⬜ |
| 10.6 | Print/export timeline as PDF (optional stretch goal) | ⬜ |

### Notes
- Timeline reads the same state as grid — same data, different render
- Date markers should show count of items in that period
- Mini-map: fixed right sidebar showing decade/year dots with scroll position indicator
- This feature makes Darkroom feel like a personal photo book, not just a file browser

---

## Notes & Decisions

- **API Key**: Bundled public API key for zero-friction public folder access. Private folder support planned for Milestone 7 via OAuth.
- **No build step**: Pure vanilla HTML/CSS/JS — works from file:// or any static host.
- **Modular structure**: `index.html` (markup) / `style.css` (styles) / `script.js` (logic) — easy to maintain and extend.
- **No framework**: Keeping it dependency-free maximizes portability and minimizes complexity for a UI this size.
- **localStorage strategy**: Favorites (M3), AI tags (M8), and user preferences stored locally — no backend needed for personal features.
