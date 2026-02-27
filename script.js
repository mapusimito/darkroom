(() => {
  'use strict';

  /* ─────────────────────────────────────────
     CONFIG
  ───────────────────────────────────────── */
  const API_BASE   = 'https://www.googleapis.com/drive/v3/files';
  const PG_SIZE    = 100;
  const LS_KEY     = 'darkroom_api_key';
  const LS_FAVS    = 'darkroom_favs';

  function getApiKey() {
    // Priority: config.js (gitignored) → localStorage (user-entered via settings)
    return (typeof DARKROOM_CONFIG !== 'undefined' && DARKROOM_CONFIG.apiKey &&
            DARKROOM_CONFIG.apiKey !== 'YOUR_GOOGLE_DRIVE_API_KEY_HERE'
              ? DARKROOM_CONFIG.apiKey : null)
        || localStorage.getItem(LS_KEY)
        || '';
  }

  function saveApiKey(key) {
    localStorage.setItem(LS_KEY, key.trim());
  }

  function hasApiKey() {
    return getApiKey().length > 10;
  }

  /* ─────────────────────────────────────────
     FAVORITES (M3)
  ───────────────────────────────────────── */
  let _favs = null; // in-memory cache

  function loadFavs() {
    if (_favs) return _favs;
    try {
      const raw = localStorage.getItem(LS_FAVS);
      _favs = new Set(raw ? JSON.parse(raw) : []);
    } catch { _favs = new Set(); }
    return _favs;
  }

  function saveFavs() {
    localStorage.setItem(LS_FAVS, JSON.stringify([...loadFavs()]));
  }

  function isFav(id) { return loadFavs().has(id); }

  function toggleFav(id, btn) {
    const favs = loadFavs();
    if (favs.has(id)) favs.delete(id);
    else              favs.add(id);
    saveFavs();
    const active = favs.has(id);
    if (btn) {
      btn.classList.toggle('faved', active);
      btn.setAttribute('aria-label', active ? 'Remove from favorites' : 'Add to favorites');
    }
    updateFavBadge();
    if (S.filter === 'favorites') applyFilter(); // refresh grid if in favs view
  }

  function updateFavBadge() {
    const n = loadFavs().size;
    if (!D.favHdrBtn) return;
    D.favHdrBtn.classList.toggle('hidden', n === 0);
    D.favCount.textContent = n;
  }

  /* ─────────────────────────────────────────
     STATE
  ───────────────────────────────────────── */
  const S = {
    stack:       [],   // [{id, name}]
    files:       [],   // all fetched files for current folder
    filtered:    [],   // after search/filter/sort
    media:       [],   // only image+video (lightbox)
    pageToken:   null,
    loading:     false,
    search:      '',
    filter:      'all',
    sort:        'name-asc',
    lbIdx:       -1,
    // Select mode state (M4)
    selectMode:  false,
    selected:    new Set(), // file IDs
    // Slideshow state
    slideshowActive: false,
    slideshowIdx:    0,
    slideshowTimer:  null,
    slideshowPaused: false,
    // Date grouping (M5)
    collapsedGroups: new Set(),
  };

  /* ─────────────────────────────────────────
     DOM
  ───────────────────────────────────────── */
  const el = id => document.getElementById(id);
  const D = {
    form:        el('folder-form'),
    input:       el('folder-input'),
    landing:     el('landing'),
    gallery:     el('gallery-container'),
    grid:        el('grid'),
    breadcrumb:  el('breadcrumb'),
    search:      el('search-input'),
    sort:        el('sort-sel'),
    count:       el('file-count'),
    stats:       el('stats-bar'),
    loadWrap:    el('load-more-wrap'),
    loadBtn:     el('load-more-btn'),
    lb:          el('lightbox'),
    lbX:         el('lb-x'),
    lbPrev:      el('lb-prev'),
    lbNext:      el('lb-next'),
    lbBody:      el('lb-body'),
    lbName:      el('lb-name'),
    lbCtr:       el('lb-ctr'),
    lbOpen:      el('lb-open'),
    // selection bar (M4)
    selModeBtn:    el('select-mode-btn'),
    selBar:        el('sel-bar'),
    selCount:      el('sel-count'),
    selAll:        el('sel-all'),
    selNone:       el('sel-none'),
    selProgressWrap: el('sel-progress-wrap'),
    selProgressBar:  el('sel-progress-bar'),
    selProgressLbl:  el('sel-progress-label'),
    selDownload:   el('sel-download'),
    selDownloadLbl:el('sel-download-label'),
    selExit:       el('sel-exit'),
    // favorites
    favHdrBtn:   el('fav-hdr-btn'),
    favCount:    el('fav-count'),
    // settings
    settingsBtn: el('settings-btn'),
    settingsMod: el('settings-modal'),
    apiKeyInput: el('api-key-input'),
    apiKeySave:  el('api-key-save'),
    apiKeyClear: el('api-key-clear'),
    apiKeyClose: el('settings-close'),
    apiKeyDot:   el('api-key-dot'),
    // date nav (M5)
    dateNav:     el('date-nav'),
    // slideshow
    ssBtn:       el('slideshow-btn'),
    ssOverlay:   el('slideshow'),
    ssBody:      el('ss-body'),
    ssName:      el('ss-name'),
    ssCtr:       el('ss-ctr'),
    ssProgress:  el('ss-progress'),
    ssPlayBtn:   el('ss-play-btn'),
    ssPlayIcon:  el('ss-play-icon'),
    ssFsBtn:     el('ss-fs-btn'),
    ssClose:     el('ss-close'),
  };

  /* ─────────────────────────────────────────
     HELPERS
  ───────────────────────────────────────── */
  function extractId(raw) {
    raw = raw.trim();
    const m = raw.match(/\/folders\/([a-zA-Z0-9_-]+)/);
    if (m) return m[1];
    if (/^[a-zA-Z0-9_-]{15,}$/.test(raw)) return raw;
    return null;
  }

  function fmtSize(b) {
    if (!b) return '—';
    b = +b;
    if (b < 1024)             return b + ' B';
    if (b < 1024**2)          return (b/1024).toFixed(1) + ' KB';
    if (b < 1024**3)          return (b/1024**2).toFixed(1) + ' MB';
    return (b/1024**3).toFixed(2) + ' GB';
  }

  function fmtDate(s) {
    if (!s) return '—';
    const d = new Date(s), now = new Date();
    const diff = (now - d) / 1000;
    if (diff < 60)        return 'just now';
    if (diff < 3600)      return Math.floor(diff/60) + 'm ago';
    if (diff < 86400)     return Math.floor(diff/3600) + 'h ago';
    if (diff < 86400*7)   return Math.floor(diff/86400) + 'd ago';
    return d.toLocaleDateString('en-US', { month:'short', day:'numeric', year:'numeric' });
  }

  function fileType(mime) {
    if (!mime) return 'other';
    if (mime === 'application/vnd.google-apps.folder') return 'folder';
    if (mime.startsWith('image/'))  return 'image';
    if (mime.startsWith('video/') || mime === 'application/vnd.google-apps.video') return 'video';
    if (mime.startsWith('audio/')) return 'audio';
    if (mime === 'application/pdf') return 'pdf';
    if (mime.includes('document') || mime.includes('spreadsheet') ||
        mime.includes('presentation') || mime.includes('vnd.google-apps')) return 'doc';
    return 'other';
  }

  const ICONS = {
    folder: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>`,
    image:  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>`,
    video:  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"><polygon points="23 7 16 12 23 17 23 7"/><rect x="1" y="5" width="15" height="14" rx="2"/></svg>`,
    audio:  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>`,
    pdf:    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>`,
    doc:    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><line x1="10" y1="9" x2="8" y2="9"/></svg>`,
    other:  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"><path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><polyline points="13 2 13 9 20 9"/></svg>`,
  };

  function typeIcon(t)  { return ICONS[t] || ICONS.other; }
  function badgeCls(t)  { return { image:'b-img', video:'b-vid', folder:'b-fold', doc:'b-doc', pdf:'b-pdf', audio:'b-aud', other:'b-oth' }[t] || 'b-oth'; }
  function badgeLbl(t, mime) {
    if (t==='image')  return 'IMG';
    if (t==='video')  return 'VID';
    if (t==='folder') return 'DIR';
    if (t==='pdf')    return 'PDF';
    if (t==='audio')  return 'AUD';
    if (mime?.includes('spreadsheet'))  return 'XLS';
    if (mime?.includes('document'))     return 'DOC';
    if (mime?.includes('presentation')) return 'PPT';
    return 'FILE';
  }

  function thumbUrl(file, t) {
    if (t !== 'image' && t !== 'video') return null;
    if (file.thumbnailLink) return file.thumbnailLink.replace(/=s\d+$/, '=w400');
    return `https://drive.google.com/thumbnail?id=${file.id}&sz=w400`;
  }

  function esc(s) {
    const d = document.createElement('div');
    d.textContent = String(s ?? '');
    return d.innerHTML;
  }

  /* ─────────────────────────────────────────
     API
  ───────────────────────────────────────── */
  async function apiFetch(folderId, pageToken) {
    const p = new URLSearchParams({
      key: getApiKey(),
      q: `'${folderId}' in parents and trashed=false`,
      fields: 'files(id,name,mimeType,size,modifiedTime,thumbnailLink,webViewLink,webContentLink),nextPageToken',
      pageSize: PG_SIZE,
      orderBy: 'folder,name',
    });
    if (pageToken) p.set('pageToken', pageToken);
    const r = await fetch(`${API_BASE}?${p}`);
    if (!r.ok) {
      const e = await r.json().catch(()=>({}));
      throw new Error(e?.error?.message || `HTTP ${r.status}`);
    }
    return r.json();
  }

  async function apiFolderName(id) {
    const p = new URLSearchParams({ key: getApiKey(), fields: 'name' });
    const r = await fetch(`${API_BASE}/${id}?${p}`);
    if (!r.ok) return 'Folder';
    return (await r.json()).name || 'Folder';
  }

  /* ─────────────────────────────────────────
     BROWSE
  ───────────────────────────────────────── */
  async function browse(folderId, folderName) {
    if (S.loading) return;
    S.loading = true; S.files = []; S.pageToken = null;
    S.collapsedGroups.clear();

    D.landing.classList.add('hidden');
    D.gallery.classList.remove('hidden');
    D.search.value = ''; S.search = ''; S.filter = 'all';
    document.querySelectorAll('.ftab').forEach(t => t.classList.toggle('active', t.dataset.filter==='all'));
    D.loadWrap.classList.add('hidden'); D.stats.innerHTML = '';
    showSkeletons(12);

    try {
      if (!folderName) folderName = await apiFolderName(folderId);

      const existing = S.stack.findIndex(f => f.id === folderId);
      if (existing >= 0) S.stack = S.stack.slice(0, existing + 1);
      else               S.stack.push({ id: folderId, name: folderName });
      renderCrumb();

      let data = await apiFetch(folderId);
      S.files = data.files || [];
      S.pageToken = data.nextPageToken || null;

      // Auto-load up to ~200 items
      while (S.pageToken && S.files.length < 200) {
        data = await apiFetch(folderId, S.pageToken);
        S.files.push(...(data.files || []));
        S.pageToken = data.nextPageToken || null;
      }

      applyFilter();
      renderStats();
      if (S.pageToken) D.loadWrap.classList.remove('hidden');

    } catch (err) {
      showError(err.message);
    } finally {
      S.loading = false;
    }
  }

  async function loadMore() {
    if (!S.pageToken || S.loading) return;
    S.loading = true;
    D.loadBtn.textContent = 'Loading…'; D.loadBtn.disabled = true;
    const id = S.stack.at(-1)?.id;
    if (!id) {
      S.loading = false;
      D.loadBtn.textContent = 'Load more files'; D.loadBtn.disabled = false;
      return;
    }
    try {
      const data = await apiFetch(id, S.pageToken);
      S.files.push(...(data.files || []));
      S.pageToken = data.nextPageToken || null;
      applyFilter(); renderStats();
      if (!S.pageToken) D.loadWrap.classList.add('hidden');
    } catch {}
    finally {
      S.loading = false;
      D.loadBtn.textContent = 'Load more files'; D.loadBtn.disabled = false;
    }
  }

  /* ─────────────────────────────────────────
     BREADCRUMB
  ───────────────────────────────────────── */
  function renderCrumb() {
    D.breadcrumb.innerHTML = S.stack.map((f, i) => {
      const last = i === S.stack.length - 1;
      return `${i > 0 ? '<span class="bc-sep">›</span>' : ''}
        <span class="bc-item ${last ? 'active' : ''}"
              data-id="${esc(f.id)}" data-name="${esc(f.name)}"
              ${last ? '' : 'tabindex="0" role="button"'}>
          ${esc(f.name)}
        </span>`;
    }).join('');
    D.breadcrumb.querySelectorAll('.bc-item:not(.active)').forEach(el => {
      el.onclick  = () => browse(el.dataset.id, el.dataset.name);
      el.onkeydown = e => e.key === 'Enter' && browse(el.dataset.id, el.dataset.name);
    });
  }

  /* ─────────────────────────────────────────
     STATS
  ───────────────────────────────────────── */
  function renderStats() {
    const f = S.files;
    const img  = f.filter(x => fileType(x.mimeType) === 'image').length;
    const vid  = f.filter(x => fileType(x.mimeType) === 'video').length;
    const flds = f.filter(x => fileType(x.mimeType) === 'folder').length;
    const tot  = f.reduce((s,x) => s + (+x.size||0), 0);
    D.stats.innerHTML = [
      [f.length,       'Total files',  'total'],
      [img,            'Images',       'images'],
      [vid,            'Videos',       'videos'],
      [flds,           'Folders',      'folders'],
      ...(tot > 0 ? [[fmtSize(tot), 'Total size', 'size']] : []),
    ].map(([v,l,t]) => `<div class="stat-item" data-type="${t}"><div class="stat-val">${v}</div><div class="stat-lbl">${l}</div></div>`).join('');
  }

  /* ─────────────────────────────────────────
     FILTER / SORT
  ───────────────────────────────────────── */
  function applyFilter() {
    let list = [...S.files];
    if (S.filter === 'favorites')   list = list.filter(f => isFav(f.id));
    else if (S.filter !== 'all')    list = list.filter(f => fileType(f.mimeType) === S.filter);
    if (S.search) {
      const q = S.search.toLowerCase();
      list = list.filter(f => f.name.toLowerCase().includes(q));
    }
    if (S.sort === 'timeline') {
      // Sort newest-first for grouping; renderGrid will cluster by month
      list.sort((a, b) => new Date(b.modifiedTime) - new Date(a.modifiedTime));
    } else {
      const [key, dir] = S.sort.split('-');
      list.sort((a, b) => {
        let va, vb;
        if (key === 'name') { va = a.name.toLowerCase(); vb = b.name.toLowerCase(); }
        else if (key === 'date') { va = new Date(a.modifiedTime); vb = new Date(b.modifiedTime); }
        else { va = +a.size||0; vb = +b.size||0; }
        if (va < vb) return dir==='asc' ? -1 : 1;
        if (va > vb) return dir==='asc' ?  1 :-1;
        return 0;
      });
    }
    S.filtered = list;
    S.media = list.filter(f => { const t = fileType(f.mimeType); return t==='image'||t==='video'; });
    renderGrid();
    D.count.textContent = list.length === 0 ? 'No files' : `${list.length} file${list.length!==1?'s':''}`;
    // Show/hide slideshow button based on whether media is available
    D.ssBtn.classList.toggle('hidden', S.media.length === 0);
  }

  /* ─────────────────────────────────────────
     GRID RENDER
  ───────────────────────────────────────── */
  function showSkeletons(n) {
    D.grid.classList.remove('grid-timeline');
    D.grid.innerHTML = Array.from({length:n}, () =>
      `<div class="skel"><div class="skel-thumb"></div></div>`
    ).join('');
  }

  function showError(msg) {
    D.grid.innerHTML = `<div class="state-msg" style="grid-column:1/-1">
      <div class="icon">⚠</div>
      <h3>Could not load folder</h3>
      <p>${esc(msg)}<br><br>
        Make sure the folder is <strong>publicly shared</strong>
        ("Anyone with the link can view") and the ID is correct.
      </p>
    </div>`;
  }

  /* ─────────────────────────────────────────
     DATE GROUPING (M5)
  ───────────────────────────────────────── */
  let _groupObserver = null;

  // Cluster a flat list of files into [{key, label, shortLabel, files[]}] sorted newest first
  function groupFiles(list) {
    const map = new Map();
    for (const f of list) {
      if (!f.modifiedTime) continue;
      const d   = new Date(f.modifiedTime);
      const key = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;
      if (!map.has(key)) {
        map.set(key, {
          key,
          label:      d.toLocaleDateString('en-US', { month: 'long',  year: 'numeric' }),
          shortLabel: d.toLocaleDateString('en-US', { month: 'short', year: 'numeric' }),
          files: [],
        });
      }
      map.get(key).files.push(f);
    }
    return [...map.values()].sort((a, b) => b.key.localeCompare(a.key)); // newest first
  }

  // Build HTML for a single card (shared by flat and grouped renderers)
  function buildCardHtml(file, idx, gkey) {
    const t     = fileType(file.mimeType);
    const thumb = thumbUrl(file, t);
    const bc    = badgeCls(t);
    const bl    = badgeLbl(t, file.mimeType);
    const midx  = S.media.findIndex(f => f.id === file.id);
    const faved    = isFav(file.id);
    const selected = S.selectMode && S.selected.has(file.id);
    const hidden   = gkey && S.collapsedGroups.has(gkey);

    let thumbHtml;
    if (t === 'folder') {
      thumbHtml = `<div class="thumb-icon" style="color:var(--b-fold)">${typeIcon('folder')}<span>Directory</span></div>`;
    } else if (thumb) {
      thumbHtml = `
        <img src="${esc(thumb)}" alt="${esc(file.name)}" loading="lazy"
             onerror="this.style.display='none';this.nextElementSibling.style.display='flex'">
        <div class="thumb-icon" style="display:none">${typeIcon(t)}</div>`;
    } else {
      thumbHtml = `<div class="thumb-icon">${typeIcon(t)}</div>`;
    }

    return `
      <div class="card ${t==='folder'?'card-folder':''} ${selected?'selected':''} ${hidden?'group-hidden':''}"
           role="listitem" tabindex="0"
           data-id="${esc(file.id)}" data-type="${t}"
           data-midx="${midx}" data-fname="${t==='folder'?esc(file.name):''}"
           ${gkey ? `data-gkey="${esc(gkey)}"` : ''}
           style="animation-delay:${Math.min(idx*25,400)}ms">
        <div class="card-thumb">
          ${thumbHtml}
          <span class="badge ${bc}">${bl}</span>
          ${t !== 'folder' ? `
          <button class="card-check" data-cid="${esc(file.id)}" aria-label="Select ${esc(file.name)}">
            <svg xmlns="http://www.w3.org/2000/svg" width="11" height="11" viewBox="0 0 24 24"
                 fill="none" stroke="white" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">
              <polyline points="20 6 9 17 4 12"/>
            </svg>
          </button>` : ''}
          <button class="fav-btn ${faved ? 'faved' : ''}"
                  data-fid="${esc(file.id)}"
                  aria-label="${faved ? 'Remove from favorites' : 'Add to favorites'}"
                  title="${faved ? 'Remove from favorites' : 'Add to favorites'}">
            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24"
                 stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/>
            </svg>
          </button>
          ${t==='video' ? `<div class="play-overlay">
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor">
              <circle cx="12" cy="12" r="10" opacity=".25"/>
              <polygon points="10 8 16 12 10 16 10 8"/>
            </svg></div>` : ''}
        </div>
        <div class="card-body">
          <div class="card-name" title="${esc(file.name)}">${esc(file.name)}</div>
          <div class="card-meta">
            <span class="card-date">${fmtDate(file.modifiedTime)}</span>
            <span class="card-size">${fmtSize(file.size)}</span>
          </div>
          <div class="card-actions">
            <a class="act-btn"
               href="${esc(file.webViewLink||'#')}"
               target="_blank" rel="noopener noreferrer"
               onclick="event.stopPropagation()">
              <svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>
              Open
            </a>
            ${file.webContentLink ? `
            <a class="act-btn"
               href="${esc(file.webContentLink)}"
               target="_blank" rel="noopener noreferrer"
               onclick="event.stopPropagation()">
              <svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
              Save
            </a>` : ''}
          </div>
        </div>
      </div>`;
  }

  // Wire click/keyboard/fav/select events on all .card elements in the grid
  function wireCardEvents() {
    D.grid.querySelectorAll('.card').forEach(card => {
      const { id, type, midx, fname } = card.dataset;
      const activate = () => {
        if (S.selectMode) {
          if (type !== 'folder') toggleSelect(id);
          return;
        }
        if (type === 'folder')              browse(id, fname);
        else if (type === 'image' || type === 'video') openLb(+midx);
        else {
          const f = S.files.find(x => x.id === id);
          if (f?.webViewLink) window.open(f.webViewLink, '_blank', 'noopener,noreferrer');
        }
      };
      card.addEventListener('click', activate);
      card.addEventListener('keydown', e => (e.key==='Enter'||e.key===' ') && (e.preventDefault(), activate()));

      const checkBtn = card.querySelector('.card-check');
      if (checkBtn) {
        checkBtn.addEventListener('click', e => {
          e.stopPropagation();
          toggleSelect(checkBtn.dataset.cid);
        });
      }

      const favBtn = card.querySelector('.fav-btn');
      if (favBtn) {
        favBtn.addEventListener('click', e => {
          e.stopPropagation();
          toggleFav(favBtn.dataset.fid, favBtn);
        });
      }
    });
  }

  // Toggle a group's collapsed state without re-rendering the whole grid
  function toggleGroup(key) {
    const nowCollapsed = !S.collapsedGroups.has(key);
    if (nowCollapsed) S.collapsedGroups.add(key);
    else              S.collapsedGroups.delete(key);

    const hdr = D.grid.querySelector(`.date-group-hdr[data-gkey="${key}"]`);
    if (hdr) {
      hdr.classList.toggle('collapsed', nowCollapsed);
      hdr.setAttribute('aria-expanded', nowCollapsed ? 'false' : 'true');
    }
    D.grid.querySelectorAll(`.card[data-gkey="${key}"]`).forEach(card => {
      card.classList.toggle('group-hidden', nowCollapsed);
    });
  }

  // Build the fixed right-side date navigation sidebar
  function buildDateNav(groups) {
    if (!D.dateNav) return;
    if (_groupObserver) { _groupObserver.disconnect(); _groupObserver = null; }
    if (!groups.length) { D.dateNav.classList.add('hidden'); return; }

    D.dateNav.innerHTML = groups.map(g =>
      `<div class="date-nav-item" data-gkey="${esc(g.key)}" title="${esc(g.label)}">
        <span class="date-nav-dot"></span>
        <span>${esc(g.shortLabel)}</span>
      </div>`
    ).join('');
    D.dateNav.classList.remove('hidden');

    // Highlight the nav item whose group header is nearest the top of the viewport
    _groupObserver = new IntersectionObserver(entries => {
      for (const entry of entries) {
        const key     = entry.target.dataset.gkey;
        const navItem = D.dateNav.querySelector(`.date-nav-item[data-gkey="${key}"]`);
        if (navItem) navItem.classList.toggle('active', entry.isIntersecting);
      }
    }, { rootMargin: '-62px 0px -40% 0px', threshold: 0 });

    D.grid.querySelectorAll('.date-group-hdr').forEach(hdr => _groupObserver.observe(hdr));

    // Smooth-scroll to group on click
    D.dateNav.querySelectorAll('.date-nav-item').forEach(item => {
      item.addEventListener('click', () => {
        const hdr = document.getElementById(`group-${item.dataset.gkey}`);
        if (hdr) hdr.scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
    });
  }

  // Render the grid in timeline (grouped by month) mode
  function renderGridGrouped() {
    D.grid.classList.add('grid-timeline');
    const groups = groupFiles(S.filtered);
    if (!groups.length) {
      D.grid.innerHTML = `<div class="state-msg" style="grid-column:1/-1">
        <div class="icon">◻</div>
        <h3>Empty folder</h3>
        <p>This folder contains no files.</p>
      </div>`;
      buildDateNav([]);
      return;
    }

    let html = '';
    let idx  = 0;
    for (const grp of groups) {
      const collapsed = S.collapsedGroups.has(grp.key);
      const year = grp.key.split('-')[0];
      html += `<div class="date-group-hdr ${collapsed ? 'collapsed' : ''}"
                    data-gkey="${esc(grp.key)}"
                    data-year="${esc(year)}"
                    id="group-${esc(grp.key)}"
                    role="button" tabindex="0"
                    aria-expanded="${collapsed ? 'false' : 'true'}">
        <span class="date-group-label">${esc(grp.label)}</span>
        <span class="date-group-count">${grp.files.length} item${grp.files.length !== 1 ? 's' : ''}</span>
        <span class="date-group-toggle" aria-hidden="true">▾</span>
      </div>`;
      for (const file of grp.files) {
        html += buildCardHtml(file, idx++, grp.key);
      }
    }
    D.grid.innerHTML = html;

    D.grid.querySelectorAll('.date-group-hdr').forEach(hdr => {
      hdr.addEventListener('click', () => toggleGroup(hdr.dataset.gkey));
      hdr.addEventListener('keydown', e => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), toggleGroup(hdr.dataset.gkey)));
    });

    wireCardEvents();
    buildDateNav(groups);
  }

  function renderGrid() {
    if (!S.filtered.length) {
      const isFavsFilter = S.filter === 'favorites';
      D.grid.innerHTML = `<div class="state-msg" style="grid-column:1/-1">
        <div class="icon">${S.search ? '◻' : isFavsFilter ? '♡' : '◻'}</div>
        <h3>${S.search ? 'No matches' : isFavsFilter ? 'No favorites in this folder' : 'Empty folder'}</h3>
        <p>${S.search
          ? `No files match "<em>${esc(S.search)}</em>"`
          : isFavsFilter
            ? 'Hover a card and tap ♡ to save favorites — they persist across sessions.'
            : 'This folder contains no files.'
        }</p>
      </div>`;
      buildDateNav([]);
      return;
    }

    if (S.sort === 'timeline') {
      renderGridGrouped();
      return;
    }

    buildDateNav([]);
    D.grid.classList.remove('grid-timeline');
    D.grid.innerHTML = S.filtered.map((file, idx) => buildCardHtml(file, idx, '')).join('');
    wireCardEvents();
  }

  /* ─────────────────────────────────────────
     LIGHTBOX
  ───────────────────────────────────────── */
  function openLb(idx) {
    if (idx < 0 || idx >= S.media.length) return;
    S.lbIdx = idx;
    paintLb();
    D.lb.classList.remove('hidden');
    document.body.style.overflow = 'hidden';
  }

  function closeLb() {
    D.lb.classList.add('hidden');
    document.body.style.overflow = '';
    D.lbBody.innerHTML = '';
    S.lbIdx = -1;
  }

  function paintLb() {
    const file = S.media[S.lbIdx];
    if (!file) return;
    const t = fileType(file.mimeType);
    D.lbName.textContent = file.name;
    D.lbCtr.textContent  = `${S.lbIdx + 1} / ${S.media.length}`;
    D.lbOpen.href        = file.webViewLink || '#';

    if (t === 'image') {
      D.lbBody.innerHTML = `<img
        src="https://drive.google.com/uc?id=${esc(file.id)}&export=view"
        alt="${esc(file.name)}"
        onerror="this.src='https://drive.google.com/thumbnail?id=${esc(file.id)}&sz=w1600'">`;
    } else {
      D.lbBody.innerHTML = `<iframe
        src="https://drive.google.com/file/d/${esc(file.id)}/preview"
        allow="autoplay" allowfullscreen loading="lazy"></iframe>`;
    }

    D.lbPrev.style.visibility = S.lbIdx > 0                       ? 'visible' : 'hidden';
    D.lbNext.style.visibility = S.lbIdx < S.media.length - 1      ? 'visible' : 'hidden';
  }

  function lbNav(d) {
    const n = S.lbIdx + d;
    if (n >= 0 && n < S.media.length) { S.lbIdx = n; paintLb(); }
  }

  /* ─────────────────────────────────────────
     SELECTION & ZIP DOWNLOAD (M4)
  ───────────────────────────────────────── */
  function isDownloadable(file) {
    // Skip Google Workspace formats — no binary content to download
    return !((file.mimeType || '').startsWith('application/vnd.google-apps.'));
  }

  function enterSelectMode() {
    S.selectMode = true;
    S.selected.clear();
    document.body.classList.add('select-mode');
    D.selModeBtn.classList.add('active');
    D.selBar.classList.remove('hidden');
    updateSelBar();
    renderGrid(); // redraw to show checkboxes
  }

  function exitSelectMode() {
    S.selectMode = false;
    S.selected.clear();
    document.body.classList.remove('select-mode');
    D.selModeBtn.classList.remove('active');
    D.selBar.classList.add('hidden');
    renderGrid(); // redraw to hide checkboxes
  }

  function toggleSelect(id) {
    if (S.selected.has(id)) S.selected.delete(id);
    else                     S.selected.add(id);
    // Update card DOM directly — no full re-render needed
    const card = D.grid.querySelector(`.card[data-id="${id}"]`);
    if (card) card.classList.toggle('selected', S.selected.has(id));
    updateSelBar();
  }

  function updateSelBar() {
    const n = S.selected.size;
    D.selCount.textContent = n === 0 ? '0 selected' : `${n} file${n !== 1 ? 's' : ''} selected`;
    const downloadable = [...S.selected].filter(id => {
      const f = S.files.find(x => x.id === id);
      return f && isDownloadable(f);
    }).length;
    D.selDownload.disabled = downloadable === 0;
    D.selDownloadLbl.textContent = downloadable > 0 ? `Download ZIP (${downloadable})` : 'Download ZIP';
  }

  async function downloadZip() {
    const toDownload = S.files.filter(f =>
      S.selected.has(f.id) && isDownloadable(f) && fileType(f.mimeType) !== 'folder'
    );
    if (!toDownload.length) return;

    if (toDownload.length > 50) {
      const ok = confirm(`You selected ${toDownload.length} files. This may use significant memory. Continue?`);
      if (!ok) return;
    }

    // Lock UI during download
    D.selDownload.disabled = true;
    D.selAll.disabled = true;
    D.selNone.disabled = true;
    D.selProgressWrap.classList.remove('hidden');
    D.selProgressBar.style.width = '0%';

    const zip   = new JSZip();  // eslint-disable-line no-undef
    const total = toDownload.length;
    let   done  = 0;
    const failed = [];

    for (const file of toDownload) {
      try {
        const url = `https://www.googleapis.com/drive/v3/files/${file.id}?alt=media&key=${getApiKey()}`;
        const res = await fetch(url);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const blob = await res.blob();
        zip.file(file.name, blob);
      } catch {
        failed.push(file.name);
      }
      done++;
      const pct = Math.round((done / total) * 80); // fetch phase: 0→80%
      D.selProgressBar.style.width = pct + '%';
      D.selProgressLbl.textContent = `Fetching ${done}/${total}…`;
    }

    // Compress phase: 80→100%
    D.selProgressLbl.textContent = 'Compressing…';
    const zipBlob = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE' }, meta => {
      D.selProgressBar.style.width = (80 + meta.percent * 0.2).toFixed(0) + '%';
    });

    // Trigger download
    const folderName = S.stack.at(-1)?.name?.replace(/[^a-z0-9]/gi, '-') || 'darkroom';
    const anchor = document.createElement('a');
    anchor.href = URL.createObjectURL(zipBlob);
    anchor.download = `${folderName}-selection.zip`;
    anchor.click();
    URL.revokeObjectURL(anchor.href);

    // Reset UI
    D.selProgressWrap.classList.add('hidden');
    D.selProgressBar.style.width = '0%';
    D.selProgressLbl.textContent = '';
    D.selDownload.disabled = false;
    D.selAll.disabled = false;
    D.selNone.disabled = false;
    updateSelBar();

    if (failed.length) {
      D.selProgressWrap.classList.remove('hidden');
      D.selProgressLbl.textContent = `⚠ ${failed.length} file${failed.length > 1 ? 's' : ''} skipped (not downloadable)`;
      setTimeout(() => {
        D.selProgressWrap.classList.add('hidden');
        D.selProgressLbl.textContent = '';
      }, 4000);
    }
  }

  /* ─────────────────────────────────────────
     SLIDESHOW
  ───────────────────────────────────────── */
  const SS_INTERVAL = 4000; // ms between slides
  const KB_CLASSES  = ['kb1', 'kb2', 'kb3', 'kb4'];
  let   _kbIdx      = 0;    // cycles through Ken Burns variants

  // SVG templates for play/pause icons
  const SVG_PAUSE = `<line x1="10" y1="15" x2="10" y2="9"/><line x1="14" y1="15" x2="14" y2="9"/>`;
  const SVG_PLAY  = `<polygon points="5 3 19 12 5 21 5 3"/>`;

  function openSlideshow() {
    if (!S.media.length) return;
    S.slideshowActive = true;
    S.slideshowIdx    = 0;
    S.slideshowPaused = false;
    D.ssOverlay.classList.remove('hidden');
    document.body.style.overflow = 'hidden';
    paintSlide(S.slideshowIdx);
    startTimer();
    updatePlayIcon();
  }

  function closeSlideshow() {
    S.slideshowActive = false;
    clearTimer();
    D.ssOverlay.classList.add('hidden');
    D.ssBody.innerHTML = '';
    document.body.style.overflow = '';
    // Exit fullscreen if active
    if (document.fullscreenElement) {
      document.exitFullscreen().catch(() => {});
    }
  }

  function slideshowNext() {
    S.slideshowIdx = (S.slideshowIdx + 1) % S.media.length;
    paintSlide(S.slideshowIdx);
    if (!S.slideshowPaused) restartTimer();
  }

  function slideshowPrev() {
    S.slideshowIdx = (S.slideshowIdx - 1 + S.media.length) % S.media.length;
    paintSlide(S.slideshowIdx);
    if (!S.slideshowPaused) restartTimer();
  }

  function slideshowPause() {
    S.slideshowPaused = true;
    clearTimer();
    updatePlayIcon();
    stopProgressBar();
  }

  function slideshowResume() {
    S.slideshowPaused = false;
    updatePlayIcon();
    restartTimer();
  }

  function paintSlide(idx) {
    const file = S.media[idx];
    if (!file) return;
    const t = fileType(file.mimeType);

    // Update footer text
    D.ssName.textContent = file.name;
    D.ssCtr.textContent  = `${idx + 1} / ${S.media.length}`;

    // Remove old slides, keeping at most one outgoing
    const existing = D.ssBody.querySelectorAll('.ss-slide');
    existing.forEach((s, i) => {
      if (i < existing.length - 1) s.remove(); // remove older ones immediately
      else {
        // fade out the last active slide
        s.classList.remove('ss-active');
        setTimeout(() => s.remove(), 450);
      }
    });

    // Build new slide
    const slide = document.createElement('div');
    slide.className = 'ss-slide';

    if (t === 'image') {
      const kbClass = KB_CLASSES[_kbIdx % KB_CLASSES.length];
      _kbIdx++;
      const img = document.createElement('img');
      img.src = `https://drive.google.com/uc?id=${file.id}&export=view`;
      img.alt = file.name;
      img.className = kbClass;
      img.onerror = () => {
        img.src = `https://drive.google.com/thumbnail?id=${file.id}&sz=w1600`;
      };
      slide.appendChild(img);
    } else {
      // Video — show iframe (no auto-advance timer while video is playing; timer still runs)
      const ifr = document.createElement('iframe');
      ifr.src           = `https://drive.google.com/file/d/${file.id}/preview`;
      ifr.allow         = 'autoplay';
      ifr.allowFullscreen = true;
      ifr.loading       = 'lazy';
      slide.appendChild(ifr);
    }

    D.ssBody.appendChild(slide);
    // Trigger fade-in on next frame
    requestAnimationFrame(() => {
      requestAnimationFrame(() => slide.classList.add('ss-active'));
    });

    // Restart progress bar
    if (!S.slideshowPaused) animateProgressBar(SS_INTERVAL);
  }

  function startTimer() {
    clearTimer();
    S.slideshowTimer = setTimeout(() => {
      if (S.slideshowActive && !S.slideshowPaused) {
        slideshowNext();
      }
    }, SS_INTERVAL);
    if (!S.slideshowPaused) animateProgressBar(SS_INTERVAL);
  }

  function restartTimer() {
    clearTimer();
    startTimer();
  }

  function clearTimer() {
    if (S.slideshowTimer) { clearTimeout(S.slideshowTimer); S.slideshowTimer = null; }
  }

  function animateProgressBar(duration) {
    // Reset then animate width from 0→100% over duration ms
    D.ssProgress.style.transition = 'none';
    D.ssProgress.style.width      = '0%';
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        D.ssProgress.style.transition = `width ${duration}ms linear`;
        D.ssProgress.style.width      = '100%';
      });
    });
  }

  function stopProgressBar() {
    // Freeze progress bar at current position
    const computed = getComputedStyle(D.ssProgress).width;
    const wrapWidth = D.ssProgress.parentElement.offsetWidth;
    const pct = wrapWidth > 0 ? (parseFloat(computed) / wrapWidth) * 100 : 0;
    D.ssProgress.style.transition = 'none';
    D.ssProgress.style.width      = pct + '%';
  }

  function updatePlayIcon() {
    // Swap inner SVG content between pause bars and play triangle
    D.ssPlayIcon.innerHTML = S.slideshowPaused ? SVG_PLAY : SVG_PAUSE;
    D.ssPlayBtn.setAttribute('aria-label', S.slideshowPaused ? 'Resume' : 'Pause');
    D.ssPlayIcon.setAttribute('fill', S.slideshowPaused ? 'currentColor' : 'none');
    D.ssPlayIcon.setAttribute('stroke', S.slideshowPaused ? 'none' : 'currentColor');
  }

  function toggleFullscreen() {
    if (!document.fullscreenElement) {
      D.ssOverlay.requestFullscreen().catch(() => {});
    } else {
      document.exitFullscreen().catch(() => {});
    }
  }

  // Slideshow button click
  D.ssBtn.addEventListener('click', openSlideshow);

  // Footer controls
  D.ssClose.addEventListener('click', closeSlideshow);
  D.ssFsBtn.addEventListener('click', toggleFullscreen);
  D.ssPlayBtn.addEventListener('click', () => {
    if (S.slideshowPaused) slideshowResume();
    else                   slideshowPause();
  });

  // Click on image area → pause/resume
  D.ssBody.addEventListener('click', e => {
    if (e.target.tagName === 'IFRAME') return; // don't interfere with video
    if (S.slideshowPaused) slideshowResume();
    else                   slideshowPause();
  });

  // Touch swipe for slideshow
  let ssTx = 0;
  D.ssOverlay.addEventListener('touchstart', e => { ssTx = e.touches[0].clientX; }, { passive: true });
  D.ssOverlay.addEventListener('touchend', e => {
    if (!S.slideshowActive) return;
    const dx = e.changedTouches[0].clientX - ssTx;
    if (Math.abs(dx) > 50) {
      if (dx < 0) slideshowNext();
      else        slideshowPrev();
    }
  });

  /* ─────────────────────────────────────────
     EVENTS
  ───────────────────────────────────────── */
  /* ─────────────────────────────────────────
     SETTINGS MODAL
  ───────────────────────────────────────── */
  function updateKeyDot() {
    if (!D.apiKeyDot) return;
    D.apiKeyDot.classList.toggle('key-set', hasApiKey());
    D.apiKeyDot.title = hasApiKey() ? 'API key configured' : 'No API key — click to set';
  }

  function openSettings() {
    D.settingsMod.classList.remove('hidden');
    D.apiKeyInput.value = localStorage.getItem(LS_KEY) || '';
    D.apiKeyInput.focus();
    document.body.style.overflow = 'hidden';
  }

  function closeSettings() {
    D.settingsMod.classList.add('hidden');
    document.body.style.overflow = '';
  }

  D.settingsBtn.addEventListener('click', openSettings);
  D.apiKeyClose.addEventListener('click', closeSettings);
  D.settingsMod.addEventListener('click', e => { if (e.target === D.settingsMod) closeSettings(); });

  D.apiKeySave.addEventListener('click', () => {
    const val = D.apiKeyInput.value.trim();
    if (!val) return;
    saveApiKey(val);
    updateKeyDot();
    closeSettings();
  });

  D.apiKeyInput.addEventListener('keydown', e => {
    if (e.key === 'Enter') D.apiKeySave.click();
    if (e.key === 'Escape') closeSettings();
  });

  D.apiKeyClear.addEventListener('click', () => {
    localStorage.removeItem(LS_KEY);
    D.apiKeyInput.value = '';
    updateKeyDot();
  });

  // Initialize dot on load
  updateKeyDot();

  /* ─── Selection bar (M4) ───────────────── */
  D.selModeBtn.addEventListener('click', () => {
    if (S.selectMode) exitSelectMode();
    else              enterSelectMode();
  });

  D.selAll.addEventListener('click', () => {
    // Select all non-folder downloadable files in the current filtered view
    S.filtered.forEach(f => {
      if (fileType(f.mimeType) !== 'folder') S.selected.add(f.id);
    });
    // Reflect selection state on all cards in DOM
    D.grid.querySelectorAll('.card:not(.card-folder)').forEach(c => c.classList.add('selected'));
    updateSelBar();
  });

  D.selNone.addEventListener('click', () => {
    S.selected.clear();
    D.grid.querySelectorAll('.card.selected').forEach(c => c.classList.remove('selected'));
    updateSelBar();
  });

  D.selDownload.addEventListener('click', downloadZip);
  D.selExit.addEventListener('click', exitSelectMode);

  // Favorites header button — jump to favorites view if gallery is open
  D.favHdrBtn.addEventListener('click', () => {
    if (D.gallery.classList.contains('hidden')) return;
    document.querySelectorAll('.ftab').forEach(t => t.classList.toggle('active', t.dataset.filter === 'favorites'));
    S.filter = 'favorites';
    applyFilter();
  });

  // Initialize favorites badge
  updateFavBadge();

  D.form.addEventListener('submit', e => {
    e.preventDefault();
    if (!hasApiKey()) {
      openSettings();
      return;
    }
    const id = extractId(D.input.value);
    if (!id) {
      D.input.style.borderColor = 'var(--b-pdf)';
      D.input.style.boxShadow   = '0 0 0 3px rgba(224,68,68,.18)';
      setTimeout(() => { D.input.style.borderColor=''; D.input.style.boxShadow=''; }, 2000);
      return;
    }
    S.stack = [];
    browse(id);
  });

  let debounce;
  D.search.addEventListener('input', e => {
    clearTimeout(debounce);
    debounce = setTimeout(() => { S.search = e.target.value.trim(); applyFilter(); }, 250);
  });

  document.querySelectorAll('.ftab').forEach(tab => tab.addEventListener('click', () => {
    document.querySelectorAll('.ftab').forEach(t => t.classList.remove('active'));
    tab.classList.add('active');
    S.filter = tab.dataset.filter;
    applyFilter();
  }));

  D.sort.addEventListener('change',  e => { S.sort = e.target.value; applyFilter(); });
  D.loadBtn.addEventListener('click', loadMore);

  D.lbX.addEventListener('click', closeLb);
  D.lbPrev.addEventListener('click', () => lbNav(-1));
  D.lbNext.addEventListener('click', () => lbNav(1));
  D.lb.addEventListener('click', e => { if (e.target === D.lb) closeLb(); });

  document.addEventListener('keydown', e => {
    // Slideshow keyboard handling — takes priority over lightbox
    if (S.slideshowActive) {
      if (e.key === 'Escape') { e.preventDefault(); closeSlideshow(); return; }
      if (e.key === ' ')      { e.preventDefault(); if (S.slideshowPaused) slideshowResume(); else slideshowPause(); return; }
      if (e.key === 'ArrowLeft')  { e.preventDefault(); slideshowPrev(); return; }
      if (e.key === 'ArrowRight') { e.preventDefault(); slideshowNext(); return; }
      return; // consume all other keys while slideshow is active
    }
    // Lightbox keyboard handling
    if (D.lb.classList.contains('hidden')) return;
    if (e.key === 'Escape')      closeLb();
    if (e.key === 'ArrowLeft')   lbNav(-1);
    if (e.key === 'ArrowRight')  lbNav(1);
  });

  // Touch swipe
  let tx = 0;
  D.lb.addEventListener('touchstart', e => { tx = e.touches[0].clientX; }, { passive:true });
  D.lb.addEventListener('touchend',   e => {
    const dx = e.changedTouches[0].clientX - tx;
    if (Math.abs(dx) > 50) lbNav(dx < 0 ? 1 : -1);
  });

  // URL param boot
  const qp = new URLSearchParams(window.location.search).get('folder');
  if (qp) { D.input.value = qp; S.stack = []; browse(qp); }

})();
