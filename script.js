(() => {
  'use strict';

  /* ─────────────────────────────────────────
     CONFIG
  ───────────────────────────────────────── */
  const API_BASE   = 'https://www.googleapis.com/drive/v3/files';
  const PG_SIZE    = 100;
  const LS_KEY       = 'darkroom_api_key';
  const LS_FAVS      = 'darkroom_favs';
  const LS_CLIENT_ID  = 'darkroom_client_id';
  const SS_TOKEN_KEY  = 'darkroom_oauth';
  const LS_AI_TAGS    = 'darkroom_ai_tags';
  const LS_AI_ENABLED = 'darkroom_ai_enabled';
  const AI_THRESHOLD  = 0.30;  // minimum confidence to include a tag
  const AI_MAX_PREDS  = 5;     // predictions to request from MobileNet
  const AI_SHOW_TAGS  = 3;     // max tags shown per card
  const LS_VIEW_MODE  = 'darkroom_view_mode';
  const DEMO_FOLDER_ID = ''; // set to a public Drive folder ID for the demo button (M11)
  // M13 — Events & Upload
  const LS_EVENTS        = 'darkroom_events';
  const LS_CURATION      = 'darkroom_curation';
  const QR_CDN           = 'https://cdn.jsdelivr.net/npm/qrcode-generator@1/qrcode.min.js';
  const UPLOAD_MAX_MB    = 50;
  const COVER_STYLES     = ['warm-gold', 'cool-blue', 'forest-green', 'sunset-pink'];
  const DRIVE_FILE_SCOPE = 'https://www.googleapis.com/auth/drive.file';
  const GIS_WRITE_SCOPE  = 'https://www.googleapis.com/auth/drive.file https://www.googleapis.com/auth/userinfo.profile https://www.googleapis.com/auth/userinfo.email';

  /* ─────────────────────────────────────────
     EMBED MODE STATE (M9)
  ───────────────────────────────────────── */
  const _isEmbed = new URLSearchParams(location.search).get('embed') === '1';

  /* ─────────────────────────────────────────
     URL SYNC STATE (M6)
  ───────────────────────────────────────── */
  let _nextSyncPush  = false; // next syncUrl() call should pushState
  let _skipNextSync  = false; // next syncUrl() call should replaceState (overrides push)
  let _pendingFilter = null;  // filter to apply on next applyFilter() (URL restore)
  let _pendingSort   = null;  // sort to apply on next applyFilter()
  let _pendingSearch = null;  // search to apply on next applyFilter()
  let _pendingItem   = null;  // file ID to open in lightbox after applyFilter()

  /* ─────────────────────────────────────────
     OAUTH STATE (M7)
  ───────────────────────────────────────── */
  let _oauthToken  = null;  // current access token (drive.readonly)
  let _oauthExpiry = 0;     // expiry timestamp (ms)
  let _tokenClient = null;  // GIS token client instance

  /* ─────────────────────────────────────────
     EVENT OAUTH STATE (M13)
  ───────────────────────────────────────── */
  let _hostWriteToken  = null;  // drive.file token for host event ops
  let _hostWriteExpiry = 0;
  let _hostWriteClient = null;  // separate GIS token client (drive.file scope)
  let _guestToken      = null;  // drive.file token for guest uploads
  let _guestExpiry     = 0;
  let _guestClient     = null;
  // UI state
  let _selectedCoverStyle = 'warm-gold';
  let _currentQREvent     = null;   // event shown in QR modal
  let _currentQRTab       = 'upload'; // 'upload' | 'gallery'
  let _statsPollingTimer  = null;
  let _qrLibLoaded        = false;

  /* ─────────────────────────────────────────
     AI TAGGING STATE (M8)
  ───────────────────────────────────────── */
  let _aiEnabled = false;  // user opt-in
  let _aiModel   = null;   // loaded MobileNet instance
  let _aiLoading = false;  // model currently loading
  let _aiTags    = {};     // { [fileId]: string[] } — in-memory + persisted
  let _aiQueue   = [];     // files awaiting classification
  let _aiRunning = false;  // queue processor active
  let _aiDone    = 0;      // images processed in current batch
  let _aiTotal   = 0;      // total images in current batch

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
     OAUTH HELPERS (M7)
  ───────────────────────────────────────── */
  function getClientId() {
    return (typeof DARKROOM_CONFIG !== 'undefined' && DARKROOM_CONFIG.clientId) ||
           localStorage.getItem(LS_CLIENT_ID) || '';
  }

  function saveClientId(id) { localStorage.setItem(LS_CLIENT_ID, id.trim()); }

  function isSignedIn() { return !!_oauthToken && Date.now() < _oauthExpiry; }

  // Build fetch headers: Bearer token when signed in, else nothing (key goes in URL param)
  function authHeaders() {
    return isSignedIn() ? { Authorization: `Bearer ${_oauthToken}` } : {};
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
    // View mode (M10)
    viewMode: 'grid', // 'grid' | 'timeline'
    // Password lock (M12)
    lockHash: '',
    // Events (M13)
    events:        [],
    currentEvent:  null,  // { id, name, date, folderId, coverStyle, createdAt, permissionId }
    eventMode:     false, // true when browsing in event gallery context
    uploadMode:    false, // true when ?event+upload=1 shown
    // Live polling (M14)
    pollTimer:     null,
    pollInterval:  30000,
    slideshowLive: false,
    // Curation (M15)
    hiddenFiles:       new Set(),
    featuredFiles:     [],
    hostMode:          false,
    guestView:         false,
    contributorFilter: '',
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
    // copy link (M6)
    copyLinkBtn: el('copy-link-btn'),
    // sign in / user (M7)
    signInBtn:     el('sign-in-btn'),
    userPill:      el('user-pill'),
    userAvatar:    el('user-avatar'),
    userName:      el('user-name'),
    signOutBtn:    el('sign-out-btn'),
    driveSidebar:  el('drive-sidebar'),
    driveFolders:  el('drive-folders'),
    clientIdInput: el('client-id-input'),
    clientIdSave:  el('client-id-save'),
    clientIdClear: el('client-id-clear'),
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
    // view toggle (M10)
    viewToggle:     el('view-toggle'),
    viewGridBtn:    el('view-grid-btn'),
    viewTimelineBtn:el('view-timeline-btn'),
    printBtn:       el('print-btn'),
    tlMinimap:      el('tl-minimap'),
    // embed modal (M9)
    embedBtn:    el('embed-btn'),
    embedModal:  el('embed-modal'),
    embedClose:  el('embed-close'),
    embedWidth:  el('embed-width'),
    embedHeight: el('embed-height'),
    embedCode:   el('embed-code'),
    embedCopy:   el('embed-copy'),
    // M11 — landing
    taglineCycle: el('tagline-cycle'),
    demoLink:     el('demo-link'),
    // M12 — protect / lock
    protectBtn:      el('protect-btn'),
    protectModal:    el('protect-modal'),
    protectClose:    el('protect-close'),
    protectInput:    el('protect-input'),
    protectGen:      el('protect-gen'),
    protectLinkRow:  el('protect-link-row'),
    protectLink:     el('protect-link'),
    protectCopy:     el('protect-copy'),
    lockOverlay:     el('lock-overlay'),
    lockInput:       el('lock-input'),
    lockBtn:         el('lock-btn'),
    lockError:       el('lock-error'),
    // AI tagging (M8)
    aiBtn:       el('ai-btn'),
    aiStatus:    el('ai-status'),
    // M13 — event dashboard
    newEventBtnHdr:     el('new-event-btn-hdr'),
    eventDashboard:     el('event-dashboard'),
    eventList:          el('event-list'),
    newEventBtn:        el('new-event-btn'),
    // M13 — event create modal
    eventCreateModal:   el('event-create-modal'),
    eventCreateClose:   el('event-create-close'),
    eventNameInput:     el('event-name-input'),
    eventDateInput:     el('event-date-input'),
    coverStylePicker:   el('cover-style-picker'),
    eventCreateBtn:     el('event-create-btn'),
    eventCreateLabel:   el('event-create-btn-label'),
    eventCreateSpinner: el('event-create-spinner'),
    eventCreateNote:    el('event-create-note'),
    // M13 — QR modal
    qrShareModal:   el('qr-share-modal'),
    qrEventName:    el('qr-event-name'),
    qrClose:        el('qr-close'),
    qrTabUpload:    el('qr-tab-upload'),
    qrTabGallery:   el('qr-tab-gallery'),
    qrCanvasWrap:   el('qr-canvas-wrap'),
    qrHint:         el('qr-hint'),
    qrUrlInput:     el('qr-url-input'),
    qrCopyBtn:      el('qr-copy-btn'),
    qrDownloadBtn:  el('qr-download-btn'),
    qrWhatsappBtn:  el('qr-whatsapp-btn'),
    qrEmailBtn:     el('qr-email-btn'),
    // M13 — upload page
    uploadPage:       el('upload-page'),
    uploadHeader:     el('upload-header'),
    uploadEventName:  el('upload-event-name'),
    uploadEventDate:  el('upload-event-date'),
    uploadCount:      el('upload-count'),
    guestName:        el('guest-name'),
    uploadAuthPrompt: el('upload-auth-prompt'),
    uploadSigninBtn:  el('upload-signin-btn'),
    uploadUi:         el('upload-ui'),
    filePicker:       el('file-picker'),
    addPhotosBtn:     el('add-photos-btn'),
    uploadList:       el('upload-list'),
    uploadDoneMsg:    el('upload-done-msg'),
    uploadMoreBtn:    el('upload-more-btn'),
    // M14 — polling controls
    refreshBtn:       el('refresh-btn'),
    pollIntervalSel:  el('poll-interval-sel'),
    ssLiveBtn:        el('ss-live-btn'),
    statsDisplay:     el('stats-display'),
    statsDisplayName: el('stats-display-event-name'),
    statsCounter:     el('stats-display-counter'),
    statsDisplayQr:   el('stats-display-qr'),
    // M15 — curation / contributors / thanks
    contributorsPanel: el('contributors-panel'),
    curationBar:       el('curation-bar'),
    curationHideBtn:   el('curation-hide-btn'),
    curationFeatureBtn:el('curation-feature-btn'),
    curationShareBtn:  el('curation-share-btn'),
    curationThanksBtn: el('curation-thanks-btn'),
    thanksPage:        el('thanks-page'),
    thanksEventName:   el('thanks-event-name'),
    thanksEventDate:   el('thanks-event-date'),
    thanksStats:       el('thanks-stats'),
    thanksGrid:        el('thanks-grid'),
    thanksGalleryBtn:  el('thanks-gallery-btn'),
    thanksDownloadBtn: el('thanks-download-btn'),
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
     URL SYNC (M6)
  ───────────────────────────────────────── */
  function syncUrl() {
    if (S.uploadMode || S.guestView) return; // upload/guest pages manage their own URL
    const folderId = S.stack.at(-1)?.id;
    if (!folderId) return; // no gallery open — don't touch the URL
    const p = new URLSearchParams();
    // M13: event mode uses ?event= instead of ?folder=
    if (S.eventMode && S.currentEvent) p.set('event', S.currentEvent.folderId);
    else p.set('folder', folderId);
    if (S.filter && S.filter !== 'all')  p.set('filter', S.filter);
    if (S.sort   && S.sort   !== 'name-asc') p.set('sort', S.sort);
    if (S.search)                         p.set('q',      S.search);
    if (S.lbIdx >= 0 && S.media[S.lbIdx]) p.set('item', S.media[S.lbIdx].id);
    if (S.viewMode && S.viewMode !== 'grid') p.set('view', S.viewMode); // M10
    if (_isEmbed) p.set('embed', '1'); // M9: preserve embed param in URL history
    if (S.lockHash) p.set('lock', S.lockHash); // M12: preserve lock hash
    const url = location.pathname + '?' + p.toString();
    const shouldPush = _nextSyncPush && !_skipNextSync;
    _nextSyncPush = false;
    _skipNextSync = false;
    if (shouldPush) history.pushState(null, '', url);
    else            history.replaceState(null, '', url);
  }

  function showToast(msg) {
    const t = document.createElement('div');
    t.className = 'toast';
    t.textContent = msg;
    document.body.appendChild(t);
    requestAnimationFrame(() => requestAnimationFrame(() => t.classList.add('toast-in')));
    setTimeout(() => {
      t.classList.remove('toast-in');
      t.addEventListener('transitionend', () => t.remove(), { once: true });
    }, 2200);
  }

  /* ─────────────────────────────────────────
     AI TAGGING (M8)
  ───────────────────────────────────────── */
  function loadAiTagsFromStorage() {
    try {
      const raw = localStorage.getItem(LS_AI_TAGS);
      _aiTags = raw ? JSON.parse(raw) : {};
    } catch { _aiTags = {}; }
  }

  function saveAiTag(fileId, tags) {
    _aiTags[fileId] = tags;
    try { localStorage.setItem(LS_AI_TAGS, JSON.stringify(_aiTags)); }
    catch { /* storage full — keep in memory */ }
  }

  function loadTFScripts() {
    return new Promise((resolve, reject) => {
      if (window.mobilenet) { resolve(); return; }
      const tf = document.createElement('script');
      tf.src = 'https://cdn.jsdelivr.net/npm/@tensorflow/tfjs@4.20.0/dist/tf.min.js';
      tf.onload = () => {
        const mn = document.createElement('script');
        mn.src = 'https://cdn.jsdelivr.net/npm/@tensorflow-models/mobilenet@2.1.0/dist/mobilenet.min.js';
        mn.onload  = resolve;
        mn.onerror = () => reject(new Error('Failed to load MobileNet'));
        document.head.appendChild(mn);
      };
      tf.onerror = () => reject(new Error('Failed to load TensorFlow.js'));
      document.head.appendChild(tf);
    });
  }

  async function enableAiTagging() {
    _aiEnabled = true;
    localStorage.setItem(LS_AI_ENABLED, '1');
    D.aiBtn.classList.add('active');

    if (!_aiModel && !_aiLoading) {
      _aiLoading = true;
      updateAiStatus('Loading AI model…');
      try {
        await loadTFScripts();
        updateAiStatus('Initializing…');
        _aiModel = await window.mobilenet.load({ version: 2, alpha: 0.5 });
      } catch {
        showToast('AI model failed to load — check console');
        _aiEnabled = false;
        _aiLoading = false;
        _aiModel   = null;
        localStorage.removeItem(LS_AI_ENABLED);
        D.aiBtn.classList.remove('active');
        updateAiStatus('');
        return;
      }
      _aiLoading = false;
      applyFilter(); // re-render to inject .ai-tags placeholders
    }

    startAiTagging();
  }

  function disableAiTagging() {
    _aiEnabled = false;
    localStorage.removeItem(LS_AI_ENABLED);
    D.aiBtn.classList.remove('active');
    _aiQueue = []; // cancel pending work
    _aiDone  = 0;
    _aiTotal = 0;
    updateAiStatus('');
    applyFilter(); // re-render without tag placeholders
  }

  function startAiTagging() {
    if (!_aiEnabled || !_aiModel) return;
    // Build queue from untagged images in current view
    _aiQueue = S.media.filter(f => f.thumbnailLink && !(_aiTags[f.id]?.length >= 0));
    // More precisely: only files not yet attempted (no entry in _aiTags)
    _aiQueue = S.media.filter(f => f.thumbnailLink && !(_aiTags.hasOwnProperty(f.id)));
    _aiDone  = 0;
    _aiTotal = _aiQueue.length;
    if (_aiTotal === 0) { updateAiStatus(''); return; }
    if (!_aiRunning) processAiQueue();
  }

  async function processAiQueue() {
    if (_aiRunning) return;
    _aiRunning = true;
    while (_aiQueue.length > 0 && _aiEnabled) {
      const file = _aiQueue.shift();
      try {
        const tags = await classifyImage(file);
        saveAiTag(file.id, tags); // save even if empty (marks as "attempted")
        if (tags.length) paintAiTags(file.id, tags);
      } catch { saveAiTag(file.id, []); } // mark as attempted on error
      _aiDone++;
      updateAiStatus(`AI: ${_aiDone}/${_aiTotal}`);
    }
    _aiRunning = false;
    updateAiStatus('');
    if (_aiEnabled && _aiTotal > 0) showToast(`AI tagged ${_aiDone} image${_aiDone !== 1 ? 's' : ''}`);
    _aiDone  = 0;
    _aiTotal = 0;
  }

  async function classifyImage(file) {
    const url = file.thumbnailLink.replace(/=s\d+$/, '=w400');
    return new Promise((resolve) => {
      const img = new Image();
      img.crossOrigin = 'anonymous'; // must be set BEFORE src
      img.onload = async () => {
        try {
          const preds = await _aiModel.classify(img, AI_MAX_PREDS);
          const tags  = preds
            .filter(p => p.probability >= AI_THRESHOLD)
            .map(p => p.className.split(',')[0].toLowerCase().trim());
          resolve(tags);
        } catch { resolve([]); }
      };
      img.onerror = () => resolve([]); // CORS or 404 — skip silently
      img.src = url;
    });
  }

  function paintAiTags(fileId, tags) {
    const card   = D.grid.querySelector(`.card[data-id="${fileId}"]`);
    const tagsEl = card?.querySelector('.ai-tags');
    if (!tagsEl || !tags.length) return;
    tagsEl.innerHTML = tags.slice(0, AI_SHOW_TAGS)
      .map(t => `<span class="ai-tag">${esc(t)}</span>`).join('');
  }

  function updateAiStatus(text) {
    if (!D.aiStatus) return;
    D.aiStatus.textContent = text;
    D.aiStatus.classList.toggle('hidden', !text);
  }

  /* ─────────────────────────────────────────
     OAUTH FLOW (M7)
  ───────────────────────────────────────── */
  function loadGISScript() {
    return new Promise((resolve, reject) => {
      if (window.google?.accounts?.oauth2) { resolve(); return; }
      const s = document.createElement('script');
      s.src = 'https://accounts.google.com/gsi/client';
      s.onload  = resolve;
      s.onerror = () => reject(new Error('Failed to load Google Identity Services'));
      document.head.appendChild(s);
    });
  }

  function initGIS() {
    const clientId = getClientId();
    if (!clientId || !window.google?.accounts?.oauth2) return false;
    try {
      _tokenClient = window.google.accounts.oauth2.initTokenClient({
        client_id: clientId,
        scope: 'https://www.googleapis.com/auth/drive.readonly profile email',
        callback: onTokenResponse,
      });
      return true;
    } catch { return false; }
  }

  async function signIn() {
    const clientId = getClientId();
    if (!clientId) {
      showToast('Enter a Client ID in Settings first');
      openSettings();
      return;
    }
    try {
      await loadGISScript();
    } catch {
      showToast('Could not load Google auth library');
      return;
    }
    if (!initGIS()) {
      showToast('OAuth init failed — check Client ID in Settings');
      return;
    }
    _tokenClient.requestAccessToken({ prompt: '' });
  }

  async function onTokenResponse(resp) {
    if (resp.error) {
      showToast('Sign-in failed: ' + resp.error);
      return;
    }
    _oauthToken  = resp.access_token;
    _oauthExpiry = Date.now() + (resp.expires_in * 1000);

    // Fetch user profile
    let userInfo = { name: '', email: '' };
    try {
      const r = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
        headers: { Authorization: `Bearer ${_oauthToken}` },
      });
      if (r.ok) userInfo = await r.json();
    } catch { /* profile fetch is best-effort */ }

    // Persist token in sessionStorage (cleared when tab closes)
    try {
      sessionStorage.setItem(SS_TOKEN_KEY, JSON.stringify({
        token:  _oauthToken,
        expiry: _oauthExpiry,
        name:   userInfo.name  || '',
        email:  userInfo.email || '',
      }));
    } catch { /* storage may be full or blocked */ }

    updateSignInUI(true, userInfo);
    loadMyDriveFolders();
    showToast(`Signed in as ${userInfo.name || userInfo.email || 'Google account'}`);
  }

  function signOut() {
    if (_oauthToken && window.google?.accounts?.oauth2) {
      try { window.google.accounts.oauth2.revoke(_oauthToken, () => {}); } catch {}
    }
    _oauthToken  = null;
    _oauthExpiry = 0;
    try { sessionStorage.removeItem(SS_TOKEN_KEY); } catch {}
    updateSignInUI(false);
    D.driveSidebar.classList.add('hidden');
    D.driveFolders.innerHTML = '';
    showToast('Signed out');
  }

  function handleTokenExpiry() {
    // Called on 401 — token expired; reset auth state silently
    _oauthToken  = null;
    _oauthExpiry = 0;
    try { sessionStorage.removeItem(SS_TOKEN_KEY); } catch {}
    updateSignInUI(false);
    D.driveSidebar.classList.add('hidden');
    D.driveFolders.innerHTML = '';
    showToast('Session expired — please sign in again');
  }

  function updateSignInUI(signedIn, userInfo = {}) {
    D.signInBtn.classList.toggle('hidden', signedIn);
    D.userPill.classList.toggle('hidden', !signedIn);
    if (signedIn) {
      const display = userInfo.name || userInfo.email || '';
      D.userAvatar.textContent = display ? display[0].toUpperCase() : '?';
      D.userName.textContent   = (userInfo.name || userInfo.email || 'User').split(' ')[0];
      // M13: show new-event button and load event dashboard
      if (D.newEventBtnHdr) D.newEventBtnHdr.classList.remove('hidden');
      renderEventDashboard();
    } else {
      if (D.newEventBtnHdr) D.newEventBtnHdr.classList.add('hidden');
      if (D.eventDashboard) D.eventDashboard.classList.add('hidden');
    }
  }

  async function loadMyDriveFolders() {
    if (!isSignedIn()) return;
    D.driveSidebar.classList.remove('hidden');
    D.driveFolders.innerHTML = '<div class="drive-loading">Loading…</div>';
    try {
      const p = new URLSearchParams({
        q:       `'root' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false`,
        fields:  'files(id,name)',
        orderBy: 'name',
        pageSize: 50,
      });
      const r = await fetch(`${API_BASE}?${p}`, { headers: authHeaders() });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const { files = [] } = await r.json();
      renderDriveSidebar(files);
    } catch {
      D.driveFolders.innerHTML = '<div class="drive-empty">Could not load folders</div>';
    }
  }

  function renderDriveSidebar(folders) {
    if (!folders.length) {
      D.driveFolders.innerHTML = '<div class="drive-empty">No folders in My Drive</div>';
      return;
    }
    D.driveFolders.innerHTML = folders.map(f =>
      `<button class="drive-folder-item" data-id="${esc(f.id)}" data-name="${esc(f.name)}">
        <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24"
             fill="none" stroke="currentColor" stroke-width="1.5"
             stroke-linecap="round" stroke-linejoin="round">
          <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>
        </svg>
        <span title="${esc(f.name)}">${esc(f.name)}</span>
      </button>`
    ).join('');
    D.driveFolders.querySelectorAll('.drive-folder-item').forEach(btn => {
      btn.addEventListener('click', () => browse(btn.dataset.id, btn.dataset.name));
    });
  }

  function tryRestoreAuth() {
    try {
      const stored = sessionStorage.getItem(SS_TOKEN_KEY);
      if (!stored) return;
      const { token, expiry, name, email } = JSON.parse(stored);
      if (expiry > Date.now() + 60_000) { // need at least 1 min remaining
        _oauthToken  = token;
        _oauthExpiry = expiry;
        updateSignInUI(true, { name, email });
        loadMyDriveFolders();
      } else {
        sessionStorage.removeItem(SS_TOKEN_KEY);
      }
    } catch { /* session storage may be blocked */ }
  }

  /* ─────────────────────────────────────────
     API
  ───────────────────────────────────────── */
  async function apiFetch(folderId, pageToken) {
    const p = new URLSearchParams({
      q: `'${folderId}' in parents and trashed=false`,
      fields: 'files(id,name,mimeType,size,modifiedTime,thumbnailLink,webViewLink,webContentLink,description),nextPageToken',
      pageSize: PG_SIZE,
      orderBy: 'folder,name',
    });
    if (!isSignedIn()) p.set('key', getApiKey()); // M7: use API key only when not signed in
    if (pageToken) p.set('pageToken', pageToken);
    const r = await fetch(`${API_BASE}?${p}`, { headers: authHeaders() });
    if (!r.ok) {
      const e = await r.json().catch(()=>({}));
      if (r.status === 401 && isSignedIn()) handleTokenExpiry(); // M7: clear expired token
      throw new Error(e?.error?.message || `HTTP ${r.status}`);
    }
    return r.json();
  }

  async function apiFolderName(id) {
    const p = new URLSearchParams({ fields: 'name' });
    if (!isSignedIn()) p.set('key', getApiKey()); // M7: use API key only when not signed in
    const r = await fetch(`${API_BASE}/${id}?${p}`, { headers: authHeaders() });
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
    _aiQueue = []; _aiDone = 0; _aiTotal = 0; // M8: cancel AI queue for previous folder

    D.landing.classList.add('hidden');
    D.gallery.classList.remove('hidden');
    D.copyLinkBtn.classList.remove('hidden'); // M6: show copy link btn when gallery opens
    if (!_isEmbed) D.embedBtn.classList.remove('hidden'); // M9: show embed btn (not in embed mode itself)
    if (!_isEmbed) D.protectBtn.classList.remove('hidden'); // M12
    D.search.value = ''; S.search = ''; S.filter = 'all';
    document.querySelectorAll('.ftab').forEach(t => t.classList.toggle('active', t.dataset.filter==='all'));
    D.loadWrap.classList.add('hidden'); D.stats.innerHTML = '';
    showSkeletons(12);

    try {
      if (!folderName) folderName = await apiFolderName(folderId);

      const existing = S.stack.findIndex(f => f.id === folderId);
      const isNewFolder = existing < 0; // drilling into new subfolder → pushState
      if (existing >= 0) S.stack = S.stack.slice(0, existing + 1);
      else               S.stack.push({ id: folderId, name: folderName });
      if (isNewFolder) _nextSyncPush = true; // M6: push history for subfolder drill-down
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
    // M6: Restore pending state from URL (set by boot or popstate handler)
    if (_pendingFilter !== null) {
      S.filter = _pendingFilter;
      document.querySelectorAll('.ftab').forEach(t => t.classList.toggle('active', t.dataset.filter === _pendingFilter));
      _pendingFilter = null;
    }
    if (_pendingSort !== null) {
      S.sort = _pendingSort;
      D.sort.value = _pendingSort;
      _pendingSort = null;
    }
    if (_pendingSearch !== null) {
      S.search = _pendingSearch;
      D.search.value = _pendingSearch;
      _pendingSearch = null;
    }

    let list = [...S.files];
    // M15: apply hidden files filter (guest view + host curates)
    if (S.guestView) list = list.filter(f => !S.hiddenFiles.has(f.id));
    if (S.filter === 'favorites')   list = list.filter(f => isFav(f.id));
    else if (S.filter !== 'all')    list = list.filter(f => fileType(f.mimeType) === S.filter);
    // M15: contributor filter
    if (S.contributorFilter) list = list.filter(f => f.description === S.contributorFilter);
    if (S.search) {
      const q = S.search.toLowerCase();
      list = list.filter(f => {
        if (f.name.toLowerCase().includes(q)) return true;
        // M8: also match AI tags when enabled
        if (_aiEnabled && _aiTags[f.id]?.some(t => t.includes(q))) return true;
        return false;
      });
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
    // M6: Sync URL state
    syncUrl();
    // M6: Restore pending lightbox item from URL (boot / popstate)
    if (_pendingItem) {
      const mid = _pendingItem;
      _pendingItem = null;
      const midx = S.media.findIndex(f => f.id === mid);
      if (midx >= 0) openLb(midx);
    }
    // M8: trigger AI tagging if enabled
    if (_aiEnabled) {
      if (_aiModel && !_aiRunning) startAiTagging();
      else if (!_aiLoading) enableAiTagging();
    }
    // M15: update contributors panel when in event mode
    if (S.eventMode) renderContributorsPanel(S.files);
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
    // M15: curation states
    const isHidden   = S.hiddenFiles.has(file.id);
    const isFeatured = S.featuredFiles.includes(file.id);

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
      <div class="card ${t==='folder'?'card-folder':''} ${selected?'selected':''} ${hidden?'group-hidden':''} ${isHidden?'card-hidden':''} ${isFeatured?'card-featured':''}"
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
          ${isFeatured && t !== 'folder' ? `<div class="featured-badge">★</div>` : ''}
          ${isHidden && t !== 'folder' ? `<div class="hidden-overlay"><div class="hidden-overlay-label">Hidden</div></div>` : ''}
        </div>
        <div class="card-body">
          <div class="card-name" title="${esc(file.name)}">${esc(file.name)}</div>
          <div class="card-meta">
            <span class="card-date">${fmtDate(file.modifiedTime)}</span>
            <span class="card-size">${fmtSize(file.size)}</span>
          </div>
          ${_aiEnabled && t !== 'folder' ? `<div class="ai-tags">${
            (_aiTags[file.id] || []).slice(0, AI_SHOW_TAGS)
              .map(tag => `<span class="ai-tag">${esc(tag)}</span>`).join('')
          }</div>` : ''}
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
    // M10: timeline view mode takes priority
    if (S.viewMode === 'timeline') {
      renderTimeline();
      return;
    }

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
    syncUrl(); // M6: add ?item= param to URL
    postParent('lightbox:open', { fileId: S.media[idx]?.id, fileName: S.media[idx]?.name }); // M9
  }

  function closeLb() {
    D.lb.classList.add('hidden');
    document.body.style.overflow = '';
    D.lbBody.innerHTML = '';
    S.lbIdx = -1;
    syncUrl(); // M6: remove ?item= param from URL
    postParent('lightbox:close', {}); // M9
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
    // M14: show live button in event mode
    if (D.ssLiveBtn) D.ssLiveBtn.classList.toggle('hidden', !S.eventMode);
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
     TIMELINE VIEW (M10)
  ───────────────────────────────────────── */
  let _tlObserver = null; // IntersectionObserver for minimap

  // Build a single square card for the timeline strip
  function buildTlCard(file) {
    const t    = fileType(file.mimeType);
    const midx = S.media.findIndex(f => f.id === file.id);
    const thumb = thumbUrl(file, t);
    const faved = isFav(file.id);

    if (t === 'folder') {
      return `<div class="tl-card tl-file-card" tabindex="0" role="button"
                   data-id="${esc(file.id)}" data-type="folder" data-fname="${esc(file.name)}">
        <div class="tl-file-icon">${typeIcon('folder')}</div>
        <span class="tl-file-name" title="${esc(file.name)}">${esc(file.name)}</span>
      </div>`;
    }

    if (thumb) {
      return `<div class="tl-card" tabindex="0" role="button"
                   data-id="${esc(file.id)}" data-type="${t}" data-midx="${midx}">
        <img src="${esc(thumb)}" alt="${esc(file.name)}" loading="lazy"
             onerror="this.style.display='none'">
        ${t === 'video' ? `<div class="tl-play-badge">
          <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="white">
            <polygon points="5 3 19 12 5 21 5 3"/>
          </svg></div>` : ''}
        <div class="tl-card-overlay">
          <span class="tl-card-name">${esc(file.name)}</span>
        </div>
        <button class="fav-btn ${faved ? 'faved' : ''}"
                data-fid="${esc(file.id)}"
                aria-label="${faved ? 'Remove from favorites' : 'Add to favorites'}"
                title="${faved ? 'Remove from favorites' : 'Add to favorites'}">
          <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24"
               stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/>
          </svg>
        </button>
      </div>`;
    }

    // No thumbnail — icon card
    return `<div class="tl-card tl-file-card" tabindex="0" role="button"
                 data-id="${esc(file.id)}" data-type="${t}" data-midx="${midx}"
                 data-fname="${t === 'folder' ? esc(file.name) : ''}">
      <div class="tl-file-icon">${typeIcon(t)}</div>
      <span class="tl-file-name" title="${esc(file.name)}">${esc(file.name)}</span>
    </div>`;
  }

  // Build the fixed right-side year minimap for timeline view
  function buildTlMinimap(years) {
    if (!D.tlMinimap) return;
    if (_tlObserver) { _tlObserver.disconnect(); _tlObserver = null; }
    if (!years.length) { D.tlMinimap.classList.add('hidden'); return; }

    D.tlMinimap.innerHTML =
      `<div class="tl-mm-track"></div>` +
      years.map(y =>
        `<div class="tl-mm-item" data-year="${esc(y)}">
           <span class="tl-mm-label">${esc(y)}</span>
           <div class="tl-mm-dot"></div>
         </div>`
      ).join('');
    D.tlMinimap.classList.remove('hidden');

    // Highlight the minimap item whose year banner is in view
    _tlObserver = new IntersectionObserver(entries => {
      for (const entry of entries) {
        const year    = entry.target.dataset.year;
        const mmItem  = D.tlMinimap.querySelector(`.tl-mm-item[data-year="${year}"]`);
        if (mmItem) mmItem.classList.toggle('active', entry.isIntersecting);
      }
    }, { rootMargin: '-62px 0px -50% 0px', threshold: 0 });

    document.querySelectorAll('.tl-year-sep').forEach(sep => _tlObserver.observe(sep));

    // Click → smooth scroll to year banner
    D.tlMinimap.querySelectorAll('.tl-mm-item').forEach(item => {
      item.addEventListener('click', () => {
        const sep = document.getElementById(`tl-year-${item.dataset.year}`);
        if (sep) sep.scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
    });
  }

  // Main timeline renderer — replaces the grid when viewMode === 'timeline'
  function renderTimeline() {
    buildDateNav([]); // hide the M5 date-nav sidebar when timeline is active
    D.grid.classList.remove('grid-timeline');

    const groups = groupFiles(S.filtered); // grouped newest-first by month

    if (!groups.length) {
      D.grid.innerHTML = `<div class="state-msg" style="grid-column:1/-1">
        <div class="icon">${S.search ? '◻' : S.filter === 'favorites' ? '♡' : '◻'}</div>
        <h3>${S.search ? 'No matches' : S.filter === 'favorites' ? 'No favorites in this folder' : 'Empty folder'}</h3>
        <p>${S.search
          ? `No files match "<em>${esc(S.search)}</em>"`
          : S.filter === 'favorites'
            ? 'Hover a card and tap ♡ to save favorites — they persist across sessions.'
            : 'This folder contains no files.'
        }</p>
      </div>`;
      buildTlMinimap([]);
      return;
    }

    // Collect unique years for the minimap
    const years = [...new Set(groups.map(g => g.key.split('-')[0]))];

    let html = '<div class="timeline-wrap">';
    let lastYear = null;

    for (const grp of groups) {
      const year = grp.key.split('-')[0];

      // Year separator banner
      if (year !== lastYear) {
        html += `<div class="tl-year-sep" id="tl-year-${esc(year)}" data-year="${esc(year)}">
          <span class="tl-year-sep-label">${esc(year)}</span>
        </div>`;
        lastYear = year;
      }

      // Month section
      html += `<div class="tl-section" id="tl-group-${esc(grp.key)}" data-gkey="${esc(grp.key)}">
        <div class="tl-section-hdr">
          <span class="tl-month-label">${esc(grp.label)}</span>
          <span class="tl-count">${grp.files.length} item${grp.files.length !== 1 ? 's' : ''}</span>
        </div>
        <div class="tl-strip">
          ${grp.files.map(f => buildTlCard(f)).join('')}
        </div>
      </div>`;
    }
    html += '</div>';
    D.grid.innerHTML = html;

    // Wire events on all tl-cards
    D.grid.querySelectorAll('.tl-card').forEach(card => {
      const { id, type, midx, fname } = card.dataset;
      const activate = () => {
        if (type === 'folder')                    browse(id, fname);
        else if (type === 'image' || type === 'video') openLb(+midx);
        else {
          const f = S.files.find(x => x.id === id);
          if (f?.webViewLink) window.open(f.webViewLink, '_blank', 'noopener,noreferrer');
        }
      };
      card.addEventListener('click', e => {
        if (e.target.closest('.fav-btn')) return; // handled separately
        activate();
      });
      card.addEventListener('keydown', e => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), activate()));

      const favBtn = card.querySelector('.fav-btn');
      if (favBtn) {
        favBtn.addEventListener('click', e => {
          e.stopPropagation();
          toggleFav(favBtn.dataset.fid, favBtn);
        });
      }
    });

    buildTlMinimap(years);
  }

  // Switch between grid and timeline view modes
  function setViewMode(mode) {
    S.viewMode = mode;
    try { localStorage.setItem(LS_VIEW_MODE, mode); } catch {}
    D.viewGridBtn.classList.toggle('active', mode === 'grid');
    D.viewTimelineBtn.classList.toggle('active', mode === 'timeline');
    // Print button only visible in timeline mode
    D.printBtn.classList.toggle('hidden', mode !== 'timeline');
    // Re-render with new view mode
    renderGrid();
  }

  /* ─────────────────────────────────────────
     EMBED WIDGET (M9)
  ───────────────────────────────────────── */
  function buildEmbedSrc() {
    // Build the iframe src: current page URL with ?embed=1 + current folder/filter/sort state
    const p = new URLSearchParams();
    const folderId = S.stack.at(-1)?.id;
    if (folderId) p.set('folder', folderId);
    if (S.filter && S.filter !== 'all') p.set('filter', S.filter);
    if (S.sort   && S.sort   !== 'name-asc') p.set('sort', S.sort);
    if (S.search) p.set('q', S.search);
    p.set('embed', '1');
    return location.origin + location.pathname + '?' + p.toString();
  }

  function generateEmbedSnippet() {
    const src    = buildEmbedSrc();
    const width  = (D.embedWidth.value.trim()  || '100%');
    const height = (D.embedHeight.value.trim() || '600px');
    return `<iframe\n  src="${src}"\n  width="${width}"\n  height="${height}"\n  frameborder="0"\n  allowfullscreen\n  loading="lazy"\n  style="border:0;border-radius:8px;display:block"\n></iframe>`;
  }

  function refreshEmbedCode() {
    D.embedCode.textContent = generateEmbedSnippet();
  }

  function openEmbedModal() {
    refreshEmbedCode();
    D.embedModal.classList.remove('hidden');
    document.body.style.overflow = 'hidden';
  }

  function closeEmbedModal() {
    D.embedModal.classList.add('hidden');
    document.body.style.overflow = '';
  }

  /* ─────────────────────────────────────────
     PRICING & ONBOARDING (M11)
  ───────────────────────────────────────── */
  const TAGLINES = [
    'Your Drive folder, beautifully presented.',
    'Browse photos + videos like a pro.',
    'Share memories, not Drive links.',
    'Instant gallery — no upload needed.',
    'Your media, developed.',
  ];
  let _taglineIdx = 0;
  let _taglineTimer = null;

  function startTaglineCycle() {
    if (!D.taglineCycle) return;
    D.taglineCycle.textContent = TAGLINES[0];
    _taglineTimer = setInterval(() => {
      D.taglineCycle.classList.add('tagline-out');
      setTimeout(() => {
        _taglineIdx = (_taglineIdx + 1) % TAGLINES.length;
        D.taglineCycle.textContent = TAGLINES[_taglineIdx];
        D.taglineCycle.classList.remove('tagline-out');
      }, 370); // slightly longer than the CSS transition
    }, 3500);
  }

  /* ─────────────────────────────────────────
     PASSWORD PROTECTION (M12)
  ───────────────────────────────────────── */
  async function hashPassword(pw) {
    const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(pw));
    return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
  }

  function showLockGate() {
    D.lockOverlay.classList.remove('hidden');
    D.lockInput.value = '';
    D.lockError.classList.add('hidden');
    document.body.style.overflow = 'hidden';
    setTimeout(() => D.lockInput.focus(), 50);
  }

  function dismissLockGate() {
    D.lockOverlay.classList.add('hidden');
    document.body.style.overflow = '';
  }

  async function tryUnlock() {
    const pw = D.lockInput.value;
    if (!pw) return;
    const hash = await hashPassword(pw);
    if (hash === S.lockHash) {
      dismissLockGate();
      // Now proceed to browse the folder from the URL
      const bp = new URLSearchParams(location.search);
      const folderId = bp.get('folder');
      if (folderId) { D.input.value = folderId; S.stack = []; browse(folderId); }
    } else {
      D.lockError.classList.remove('hidden');
      D.lockCard && D.lockCard.classList.remove('lock-shake');
      // Trigger shake on the card
      const card = D.lockOverlay.querySelector('.lock-card');
      if (card) {
        card.classList.remove('lock-shake');
        void card.offsetWidth; // reflow to restart animation
        card.classList.add('lock-shake');
      }
      D.lockInput.select();
    }
  }

  function openProtectModal() {
    D.protectInput.value = '';
    D.protectLinkRow.classList.add('hidden');
    D.protectModal.classList.remove('hidden');
    document.body.style.overflow = 'hidden';
    setTimeout(() => D.protectInput.focus(), 50);
  }

  function closeProtectModal() {
    D.protectModal.classList.add('hidden');
    document.body.style.overflow = '';
  }

  async function generateProtectedLink() {
    const pw = D.protectInput.value.trim();
    if (!pw) { D.protectInput.focus(); return; }
    const hash = await hashPassword(pw);
    S.lockHash = hash;
    // Build URL with ?lock= param preserving current state
    const p = new URLSearchParams();
    const folderId = S.stack.at(-1)?.id;
    if (folderId) p.set('folder', folderId);
    if (S.filter && S.filter !== 'all') p.set('filter', S.filter);
    if (S.sort   && S.sort   !== 'name-asc') p.set('sort', S.sort);
    if (S.search) p.set('q', S.search);
    p.set('lock', hash);
    const url = location.origin + location.pathname + '?' + p.toString();
    D.protectLink.value = url;
    D.protectLinkRow.classList.remove('hidden');
    D.protectLink.select();
  }

  /* ─────────────────────────────────────────
     POSTMESSAGE (M9 — optional)
  ───────────────────────────────────────── */
  function postParent(type, data) {
    if (!_isEmbed) return;
    try {
      window.parent.postMessage({ source: 'darkroom', type, ...data }, '*');
    } catch { /* cross-origin parent may block */ }
  }

  /* ─────────────────────────────────────────
     M13 — EVENT CRUD (localStorage)
  ───────────────────────────────────────── */
  function loadEvents() {
    try {
      const raw = localStorage.getItem(LS_EVENTS);
      S.events = raw ? JSON.parse(raw) : [];
    } catch { S.events = []; }
    return S.events;
  }

  function saveEvents() {
    try { localStorage.setItem(LS_EVENTS, JSON.stringify(S.events)); } catch {}
  }

  function findEventByFolderId(folderId) {
    return S.events.find(e => e.folderId === folderId) || null;
  }

  function deleteEventById(eventId) {
    S.events = S.events.filter(e => e.id !== eventId);
    saveEvents();
    renderEventDashboard();
  }

  /* ─────────────────────────────────────────
     M13 — HOST WRITE OAUTH (drive.file)
  ───────────────────────────────────────── */
  function isHostWriteSignedIn() {
    return !!_hostWriteToken && Date.now() < _hostWriteExpiry;
  }

  function hostWriteHeaders() {
    return isHostWriteSignedIn() ? { Authorization: `Bearer ${_hostWriteToken}` } : {};
  }

  function initHostWriteClient(clientId, callback) {
    if (!clientId || !window.google?.accounts?.oauth2) return false;
    try {
      _hostWriteClient = window.google.accounts.oauth2.initTokenClient({
        client_id: clientId,
        scope: GIS_WRITE_SCOPE,
        callback,
      });
      return true;
    } catch { return false; }
  }

  function requestHostWriteToken() {
    return new Promise(async (resolve, reject) => {
      const clientId = getClientId();
      if (!clientId) { reject(new Error('No Client ID — add one in Settings')); return; }
      try { await loadGISScript(); } catch { reject(new Error('Could not load Google auth')); return; }
      if (!initHostWriteClient(clientId, resp => {
        if (resp.error) { reject(new Error('Auth failed: ' + resp.error)); return; }
        _hostWriteToken  = resp.access_token;
        _hostWriteExpiry = Date.now() + (resp.expires_in * 1000);
        resolve(_hostWriteToken);
      })) { reject(new Error('OAuth init failed — check Client ID')); return; }
      _hostWriteClient.requestAccessToken({ prompt: '' });
    });
  }

  /* ─────────────────────────────────────────
     M13 — DRIVE WRITE OPERATIONS
  ───────────────────────────────────────── */
  async function createDriveFolder(name) {
    const r = await fetch('https://www.googleapis.com/drive/v3/files', {
      method: 'POST',
      headers: { ...hostWriteHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, mimeType: 'application/vnd.google-apps.folder' }),
    });
    if (!r.ok) {
      const e = await r.json().catch(()=>({}));
      throw new Error(e?.error?.message || `HTTP ${r.status}`);
    }
    return (await r.json()).id; // returns folder ID
  }

  async function setFolderPublicEditable(folderId) {
    const r = await fetch(`https://www.googleapis.com/drive/v3/files/${folderId}/permissions`, {
      method: 'POST',
      headers: { ...hostWriteHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ role: 'writer', type: 'anyone' }),
    });
    if (!r.ok) {
      const e = await r.json().catch(()=>({}));
      throw new Error(e?.error?.message || `HTTP ${r.status}`);
    }
    return (await r.json()).id; // returns permission ID
  }

  async function revokeFolderPermission(folderId, permissionId) {
    const r = await fetch(
      `https://www.googleapis.com/drive/v3/files/${folderId}/permissions/${permissionId}`,
      { method: 'DELETE', headers: hostWriteHeaders() }
    );
    return r.ok;
  }

  async function getDrivePhotoCount(folderId) {
    // Use host write token if available, else fall back to M7 token or API key
    const headers = isHostWriteSignedIn() ? hostWriteHeaders()
                  : isSignedIn()          ? authHeaders()
                  : {};
    const p = new URLSearchParams({
      q: `'${folderId}' in parents and trashed=false and mimeType!='application/vnd.google-apps.folder'`,
      fields: 'files(id)',
      pageSize: 100,
    });
    if (!isHostWriteSignedIn() && !isSignedIn() && getApiKey()) p.set('key', getApiKey());
    try {
      const r = await fetch(`${API_BASE}?${p}`, { headers });
      if (!r.ok) return null;
      const { files, nextPageToken } = await r.json();
      return nextPageToken ? `${files.length}+` : String(files.length);
    } catch { return null; }
  }

  /* ─────────────────────────────────────────
     M13 — CREATE EVENT FLOW
  ───────────────────────────────────────── */
  function openEventCreateModal() {
    D.eventCreateModal.classList.remove('hidden');
    D.eventCreateNote.textContent = '';
    D.eventCreateBtn.disabled = false;
    D.eventCreateLabel.textContent = 'Create Event';
    D.eventCreateSpinner.classList.add('hidden');
    // Default date to today
    if (!D.eventDateInput.value) {
      D.eventDateInput.value = new Date().toISOString().slice(0, 10);
    }
    D.eventNameInput.focus();
    document.body.style.overflow = 'hidden';
  }

  function closeEventCreateModal() {
    D.eventCreateModal.classList.add('hidden');
    document.body.style.overflow = '';
  }

  async function submitCreateEvent() {
    const name = D.eventNameInput.value.trim();
    if (!name) { D.eventNameInput.focus(); return; }

    D.eventCreateBtn.disabled = true;
    D.eventCreateLabel.textContent = 'Signing in…';
    D.eventCreateSpinner.classList.remove('hidden');
    D.eventCreateNote.textContent = '';

    try {
      // Ensure we have a write token
      if (!isHostWriteSignedIn()) {
        D.eventCreateNote.textContent = 'A Google sign-in popup will appear…';
        await requestHostWriteToken();
      }
      D.eventCreateLabel.textContent = 'Creating folder…';

      const eventName = name;
      const eventDate = D.eventDateInput.value || new Date().toISOString().slice(0, 10);
      const coverStyle = _selectedCoverStyle;

      // Create folder in Drive
      const folderId = await createDriveFolder(eventName);
      D.eventCreateLabel.textContent = 'Setting permissions…';

      // Make public-editable
      let permissionId = null;
      try {
        permissionId = await setFolderPublicEditable(folderId);
      } catch (e) {
        // Permission might fail with drive.file scope — event still created, just not public
        console.warn('Could not set public permission:', e.message);
      }

      // Save event
      const event = {
        id:           crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36),
        name:         eventName,
        date:         eventDate,
        folderId,
        coverStyle,
        permissionId,
        createdAt:    new Date().toISOString(),
        uploadsOpen:  !!permissionId,
      };
      loadEvents();
      S.events.unshift(event);
      saveEvents();

      closeEventCreateModal();
      D.eventNameInput.value = '';
      D.eventDateInput.value = '';

      renderEventDashboard();
      openQRModal(event);

    } catch (err) {
      D.eventCreateNote.textContent = err.message;
      D.eventCreateBtn.disabled = false;
      D.eventCreateLabel.textContent = 'Create Event';
      D.eventCreateSpinner.classList.add('hidden');
    }
  }

  async function closeEventUploads(event) {
    if (!event.permissionId) { showToast('Uploads already closed'); return; }
    if (!isHostWriteSignedIn()) {
      try { await requestHostWriteToken(); }
      catch { showToast('Sign-in required to close uploads'); return; }
    }
    const ok = await revokeFolderPermission(event.folderId, event.permissionId);
    if (ok) {
      event.permissionId = null;
      event.uploadsOpen = false;
      saveEvents();
      renderEventDashboard();
      showToast('Upload link deactivated');
    } else {
      showToast('Could not close uploads — try again');
    }
  }

  /* ─────────────────────────────────────────
     M13 — EVENT DASHBOARD RENDER
  ───────────────────────────────────────── */
  function buildUploadUrl(folderId) {
    return location.origin + location.pathname + `?event=${encodeURIComponent(folderId)}&upload=1`;
  }

  function buildGalleryUrl(folderId) {
    return location.origin + location.pathname + `?event=${encodeURIComponent(folderId)}&view=guest`;
  }

  function buildThanksUrl(folderId) {
    return location.origin + location.pathname + `?event=${encodeURIComponent(folderId)}&view=thanks`;
  }

  async function renderEventDashboard() {
    loadEvents();
    // Show event dashboard if signed in (host write or M7 read)
    const showDash = isSignedIn() || isHostWriteSignedIn();
    if (!D.eventDashboard) return;
    D.eventDashboard.classList.toggle('hidden', !showDash || S.events.length === 0);
    if (!D.eventList) return;

    if (!S.events.length) {
      D.eventList.innerHTML = '';
      return;
    }

    // Render event cards (counts loaded async)
    D.eventList.innerHTML = S.events.map(e => buildEventCardHtml(e, null)).join('');
    // Attach actions
    wireEventCards();
    // Load photo counts async
    for (const ev of S.events) {
      const count = await getDrivePhotoCount(ev.folderId);
      const countEl = D.eventList.querySelector(`.event-card[data-id="${esc(ev.id)}"] .event-card-count`);
      if (countEl && count !== null) countEl.textContent = `${count} photos`;
    }
  }

  function buildEventCardHtml(event, count) {
    const dateStr = event.date
      ? new Date(event.date + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
      : '—';
    const countStr = count !== null ? `${count} photos` : 'Loading…';
    return `
      <div class="event-card" data-id="${esc(event.id)}" data-style="${esc(event.coverStyle)}">
        <div class="event-card-accent"></div>
        <div class="event-card-body">
          <div class="event-card-name" title="${esc(event.name)}">${esc(event.name)}</div>
          <div class="event-card-meta">
            <span>${esc(dateStr)}</span>
            <span class="event-card-count">${esc(countStr)}</span>
          </div>
          <div class="event-card-actions">
            <button class="event-card-action primary" data-action="gallery">View Gallery</button>
            <button class="event-card-action" data-action="qr">Share QR</button>
            <button class="event-card-action" data-action="close-uploads">${event.uploadsOpen ? 'Close Uploads' : 'Uploads Closed'}</button>
            <button class="event-card-action danger" data-action="delete">Delete</button>
          </div>
        </div>
      </div>`;
  }

  function wireEventCards() {
    if (!D.eventList) return;
    D.eventList.querySelectorAll('.event-card').forEach(card => {
      const eventId = card.dataset.id;
      const event = S.events.find(e => e.id === eventId);
      if (!event) return;
      card.querySelectorAll('.event-card-action').forEach(btn => {
        btn.addEventListener('click', () => {
          const action = btn.dataset.action;
          if (action === 'gallery') {
            // Browse in event mode
            S.eventMode = true;
            S.currentEvent = event;
            S.hostMode = true;
            loadEventGallery(event);
          } else if (action === 'qr') {
            openQRModal(event);
          } else if (action === 'close-uploads') {
            if (event.uploadsOpen) closeEventUploads(event);
          } else if (action === 'delete') {
            if (confirm(`Delete event "${event.name}"? This only removes it from Darkroom — the Drive folder is not deleted.`)) {
              deleteEventById(eventId);
            }
          }
        });
      });
    });
  }

  async function loadEventGallery(event) {
    D.landing.classList.add('hidden');
    D.gallery.classList.remove('hidden');
    D.copyLinkBtn.classList.remove('hidden');
    if (!_isEmbed) D.embedBtn.classList.remove('hidden');
    // Show curation bar for host
    if (S.hostMode && D.curationBar) D.curationBar.classList.remove('hidden');
    // Show live controls (M14)
    if (D.refreshBtn) D.refreshBtn.classList.remove('hidden');
    if (D.pollIntervalSel) D.pollIntervalSel.classList.remove('hidden');
    S.stack = [];
    loadCuration(event.folderId);
    await browse(event.folderId, event.name);
    startPolling(event.folderId);
  }

  /* ─────────────────────────────────────────
     M13 — QR GENERATION
  ───────────────────────────────────────── */
  function loadQRScript() {
    return new Promise((resolve, reject) => {
      if (_qrLibLoaded && window.qrcode) { resolve(); return; }
      const s = document.createElement('script');
      s.src = QR_CDN;
      s.onload  = () => { _qrLibLoaded = true; resolve(); };
      s.onerror = () => reject(new Error('Could not load QR library'));
      document.head.appendChild(s);
    });
  }

  function generateQRCanvas(text) {
    // qrcode-generator API
    const qr = window.qrcode(0, 'M');
    qr.addData(text);
    qr.make();
    // Render to a canvas
    const size = 180;
    const canvas = document.createElement('canvas');
    const cellSize = Math.floor(size / qr.getModuleCount());
    const actualSize = cellSize * qr.getModuleCount();
    canvas.width  = actualSize;
    canvas.height = actualSize;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, actualSize, actualSize);
    ctx.fillStyle = '#000000';
    for (let r = 0; r < qr.getModuleCount(); r++) {
      for (let c = 0; c < qr.getModuleCount(); c++) {
        if (qr.isDark(r, c)) {
          ctx.fillRect(c * cellSize, r * cellSize, cellSize, cellSize);
        }
      }
    }
    return canvas;
  }

  async function openQRModal(event) {
    _currentQREvent = event;
    _currentQRTab   = 'upload';
    D.qrEventName.textContent = event.name;
    D.qrTabUpload.classList.add('active');
    D.qrTabGallery.classList.remove('active');
    D.qrShareModal.classList.remove('hidden');
    document.body.style.overflow = 'hidden';
    renderQRTab();
  }

  async function renderQRTab() {
    if (!_currentQREvent) return;
    const isUploadTab = _currentQRTab === 'upload';
    const url = isUploadTab
      ? buildUploadUrl(_currentQREvent.folderId)
      : buildGalleryUrl(_currentQREvent.folderId);

    D.qrHint.textContent = isUploadTab
      ? 'Guests scan this code to upload photos'
      : 'Share this link for read-only gallery access';
    D.qrUrlInput.value = url;
    D.qrCanvasWrap.innerHTML = '';

    try {
      await loadQRScript();
      const canvas = generateQRCanvas(url);
      D.qrCanvasWrap.appendChild(canvas);
    } catch {
      D.qrCanvasWrap.innerHTML = `<div style="font-size:.75rem;color:#888;padding:1rem">QR unavailable</div>`;
    }
  }

  function closeQRModal() {
    D.qrShareModal.classList.add('hidden');
    document.body.style.overflow = '';
    _currentQREvent = null;
  }

  function downloadQRImage() {
    const canvas = D.qrCanvasWrap.querySelector('canvas');
    if (!canvas) { showToast('No QR code to download'); return; }
    const a = document.createElement('a');
    a.download = `darkroom-qr-${_currentQREvent?.name || 'event'}.png`;
    a.href = canvas.toDataURL('image/png');
    a.click();
  }

  function shareWhatsApp(url, eventName) {
    const text = encodeURIComponent(`📸 Upload your photos to "${eventName}": ${url}`);
    window.open(`https://wa.me/?text=${text}`, '_blank', 'noopener,noreferrer');
  }

  function shareEmail(url, eventName) {
    const subject = encodeURIComponent(`Upload your photos — ${eventName}`);
    const body    = encodeURIComponent(`Hi!\n\nPlease upload your photos from ${eventName} using this link:\n\n${url}\n\nThank you!`);
    window.open(`mailto:?subject=${subject}&body=${body}`, '_self');
  }

  /* ─────────────────────────────────────────
     M13 — GUEST UPLOAD OAUTH (drive.file)
  ───────────────────────────────────────── */
  function isGuestSignedIn() {
    return !!_guestToken && Date.now() < _guestExpiry;
  }

  function initGuestClient(clientId, callback) {
    if (!clientId || !window.google?.accounts?.oauth2) return false;
    try {
      _guestClient = window.google.accounts.oauth2.initTokenClient({
        client_id: clientId,
        scope: DRIVE_FILE_SCOPE,
        callback,
      });
      return true;
    } catch { return false; }
  }

  async function guestSignIn() {
    const clientId = getClientId();
    if (!clientId) {
      showToast('This event upload is not configured (missing Client ID)');
      return;
    }
    try { await loadGISScript(); } catch {
      showToast('Could not load Google auth library');
      return;
    }
    if (!initGuestClient(clientId, resp => {
      if (resp.error) { showToast('Sign-in failed: ' + resp.error); return; }
      _guestToken  = resp.access_token;
      _guestExpiry = Date.now() + (resp.expires_in * 1000);
      // Show upload UI
      if (D.uploadAuthPrompt) D.uploadAuthPrompt.classList.add('hidden');
      if (D.uploadUi) D.uploadUi.classList.remove('hidden');
    })) {
      showToast('Auth init failed — check Client ID in Settings');
      return;
    }
    _guestClient.requestAccessToken({ prompt: '' });
  }

  /* ─────────────────────────────────────────
     M13 — UPLOAD PAGE RENDER
  ───────────────────────────────────────── */
  async function renderUploadPage(folderId) {
    S.uploadMode = true;
    // Hide everything else
    document.body.classList.add('upload-mode');
    if (D.landing) D.landing.classList.add('hidden');
    if (D.gallery) D.gallery.classList.add('hidden');
    const header = document.querySelector('header');
    if (header) header.classList.add('hidden');

    if (!D.uploadPage) return;
    D.uploadPage.classList.remove('hidden');

    // Try to find event metadata from localStorage
    loadEvents();
    let event = findEventByFolderId(folderId);

    if (event) {
      D.uploadEventName.textContent = event.name;
      D.uploadHeader.dataset.style  = event.coverStyle || 'warm-gold';
      if (event.date) {
        D.uploadEventDate.textContent = new Date(event.date + 'T12:00:00').toLocaleDateString(
          'en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' }
        );
      }
    } else {
      // Fallback: try to fetch folder name
      try {
        const name = await apiFolderName(folderId);
        D.uploadEventName.textContent = name;
      } catch { D.uploadEventName.textContent = 'Photo Upload'; }
    }

    // Load photo count
    const count = await getDrivePhotoCount(folderId);
    if (D.uploadCount) {
      D.uploadCount.textContent = count !== null ? `${count} photos already collected` : '';
    }

    // Store folder ID for upload
    D.uploadPage.dataset.folderId = folderId;
  }

  function startFileUpload() {
    if (!isGuestSignedIn()) return;
    const files = Array.from(D.filePicker.files);
    if (!files.length) return;
    const folderId = D.uploadPage.dataset.folderId;
    const guestName = D.guestName.value.trim() || 'Guest';
    uploadFiles(files, folderId, guestName);
    // Reset picker so same file can be re-selected
    D.filePicker.value = '';
  }

  function uploadFiles(files, folderId, guestName) {
    // Show done message if already showing, reset it
    if (D.uploadDoneMsg) D.uploadDoneMsg.classList.add('hidden');

    files.forEach(file => {
      if (file.size > UPLOAD_MAX_MB * 1024 * 1024) {
        showToast(`"${file.name}" exceeds ${UPLOAD_MAX_MB} MB limit`);
        return;
      }
      const itemEl = buildUploadItemEl(file);
      D.uploadList.insertBefore(itemEl, D.uploadList.firstChild);
      uploadSingleFile(file, folderId, guestName, itemEl);
    });
  }

  function buildUploadItemEl(file) {
    const div = document.createElement('div');
    div.className = 'upload-item';
    const isImage = file.type.startsWith('image/');
    div.innerHTML = `
      <div class="upload-item-icon">${isImage ? '🖼' : '🎥'}</div>
      <div class="upload-item-info">
        <div class="upload-item-name">${esc(file.name)}</div>
        <div class="upload-item-track"><div class="upload-item-bar"></div></div>
      </div>
      <div class="upload-item-status">0%</div>`;
    return div;
  }

  function uploadSingleFile(file, folderId, guestName, itemEl) {
    const bar    = itemEl.querySelector('.upload-item-bar');
    const status = itemEl.querySelector('.upload-item-status');

    const metadata = {
      name:        file.name,
      parents:     [folderId],
      description: guestName,
    };

    const formData = new FormData();
    formData.append('metadata', new Blob([JSON.stringify(metadata)], { type: 'application/json' }));
    formData.append('file', file);

    const xhr = new XMLHttpRequest();
    xhr.open('POST', 'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id');
    xhr.setRequestHeader('Authorization', `Bearer ${_guestToken}`);

    xhr.upload.onprogress = e => {
      if (e.lengthComputable) {
        const pct = Math.round((e.loaded / e.total) * 100);
        bar.style.width = pct + '%';
        status.textContent = pct + '%';
      }
    };

    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        itemEl.classList.add('done');
        bar.style.width = '100%';
        status.textContent = '✓';
        checkAllUploadsComplete();
      } else {
        itemEl.classList.add('error');
        status.textContent = '✗';
        showToast(`Upload failed: ${file.name}`);
      }
    };

    xhr.onerror = () => {
      itemEl.classList.add('error');
      status.textContent = '✗';
      showToast(`Upload error: ${file.name}`);
    };

    xhr.send(formData);
  }

  function checkAllUploadsComplete() {
    const items = D.uploadList.querySelectorAll('.upload-item');
    const allDone = [...items].every(el => el.classList.contains('done') || el.classList.contains('error'));
    const anyDone = [...items].some(el => el.classList.contains('done'));
    if (allDone && anyDone && D.uploadDoneMsg) {
      D.uploadDoneMsg.classList.remove('hidden');
      // Update count
      getDrivePhotoCount(D.uploadPage.dataset.folderId).then(count => {
        if (count && D.uploadCount) D.uploadCount.textContent = `${count} photos collected`;
      });
    }
  }

  /* ─────────────────────────────────────────
     M14 — LIVE POLLING
  ───────────────────────────────────────── */
  function startPolling(folderId) {
    stopPolling();
    S.pollTimer = setInterval(async () => {
      if (document.visibilityState === 'hidden') return;
      await pollForNewFiles(folderId);
    }, S.pollInterval);

    document.addEventListener('visibilitychange', _handlePollVisibility);
  }

  function stopPolling() {
    if (S.pollTimer) { clearInterval(S.pollTimer); S.pollTimer = null; }
    document.removeEventListener('visibilitychange', _handlePollVisibility);
  }

  function _handlePollVisibility() {
    // Restart poll on tab becoming visible
    if (document.visibilityState === 'visible' && S.eventMode) {
      const folderId = S.stack.at(-1)?.id;
      if (folderId) pollForNewFiles(folderId);
    }
  }

  async function pollForNewFiles(folderId) {
    if (!folderId || S.loading) return;
    try {
      const p = new URLSearchParams({
        q: `'${folderId}' in parents and trashed=false`,
        fields: 'files(id,name,mimeType,size,modifiedTime,thumbnailLink,webViewLink,webContentLink,description)',
        pageSize: 100,
        orderBy: 'folder,name',
      });
      const headers = isHostWriteSignedIn() ? hostWriteHeaders()
                    : isSignedIn()          ? authHeaders()
                    : {};
      if (!isHostWriteSignedIn() && !isSignedIn() && getApiKey()) p.set('key', getApiKey());
      const r = await fetch(`${API_BASE}?${p}`, { headers });
      if (!r.ok) return;
      const { files = [] } = await r.json();

      // Find files not in S.files
      const existingIds = new Set(S.files.map(f => f.id));
      const newFiles = files.filter(f => !existingIds.has(f.id));

      if (newFiles.length > 0) {
        S.files.unshift(...newFiles);
        injectNewCards(newFiles);
        showNewFilesToast(newFiles.length);
        // M14: live slideshow — append new media
        if (S.slideshowLive) {
          const newMedia = newFiles.filter(f => { const t = fileType(f.mimeType); return t==='image'||t==='video'; });
          if (newMedia.length) S.media.push(...newMedia);
        }
      }
    } catch { /* polling errors are silent */ }
  }

  function injectNewCards(newFiles) {
    // Prepend new cards to the grid with glow animation
    const newIds = new Set(newFiles.map(f => f.id));
    const html = newFiles.map((file, i) => buildCardHtml(file, i, '')).join('');
    const frag = document.createElement('template');
    frag.innerHTML = html;
    const newCards = [...frag.content.querySelectorAll('.card')];
    const firstCard = D.grid.querySelector('.card');
    newCards.forEach(card => {
      card.classList.add('card-new');
      if (firstCard) D.grid.insertBefore(card, firstCard);
      else D.grid.appendChild(card);
      // Remove card-new after animation completes
      card.addEventListener('animationend', () => card.classList.remove('card-new'), { once: true });
      // Wire events
      const { id, type, midx, fname } = card.dataset;
      const activate = () => {
        if (type === 'folder') browse(id, fname);
        else if (+midx >= 0) openLb(+midx);
      };
      card.addEventListener('click', e => {
        if (e.target.closest('.fav-btn') || e.target.closest('.card-check')) return;
        if (S.selectMode && type !== 'folder') { toggleSelect(id); return; }
        activate();
      });
      card.addEventListener('keydown', e => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), activate()));
      const favBtn = card.querySelector('.fav-btn');
      if (favBtn) favBtn.addEventListener('click', e => { e.stopPropagation(); toggleFav(favBtn.dataset.fid, favBtn); });
      const checkBtn = card.querySelector('.card-check');
      if (checkBtn) checkBtn.addEventListener('click', e => { e.stopPropagation(); toggleSelect(checkBtn.dataset.cid); });
    });
  }

  function showNewFilesToast(count) {
    showToast(`${count} new photo${count !== 1 ? 's' : ''} added`);
  }

  /* ─────────────────────────────────────────
     M14 — LIVE SLIDESHOW
  ───────────────────────────────────────── */
  function toggleSlideshowLive() {
    S.slideshowLive = !S.slideshowLive;
    if (D.ssLiveBtn) {
      D.ssLiveBtn.classList.toggle('live', S.slideshowLive);
      D.ssLiveBtn.title = S.slideshowLive ? 'LIVE: new uploads auto-added' : 'Enable live mode';
    }
    if (S.slideshowLive) showToast('Slideshow LIVE — new uploads will appear');
    else showToast('Slideshow live mode off');
  }

  /* ─────────────────────────────────────────
     M14 — STATS DISPLAY PAGE
  ───────────────────────────────────────── */
  async function renderStatsDisplay(folderId) {
    if (!D.statsDisplay) return;
    document.body.classList.add('upload-mode');
    const header = document.querySelector('header');
    if (header) header.classList.add('hidden');
    if (D.landing) D.landing.classList.add('hidden');
    if (D.gallery) D.gallery.classList.add('hidden');

    D.statsDisplay.classList.remove('hidden');

    loadEvents();
    const event = findEventByFolderId(folderId);
    if (D.statsDisplayName) D.statsDisplayName.textContent = event?.name || 'Photo Collection';

    // Load QR code
    const uploadUrl = buildUploadUrl(folderId);
    if (D.statsDisplayQr) {
      try {
        await loadQRScript();
        const canvas = generateQRCanvas(uploadUrl);
        canvas.style.maxWidth = '160px';
        D.statsDisplayQr.innerHTML = '';
        D.statsDisplayQr.appendChild(canvas);
      } catch { D.statsDisplayQr.style.display = 'none'; }
    }

    // Initial count
    const count = await getDrivePhotoCount(folderId);
    if (D.statsCounter && count !== null) {
      D.statsCounter.textContent = count.replace('+', '');
    }

    // Start polling
    startStatsPolling(folderId);
  }

  function startStatsPolling(folderId) {
    if (_statsPollingTimer) clearInterval(_statsPollingTimer);
    _statsPollingTimer = setInterval(async () => {
      if (document.visibilityState === 'hidden') return;
      const raw = await getDrivePhotoCount(folderId);
      if (raw === null || !D.statsCounter) return;
      const newCount = parseInt(raw) || 0;
      const oldCount = parseInt(D.statsCounter.textContent) || 0;
      if (newCount > oldCount) animateCounter(oldCount, newCount);
    }, 15000);
  }

  function animateCounter(from, to) {
    if (!D.statsCounter) return;
    const duration = 800;
    const start = performance.now();
    function step(now) {
      const t = Math.min((now - start) / duration, 1);
      const ease = t < .5 ? 2*t*t : -1+(4-2*t)*t;
      D.statsCounter.textContent = Math.round(from + (to - from) * ease);
      D.statsCounter.classList.toggle('tick', t > 0 && t < 1);
      if (t < 1) requestAnimationFrame(step);
    }
    requestAnimationFrame(step);
  }

  /* ─────────────────────────────────────────
     M15 — CURATION
  ───────────────────────────────────────── */
  let _curationMode = null; // null | 'hide' | 'feature'

  function loadCuration(folderId) {
    try {
      const raw = localStorage.getItem(LS_CURATION);
      const all = raw ? JSON.parse(raw) : {};
      const cur = all[folderId] || { hidden: [], featured: [] };
      S.hiddenFiles   = new Set(cur.hidden);
      S.featuredFiles = cur.featured || [];
    } catch { S.hiddenFiles = new Set(); S.featuredFiles = []; }
  }

  function saveCuration(folderId) {
    try {
      const raw = localStorage.getItem(LS_CURATION);
      const all = raw ? JSON.parse(raw) : {};
      all[folderId] = {
        hidden:   [...S.hiddenFiles],
        featured: S.featuredFiles,
      };
      localStorage.setItem(LS_CURATION, JSON.stringify(all));
    } catch {}
  }

  function toggleHideFile(fileId) {
    const folderId = S.currentEvent?.folderId;
    if (!folderId) return;
    if (S.hiddenFiles.has(fileId)) S.hiddenFiles.delete(fileId);
    else S.hiddenFiles.add(fileId);
    saveCuration(folderId);
    // Update card DOM
    const card = D.grid.querySelector(`.card[data-id="${fileId}"]`);
    if (card) card.classList.toggle('card-hidden', S.hiddenFiles.has(fileId));
  }

  function toggleFeatureFile(fileId) {
    const folderId = S.currentEvent?.folderId;
    if (!folderId) return;
    const idx = S.featuredFiles.indexOf(fileId);
    if (idx >= 0) S.featuredFiles.splice(idx, 1);
    else S.featuredFiles.push(fileId);
    saveCuration(folderId);
    // Update card DOM
    const card = D.grid.querySelector(`.card[data-id="${fileId}"]`);
    if (card) {
      card.classList.toggle('card-featured', idx < 0);
      let badge = card.querySelector('.featured-badge');
      if (idx < 0) {
        if (!badge) {
          badge = document.createElement('div');
          badge.className = 'featured-badge';
          badge.innerHTML = '★';
          card.querySelector('.card-thumb')?.appendChild(badge);
        }
      } else {
        badge?.remove();
      }
    }
  }

  function enterCurationMode(mode) {
    _curationMode = _curationMode === mode ? null : mode;
    if (D.curationHideBtn) D.curationHideBtn.classList.toggle('active', _curationMode === 'hide');
    if (D.curationFeatureBtn) D.curationFeatureBtn.classList.toggle('active', _curationMode === 'feature');
    if (_curationMode) showToast(`Click a photo to ${_curationMode} it`);
    else showToast('Curation mode off');
  }

  /* ─────────────────────────────────────────
     M15 — CONTRIBUTORS PANEL
  ───────────────────────────────────────── */
  function renderContributorsPanel(files) {
    if (!D.contributorsPanel) return;
    // Count per contributor (from file.description)
    const counts = new Map();
    files.forEach(f => {
      if (f.description) {
        counts.set(f.description, (counts.get(f.description) || 0) + 1);
      }
    });
    if (counts.size === 0) {
      D.contributorsPanel.classList.add('hidden');
      return;
    }
    D.contributorsPanel.classList.remove('hidden');
    const allActive = !S.contributorFilter;
    let html = `<button class="contributor-chip ${allActive ? 'active' : ''}" data-name="">All</button>`;
    for (const [name, count] of [...counts.entries()].sort((a,b) => b[1]-a[1])) {
      const active = S.contributorFilter === name;
      html += `<button class="contributor-chip ${active ? 'active' : ''}" data-name="${esc(name)}">${esc(name)} (${count})</button>`;
    }
    D.contributorsPanel.innerHTML = html;
    D.contributorsPanel.querySelectorAll('.contributor-chip').forEach(chip => {
      chip.addEventListener('click', () => {
        S.contributorFilter = chip.dataset.name;
        applyFilter();
      });
    });
  }

  /* ─────────────────────────────────────────
     M15 — GUEST VIEW & THANKS PAGE
  ───────────────────────────────────────── */
  async function renderGuestView(folderId) {
    S.guestView  = true;
    S.eventMode  = true;
    S.hostMode   = false;
    loadEvents();
    const event = findEventByFolderId(folderId);
    if (event) {
      S.currentEvent = event;
      loadCuration(folderId);
    }
    // Hide host controls
    if (D.curationBar) D.curationBar.classList.add('hidden');
    if (D.refreshBtn) D.refreshBtn.classList.add('hidden');
    if (D.pollIntervalSel) D.pollIntervalSel.classList.add('hidden');
    if (D.protectBtn) D.protectBtn.classList.add('hidden');
    if (D.embedBtn) D.embedBtn.classList.add('hidden');
    // Browse the folder
    D.landing.classList.add('hidden');
    D.gallery.classList.remove('hidden');
    D.copyLinkBtn.classList.remove('hidden');
    S.stack = [];
    await browse(folderId, event?.name || 'Gallery');
    // Add powered-by footer
    const powered = document.createElement('div');
    powered.className = 'powered-by';
    powered.innerHTML = 'Powered by <strong>Darkroom</strong>';
    D.gallery.appendChild(powered);
  }

  async function renderThanksPage(folderId) {
    if (!D.thanksPage) return;
    document.body.classList.add('upload-mode');
    const header = document.querySelector('header');
    if (header) header.classList.add('hidden');
    if (D.landing) D.landing.classList.add('hidden');
    if (D.gallery) D.gallery.classList.add('hidden');
    D.thanksPage.classList.remove('hidden');

    loadEvents();
    const event = findEventByFolderId(folderId);
    loadCuration(folderId);

    if (event) {
      D.thanksEventName.textContent = event.name;
      if (event.date) {
        D.thanksEventDate.textContent = new Date(event.date + 'T12:00:00').toLocaleDateString(
          'en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' }
        );
      }
    }

    // Load files to show stats + featured photos
    try {
      const p = new URLSearchParams({
        q: `'${folderId}' in parents and trashed=false`,
        fields: 'files(id,name,mimeType,thumbnailLink,description)',
        pageSize: 100,
      });
      if (getApiKey()) p.set('key', getApiKey());
      const r = await fetch(`${API_BASE}?${p}`, { headers: authHeaders() });
      if (!r.ok) throw new Error('Could not load photos');
      const { files = [] } = await r.json();

      const mediaFiles = files.filter(f => { const t=fileType(f.mimeType); return t==='image'||t==='video'; });
      const contributors = new Set(files.map(f=>f.description).filter(Boolean));

      if (D.thanksStats) {
        D.thanksStats.innerHTML = `We collected <strong>${mediaFiles.length}</strong> photos from <strong>${contributors.size || 1}</strong> contributor${contributors.size !== 1 ? 's' : ''}`;
      }

      // Show featured photos first, then others, up to 9
      const featuredMedia = S.featuredFiles
        .map(id => mediaFiles.find(f => f.id === id))
        .filter(Boolean);
      const otherMedia = mediaFiles.filter(f => !S.featuredFiles.includes(f.id));
      const displayMedia = [...featuredMedia, ...otherMedia].slice(0, 9);

      if (D.thanksGrid) {
        D.thanksGrid.innerHTML = displayMedia.map(f => {
          const thumb = f.thumbnailLink?.replace(/=s\d+$/, '=w300') ||
                        `https://drive.google.com/thumbnail?id=${f.id}&sz=w300`;
          return `<img class="thanks-thumb" src="${esc(thumb)}" alt="${esc(f.name)}" loading="lazy">`;
        }).join('');
      }

      // Gallery link
      if (D.thanksGalleryBtn) {
        D.thanksGalleryBtn.href = buildGalleryUrl(folderId);
      }

    } catch (e) {
      if (D.thanksStats) D.thanksStats.textContent = 'Could not load photos.';
    }
  }

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
    D.apiKeyInput.value   = localStorage.getItem(LS_KEY) || '';
    D.clientIdInput.value = localStorage.getItem(LS_CLIENT_ID) || ''; // M7
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

  /* ─── OAuth (M7) ────────────────────────── */
  D.signInBtn.addEventListener('click', signIn);
  D.signOutBtn.addEventListener('click', signOut);

  D.clientIdSave.addEventListener('click', () => {
    const val = D.clientIdInput.value.trim();
    if (!val) return;
    saveClientId(val);
    closeSettings();
    showToast('Client ID saved');
  });

  D.clientIdInput.addEventListener('keydown', e => {
    if (e.key === 'Enter') D.clientIdSave.click();
  });

  D.clientIdClear.addEventListener('click', () => {
    localStorage.removeItem(LS_CLIENT_ID);
    D.clientIdInput.value = '';
    showToast('Client ID cleared');
  });

  // Try to restore previous session on load
  tryRestoreAuth();

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
    if (!hasApiKey() && !isSignedIn()) { // M7: OAuth users don't need API key
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

  /* ─── AI Tagging toggle (M8) ───────────── */
  D.aiBtn.addEventListener('click', () => {
    if (_aiEnabled) disableAiTagging();
    else            enableAiTagging();
  });

  /* ─── Demo link (M11) ──────────────────── */
  D.demoLink.addEventListener('click', () => {
    if (!DEMO_FOLDER_ID) {
      showToast('No demo folder configured.');
      return;
    }
    D.input.value = DEMO_FOLDER_ID;
    S.stack = [];
    browse(DEMO_FOLDER_ID);
  });

  /* ─── Protect gallery (M12) ─────────────── */
  D.protectBtn.addEventListener('click', openProtectModal);
  D.protectClose.addEventListener('click', closeProtectModal);
  D.protectModal.addEventListener('click', e => { if (e.target === D.protectModal) closeProtectModal(); });
  D.protectGen.addEventListener('click', generateProtectedLink);
  D.protectInput.addEventListener('keydown', e => { if (e.key === 'Enter') generateProtectedLink(); });
  D.protectCopy.addEventListener('click', () => {
    navigator.clipboard.writeText(D.protectLink.value).then(
      () => { showToast('Protected link copied!'); closeProtectModal(); },
      () => showToast('Could not copy — try selecting the link manually'),
    );
  });

  /* ─── Lock gate (M12) ──────────────────── */
  D.lockBtn.addEventListener('click', tryUnlock);
  D.lockInput.addEventListener('keydown', e => { if (e.key === 'Enter') tryUnlock(); });

  /* ─── Embed widget (M9) ─────────────────── */
  D.embedBtn.addEventListener('click', openEmbedModal);
  D.embedClose.addEventListener('click', closeEmbedModal);
  D.embedModal.addEventListener('click', e => { if (e.target === D.embedModal) closeEmbedModal(); });
  D.embedWidth.addEventListener('input',  refreshEmbedCode);
  D.embedHeight.addEventListener('input', refreshEmbedCode);
  D.embedCopy.addEventListener('click', () => {
    const snippet = generateEmbedSnippet();
    navigator.clipboard.writeText(snippet).then(
      () => { showToast('Embed code copied!'); closeEmbedModal(); },
      () => showToast('Could not copy — try selecting the code manually'),
    );
  });

  /* ─── View toggle (M10) ────────────────── */
  D.viewGridBtn.addEventListener('click', () => { if (S.viewMode !== 'grid') setViewMode('grid'); });
  D.viewTimelineBtn.addEventListener('click', () => { if (S.viewMode !== 'timeline') setViewMode('timeline'); });
  D.printBtn.addEventListener('click', () => window.print());

  /* ─── Copy gallery link (M6) ───────────── */
  D.copyLinkBtn.addEventListener('click', () => {
    navigator.clipboard.writeText(location.href).then(
      () => showToast('Link copied to clipboard'),
      () => showToast('Could not copy — try manually'),
    );
  });

  /* ─── Browser back/forward (M6) ────────── */
  window.addEventListener('popstate', () => {
    const p = new URLSearchParams(location.search);
    const folderId = p.get('folder');
    if (!folderId) return;
    _skipNextSync  = true; // next syncUrl() will replaceState, not push
    _pendingFilter = p.get('filter') || 'all';
    _pendingSort   = p.get('sort')   || 'name-asc';
    _pendingSearch = p.get('q')      || '';
    _pendingItem   = p.get('item');
    // M10: restore view mode
    const pView = p.get('view');
    S.viewMode = (pView === 'timeline') ? 'timeline' : 'grid';
    D.viewGridBtn.classList.toggle('active', S.viewMode === 'grid');
    D.viewTimelineBtn.classList.toggle('active', S.viewMode === 'timeline');
    D.printBtn.classList.toggle('hidden', S.viewMode !== 'timeline');
    // M12: restore lock hash
    S.lockHash = p.get('lock') || '';
    S.stack = [];
    browse(folderId);
  });

  /* ─── M13: Event dashboard & create modal ── */
  if (D.newEventBtn)     D.newEventBtn.addEventListener('click', openEventCreateModal);
  if (D.newEventBtnHdr)  D.newEventBtnHdr.addEventListener('click', openEventCreateModal);
  if (D.eventCreateClose) D.eventCreateClose.addEventListener('click', closeEventCreateModal);
  if (D.eventCreateModal) D.eventCreateModal.addEventListener('click', e => {
    if (e.target === D.eventCreateModal) closeEventCreateModal();
  });
  if (D.eventCreateBtn) D.eventCreateBtn.addEventListener('click', submitCreateEvent);
  if (D.eventNameInput) D.eventNameInput.addEventListener('keydown', e => {
    if (e.key === 'Enter') submitCreateEvent();
  });

  // Cover style picker
  if (D.coverStylePicker) {
    D.coverStylePicker.addEventListener('click', e => {
      const swatch = e.target.closest('.cover-swatch');
      if (!swatch) return;
      D.coverStylePicker.querySelectorAll('.cover-swatch').forEach(s => s.classList.remove('active'));
      swatch.classList.add('active');
      _selectedCoverStyle = swatch.dataset.style;
    });
  }

  /* ─── M13: QR modal ─────────────────────── */
  if (D.qrClose) D.qrClose.addEventListener('click', closeQRModal);
  if (D.qrShareModal) D.qrShareModal.addEventListener('click', e => {
    if (e.target === D.qrShareModal) closeQRModal();
  });
  if (D.qrCopyBtn) D.qrCopyBtn.addEventListener('click', () => {
    navigator.clipboard.writeText(D.qrUrlInput.value).then(
      () => showToast('Link copied!'),
      () => showToast('Could not copy'),
    );
  });
  if (D.qrDownloadBtn) D.qrDownloadBtn.addEventListener('click', downloadQRImage);
  if (D.qrWhatsappBtn) D.qrWhatsappBtn.addEventListener('click', () => {
    if (_currentQREvent) shareWhatsApp(D.qrUrlInput.value, _currentQREvent.name);
  });
  if (D.qrEmailBtn) D.qrEmailBtn.addEventListener('click', () => {
    if (_currentQREvent) shareEmail(D.qrUrlInput.value, _currentQREvent.name);
  });
  // QR tab switching (M15)
  if (D.qrTabUpload) D.qrTabUpload.addEventListener('click', () => {
    _currentQRTab = 'upload';
    D.qrTabUpload.classList.add('active');
    D.qrTabGallery.classList.remove('active');
    renderQRTab();
  });
  if (D.qrTabGallery) D.qrTabGallery.addEventListener('click', () => {
    _currentQRTab = 'gallery';
    D.qrTabGallery.classList.add('active');
    D.qrTabUpload.classList.remove('active');
    renderQRTab();
  });

  /* ─── M13: Upload page ───────────────────── */
  if (D.uploadSigninBtn) D.uploadSigninBtn.addEventListener('click', guestSignIn);
  if (D.addPhotosBtn) D.addPhotosBtn.addEventListener('click', () => D.filePicker?.click());
  if (D.filePicker) D.filePicker.addEventListener('change', startFileUpload);
  if (D.uploadMoreBtn) D.uploadMoreBtn.addEventListener('click', () => {
    if (D.uploadDoneMsg) D.uploadDoneMsg.classList.add('hidden');
    if (D.uploadList) D.uploadList.innerHTML = '';
    D.filePicker?.click();
  });

  /* ─── M14: Polling controls ──────────────── */
  if (D.refreshBtn) D.refreshBtn.addEventListener('click', () => {
    const folderId = S.stack.at(-1)?.id;
    if (folderId) {
      D.refreshBtn.classList.add('spinning');
      pollForNewFiles(folderId).finally(() => D.refreshBtn.classList.remove('spinning'));
    }
  });
  if (D.pollIntervalSel) D.pollIntervalSel.addEventListener('change', e => {
    S.pollInterval = +e.target.value;
    const folderId = S.stack.at(-1)?.id;
    if (folderId) startPolling(folderId); // restart with new interval
  });
  if (D.ssLiveBtn) D.ssLiveBtn.addEventListener('click', toggleSlideshowLive);

  /* ─── M15: Curation bar ──────────────────── */
  if (D.curationHideBtn) D.curationHideBtn.addEventListener('click', () => enterCurationMode('hide'));
  if (D.curationFeatureBtn) D.curationFeatureBtn.addEventListener('click', () => enterCurationMode('feature'));
  if (D.curationShareBtn) D.curationShareBtn.addEventListener('click', () => {
    if (S.currentEvent) openQRModal(S.currentEvent);
  });
  if (D.curationThanksBtn) D.curationThanksBtn.addEventListener('click', () => {
    if (S.currentEvent) window.open(buildThanksUrl(S.currentEvent.folderId), '_blank', 'noopener');
  });

  // Intercept grid clicks for curation mode
  if (D.grid) {
    D.grid.addEventListener('click', e => {
      if (!_curationMode) return;
      const card = e.target.closest('.card');
      if (!card || card.classList.contains('card-folder')) return;
      const fileId = card.dataset.id;
      if (!fileId) return;
      if (_curationMode === 'hide') {
        toggleHideFile(fileId);
        e.stopPropagation();
      } else if (_curationMode === 'feature') {
        toggleFeatureFile(fileId);
        e.stopPropagation();
      }
    }, true); // capture phase so it runs before card click handlers
  }

  /* ─── M15: Thanks page ───────────────────── */
  if (D.thanksDownloadBtn) D.thanksDownloadBtn.addEventListener('click', () => {
    if (S.currentEvent) {
      // Re-use existing select/download mechanism — browse then select all
      showToast('Switch to gallery view to download all photos');
    }
  });

  /* ─── URL param boot (M6 + M13/M14/M15) ─── */
  {
    const bp = new URLSearchParams(location.search);
    const bootFolder = bp.get('folder');
    const bootEvent  = bp.get('event');
    const bootUpload = bp.get('upload') === '1';
    const bootDisplay = bp.get('display');
    const bootView   = bp.get('view'); // 'grid'|'timeline'|'guest'|'thanks'

    if (bp.get('filter')) _pendingFilter = bp.get('filter');
    if (bp.get('sort'))   _pendingSort   = bp.get('sort');
    if (bp.get('q'))      _pendingSearch = bp.get('q');
    _pendingItem = bp.get('item');

    // M10: restore view mode from URL (takes precedence over localStorage)
    if (bootView === 'timeline') {
      S.viewMode = 'timeline';
      D.viewGridBtn.classList.remove('active');
      D.viewTimelineBtn.classList.add('active');
      D.printBtn.classList.remove('hidden');
    }

    if (bootEvent && bootUpload) {
      // M13: Guest upload page
      renderUploadPage(bootEvent);
    } else if (bootEvent && bootDisplay === 'stats') {
      // M14: Stats display wall
      renderStatsDisplay(bootEvent);
    } else if (bootEvent && bootView === 'guest') {
      // M15: Guest read-only gallery
      renderGuestView(bootEvent);
    } else if (bootEvent && bootView === 'thanks') {
      // M15: Thank you summary page
      renderThanksPage(bootEvent);
    } else if (bootEvent) {
      // M13: event gallery mode
      S.eventMode = true;
      loadEvents();
      S.currentEvent = findEventByFolderId(bootEvent);
      S.hostMode = !!S.currentEvent; // host if we have event data
      if (S.currentEvent) loadCuration(bootEvent);
      if (D.refreshBtn) D.refreshBtn.classList.remove('hidden');
      if (D.pollIntervalSel) D.pollIntervalSel.classList.remove('hidden');
      if (S.hostMode && D.curationBar) D.curationBar.classList.remove('hidden');
      S.stack = [];
      browse(bootEvent);
      startPolling(bootEvent);
    } else {
      // M12: if ?lock= present, show gate instead of browsing immediately
      const bootLock = bp.get('lock');
      if (bootFolder && bootLock) {
        S.lockHash = bootLock;
        D.input.value = bootFolder;
        showLockGate();
        // browsing will happen inside tryUnlock() after correct password
      } else if (bootFolder) {
        S.stack = [];
        browse(bootFolder);
      }
    }
  }

  /* ─── Tagline cycler boot (M11) ─────────── */
  startTaglineCycle();

  /* ─── M13: Event boot ───────────────────── */
  loadEvents();
  // Show event dashboard on landing if there are events and host is signed in
  // (tryRestoreAuth below will call renderEventDashboard() if token is valid)

  /* ─── AI Tagging boot (M8) ─────────────── */
  loadAiTagsFromStorage();
  if (localStorage.getItem(LS_AI_ENABLED)) {
    _aiEnabled = true;
    D.aiBtn.classList.add('active');
  }

  /* ─── Embed mode boot (M9) ──────────────── */
  if (_isEmbed) {
    document.body.classList.add('embed-mode');
  }

  /* ─── View mode boot (M10) ──────────────── */
  // Only restore from localStorage if URL didn't override it
  if (S.viewMode === 'grid') {
    const saved = localStorage.getItem(LS_VIEW_MODE);
    if (saved === 'timeline') {
      S.viewMode = 'timeline';
      D.viewGridBtn.classList.remove('active');
      D.viewTimelineBtn.classList.add('active');
      D.printBtn.classList.remove('hidden');
    }
  }

})();
