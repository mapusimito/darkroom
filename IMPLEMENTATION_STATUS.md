# Darkroom — Implementation Status

> **Last Updated**: 2026-02-26
> **Current Milestone**: 1 ✅ Complete — Next planned: 2, 3, 4
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
| 2 | Slideshow Mode | 5 | ⬜ 0% | — |
| 3 | Favorites & Shortlist | 4 | ⬜ 0% | — |
| 4 | Multi-file ZIP Download | 4 | ⬜ 0% | — |
| 5 | Date Auto-Grouping | 5 | ⬜ 0% | — |
| 6 | URL Sharing & Deep Links | 4 | ⬜ 0% | — |
| 7 | Private Folder OAuth | 6 | ⬜ 0% | — |
| 8 | AI Tagging (On-Device) | 7 | ⬜ 0% | — |
| 9 | Embeddable Gallery Widget | 5 | ⬜ 0% | — |
| 10 | Timeline View | 6 | ⬜ 0% | — |

---

## Milestone 1 — MVP Core Gallery ✅

> **Goal**: Paste a public Drive folder link → browse a beautiful cinematic gallery.
> **Status**: Complete
> **Completed**: 2026-02-26

### Tasks

| # | Task | Status |
|---|------|--------|
| 1.1 | Google Drive API v3 integration (files.list, files.get) | ✅ |
| 1.2 | Responsive masonry/grid with skeleton loading | ✅ |
| 1.3 | Lightbox viewer — full-res images + video iframe embed | ✅ |
| 1.4 | Search, filter by type, sort controls | ✅ |
| 1.5 | Subfolder drill-down with breadcrumb navigation | ✅ |
| 1.6 | Mobile responsive + touch swipe in lightbox | ✅ |

### Notes
- Modularized into `index.html` / `style.css` / `script.js`
- API key bundled for public read-only access
- Auto-loads up to 200 items, pagination for larger folders
- URL param `?folder=<id>` for deep linking

---

## Milestone 2 — Slideshow Mode ⬜

> **Goal**: Auto-advancing full-screen slideshow with cinematic transitions — great for TV casting or family gatherings.
> **Status**: Not Started

### Tasks

| # | Task | Status |
|---|------|--------|
| 2.1 | Slideshow button in toolbar | ⬜ |
| 2.2 | Auto-advance timer with configurable interval (3s default) | ⬜ |
| 2.3 | Ken Burns pan & zoom CSS animation on each image | ⬜ |
| 2.4 | Full-screen API integration (Fullscreen API) | ⬜ |
| 2.5 | Pause/resume on click + keyboard spacebar | ⬜ |

### Notes
- Ken Burns effect: slow scale(1.0→1.08) + translate on each image, 5s duration
- Should respect current filter — only show filtered media in slideshow
- Show progress bar at bottom of screen during slideshow

---

## Milestone 3 — Favorites & Shortlist ⬜

> **Goal**: Let viewers star items without editing the Drive folder — stored locally via localStorage.
> **Status**: Not Started

### Tasks

| # | Task | Status |
|---|------|--------|
| 3.1 | Star/heart toggle button on each card | ⬜ |
| 3.2 | LocalStorage persistence across sessions | ⬜ |
| 3.3 | "Favorites" filter tab in toolbar | ⬜ |
| 3.4 | Favorites count badge in header | ⬜ |

### Notes
- Key by Drive file ID so favorites survive folder re-loads
- Favorites are per-browser — no server or account needed
- Could later export favorites list as a shareable URL

---

## Milestone 4 — Multi-file ZIP Download ⬜

> **Goal**: Let users select multiple files and download them as a ZIP — without leaving the app.
> **Status**: Not Started

### Tasks

| # | Task | Status |
|---|------|--------|
| 4.1 | Multi-select mode toggle (checkbox overlay on cards) | ⬜ |
| 4.2 | Selection state management and count badge | ⬜ |
| 4.3 | Client-side ZIP packaging with JSZip | ⬜ |
| 4.4 | Progress indicator during ZIP generation | ⬜ |

### Notes
- Use JSZip (browser library, no server needed) for ZIP generation
- Drive webContentLink used for direct file download
- Warn user if >50 files selected (memory/performance limits)
- "Select all filtered" shortcut needed

---

## Milestone 5 — Date Auto-Grouping ⬜

> **Goal**: Automatically cluster media by date (year → month → day) so people can navigate memories chronologically.
> **Status**: Not Started

### Tasks

| # | Task | Status |
|---|------|--------|
| 5.1 | Parse `modifiedTime` into year/month groups | ⬜ |
| 5.2 | Group header rows in grid (sticky date labels) | ⬜ |
| 5.3 | "Timeline" sort mode option | ⬜ |
| 5.4 | Collapse/expand group sections | ⬜ |
| 5.5 | Jump-to-date quick nav sidebar | ⬜ |

### Notes
- Use `modifiedTime` as proxy for capture date (Drive doesn't surface EXIF dates via API without file download)
- Group headers should be sticky while scrolling within group
- Timeline mode should be triggered separately from sort order

---

## Milestone 6 — URL Sharing & Deep Links ⬜

> **Goal**: Every gallery state (folder, filters, open lightbox item) should be shareable as a URL.
> **Status**: Not Started

### Tasks

| # | Task | Status |
|---|------|--------|
| 6.1 | Sync folder ID to URL param `?folder=<id>` on navigate | ⬜ |
| 6.2 | Sync filter/sort state to URL params | ⬜ |
| 6.3 | Sync open lightbox item to URL param `?item=<id>` | ⬜ |
| 6.4 | "Copy gallery link" button in header | ⬜ |

### Notes
- Use `history.replaceState` (not pushState) to avoid polluting back stack on filter changes
- Use `history.pushState` on folder navigation (subfolder drill-down)
- Gallery link button should copy the current URL to clipboard with a toast confirmation

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
