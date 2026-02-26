# Darkroom — Drive Media Manager

> **Your media, developed.**
> Paste a Google Drive folder link or ID to explore photos, videos, and files in a cinematic gallery — instant, beautiful, organized.

---

## The Problem

People have thousands of photos and videos stored in Google Drive with no good way to browse, relive, or enjoy them. Google Drive's native UI is a file manager, not a media experience. Google Photos is separate and doesn't respect Drive folder structure. The result: memories rot in cloud storage, unseen and unenjoyable.

**Darkroom fixes that.** Paste a link → instant beautiful gallery. No upload, no install, no account required.

---

## Who It's For

| User | Scenario |
|------|----------|
| Families | Revisit vacation photos organized by year in Drive |
| Photographers | Share client galleries via a simple link |
| Event teams | Review event footage together, no Drive account needed |
| Anyone | Show grandparents photos without teaching them Google Drive |

---

## How It Works

```
01  Share your Google Drive folder publicly
        (Anyone with the link → Viewer)
02  Paste the folder URL or folder ID into Darkroom
03  Browse your media in a cinematic gallery
```

No sign-in. No upload. No install. Your media is already in Drive — Darkroom just makes it beautiful where it lives.

---

## Features (MVP)

- **Zero-auth public folder browsing** — paste any public Drive folder link or ID and go
- **Cinematic grid gallery** — responsive masonry/grid with thumbnail-first loading
- **Lightbox viewer** — full-res images, inline video playback (Google Drive preview embed)
- **Arrow / swipe navigation** — keyboard arrows, swipe gestures on mobile
- **Subfolder drill-down** — breadcrumb navigation into nested folders
- **Search & filter** — real-time filename search + filter by type (images, videos, folders, docs)
- **Sort controls** — name A-Z, date newest/oldest, size largest/smallest
- **Stats bar** — instant count of images, videos, folders, total size
- **Skeleton loading** — shimmer cards while content fetches
- **Pagination** — auto-loads up to 200 items, "Load more" for larger folders
- **URL param boot** — `?folder=<id>` deep-links directly into a gallery
- **Mobile responsive** — fully functional on phones and tablets
- **Film grain aesthetic** — cinematic dark UI with warm accent tones

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| HTML | Semantic HTML5 |
| CSS | Vanilla CSS with custom properties (design tokens) |
| JS | Vanilla JavaScript (ES2022, IIFE, no framework) |
| API | Google Drive API v3 (files.list, files.get) |
| Fonts | Google Fonts — Playfair Display, Syne, JetBrains Mono |
| Hosting | Static file — works on any CDN, GitHub Pages, Netlify |

---

## Project Structure

```
darkroom/
├── index.html          # App shell — markup only, no inline styles or scripts
├── style.css           # All styles — tokens, layout, components, animations
├── script.js           # All logic — API, state, rendering, events
├── README.md           # This file
└── IMPLEMENTATION_STATUS.md  # Feature roadmap and progress tracking
```

---

## Setup & Usage

### Local Development

No build step required. Open `index.html` directly in a browser:

```bash
open index.html
# or serve with any static server:
npx serve .
python3 -m http.server 8080
```

### Google Drive API Key

The project uses a bundled API key scoped to Drive read-only for public files. To use your own key:

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Create a project → Enable **Google Drive API**
3. Create an **API Key** → restrict to Drive API
4. Replace `API_KEY` at the top of `script.js`

### Sharing a Folder

For Darkroom to access a folder, it must be publicly shared:

1. Right-click the folder in Google Drive
2. **Share** → **Change to anyone with the link**
3. Set permission to **Viewer**
4. Copy the link and paste it into Darkroom

---

## Roadmap

See [IMPLEMENTATION_STATUS.md](./IMPLEMENTATION_STATUS.md) for the full feature roadmap across 10 planned milestones.

### Phase 1 — Core Experience (MVP)
- Cinematic grid gallery with Drive API integration ✅
- Lightbox with full-res view + video playback ✅
- Search, filter, sort ✅
- Subfolder navigation ✅
- Mobile responsive ✅

### Phase 2 — Genuinely Useful
- Slideshow mode with Ken Burns transitions
- Favorites / shortlist (local storage)
- Multi-file download as ZIP
- Date-based auto-grouping

### Phase 3 — Differentiate
- AI tagging (on-device, opt-in) — search by "beach", "birthday"
- Timeline view — vertical scrollable visual diary
- Shared collections — multiple Drive folders in one gallery
- Embeddable gallery widget

### Phase 4 — Monetization
- Free tier: public folders, up to 500 files
- Pro ($5/mo): private folders, AI tagging, custom branding, unlimited files
- Creator ($12/mo): client delivery, password protection, download tracking, custom domains

---

## Design System

Darkroom uses a warm dark palette inspired by analog darkroom aesthetics:

| Token | Value | Use |
|-------|-------|-----|
| `--bg` | `#0c0a09` | Page background |
| `--accent` | `#ff6b35` | Primary actions, highlights |
| `--amber` | `#f4a623` | Folder tints |
| `--txt` | `#ede4db` | Body text |
| `--ff-disp` | Playfair Display | Headlines |
| `--ff-ui` | Syne | UI labels |
| `--ff-mono` | JetBrains Mono | Metadata, code |

---

## Why Not Just Use Google Drive / Photos?

| Tool | Why it falls short |
|------|--------------------|
| Google Drive UI | Ugly grid, no lightbox, no slideshow, no aesthetic |
| Google Photos | Separate from Drive, doesn't respect folder structure |
| Imgur / Flickr | Requires re-uploading everything |
| SmugMug / Pixieset | Expensive, complex, overkill for casual use |
| **Darkroom** | Paste a link → instant beautiful gallery. Zero friction. |

**The killer insight:** your media is already in Drive. Don't make people move it — make it beautiful where it lives.

---

## License

MIT — use it, fork it, build on it.
