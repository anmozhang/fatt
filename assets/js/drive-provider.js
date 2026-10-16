/* ============================================
   DRIVE-PROVIDER.JS - Optional Google Drive sync (TEST VERSION)
   ============================================
   SETTINGS FOR THE COMPANY'S IT: the CONFIG block right below this comment is the only
   part that needs editing (client ID, shared folder, access level).
   Nothing happens until someone presses "Connect Google Drive" on the landing page.
   Until then no request is made to Google and all data stays in this browser.

   - No key, secret or address is stored in this file. The OAuth client ID is typed in by
     the person who connects and is kept only in this browser (localStorage 'drivecfg_clientid').
   - Access token: sessionStorage only (this tab, about 1 hour), never localStorage.
   - Access level (CONFIG.scope):
       'drive'       can see folders shared with the person, so a whole team can work in ONE
                     shared folder / shared drive. Use it for company sharing. The page can in
                     theory read the person's whole Drive; this code only touches the sync folder.
       'drive.file'  this app can only see files it created itself (nothing is shared between
                     different accounts). Safest for a one-person test.
   - Files live in a Drive folder (CONFIG.folderId, or else one named "FATT Inspection Sync"):
       session_<..>.json      one inspection {data, updatedAt}
       del_session_<..>.json  a deletion record {deletedAt}  (last write wins, see storage-adapter)
       img_<key>.txt          one photo (data URL)
   - Removing it again: put back the previous version of this file (or delete the file and its
     <script> tags), revoke access at https://myaccount.google.com/permissions and delete the
     Cloud project. "Disconnect" on the landing page also revokes the token here.

   Automatic behaviour (no server needed):
   - A small status badge (bottom-left on every page except the landing page, where the footer shows
     it) tells whether this browser is synced, syncing, has changes waiting, is offline or signed out.
     Click it: synced -> sync now; signed out -> sign in again.
   - While a page is open it pulls what others saved every CONFIG.pollSeconds, and when the tab comes
     back to the front or the network returns. Customer List and the Get Start draft list refresh by
     themselves. It never pulls while someone is typing into an open inspection (window.FATT_SYNC_GUARD).
   - Google gives a sign-in that lasts about an hour. Shortly before it ends this tries to renew it
     silently. If the browser blocks that (it may), the badge asks for one click.
   - Only files that changed since the last check are downloaded.

   Provider shape (documented in storage-adapter.js): save, remove, saveImage, removeImage, pull.
   ============================================ */
(function () {
  'use strict';

  var CLIENT_KEY = 'drivecfg_clientid';
  var TOKEN_KEY = 'drivecfg_token';
  var FOLDER_KEY = 'drivecfg_folder';
  var ENABLED_KEY = 'drivecfg_enabled';   // this browser has connected before -> keep the status badge and retry
  var HINT_KEY = 'drivecfg_hint';         // Google account used last time (only so re-sign-in picks it by itself)
  // ---- CONFIG: edit this block (no secret belongs here; a client ID is public) ----
  var CONFIG = {
    clientId: '',                    // '' = ask the person once and remember it in this browser
    folderId: '',                    // '' = look the folder up by name (shared-with-me first), create it if missing
    folderName: 'FATT Inspection Sync',
    scope: 'drive',                  // 'drive' (shared team folder) or 'drive.file' (own files only)
    pollSeconds: 60,                 // how often an open page checks for changes made by others
    renewBeforeSeconds: 300          // try to renew the sign-in this long before it ends
  };
  try { if (window.FATT_DRIVE_CONFIG) Object.keys(window.FATT_DRIVE_CONFIG).forEach(function (k) { CONFIG[k] = window.FATT_DRIVE_CONFIG[k]; }); } catch (e) {}
  CONFIG.tokenMarginSeconds = CONFIG.tokenMarginSeconds == null ? 60 : CONFIG.tokenMarginSeconds;
  CONFIG.tokenFloorSeconds = CONFIG.tokenFloorSeconds == null ? 60 : CONFIG.tokenFloorSeconds;
  CONFIG.silentGapSeconds = CONFIG.silentGapSeconds == null ? 120 : CONFIG.silentGapSeconds;
  var FOLDER_NAME = CONFIG.folderName;
  var SCOPE = 'https://www.googleapis.com/auth/' + (CONFIG.scope === 'drive.file' ? 'drive.file' : 'drive');
  var ALL = 'supportsAllDrives=true'; // also works inside shared drives
  var LIST = ALL + '&includeItemsFromAllDrives=true&corpora=allDrives';
  var API = 'https://www.googleapis.com/drive/v3/files';
  var UPLOAD = 'https://www.googleapis.com/upload/drive/v3/files';
  var GSI = 'https://accounts.google.com/gsi/client';

  function lsGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function lsSet(k, v) { try { localStorage.setItem(k, v); } catch (e) {} }
  function lsDel(k) { try { localStorage.removeItem(k); } catch (e) {} }
  function ssGet(k) { try { return sessionStorage.getItem(k); } catch (e) { return null; } }
  function ssSet(k, v) { try { sessionStorage.setItem(k, v); } catch (e) {} }
  function ssDel(k) { try { sessionStorage.removeItem(k); } catch (e) {} }
  function en() { return lsGet('lang') === 'en'; }
  function L(zh, enText) { return en() ? enText : zh; }

  function tokenObj() {
    try { var o = JSON.parse(ssGet(TOKEN_KEY) || 'null'); if (o && o.t) return o; } catch (e) {}
    return null;
  }
  function getToken() {
    var o = tokenObj();
    return o && o.exp > Date.now() ? o.t : null;
  }
  function enabled() { return lsGet(ENABLED_KEY) === '1' || !!getToken(); }

  var idx = {}; // file name -> Drive file id (filled by pull / lookups)
  var folderPromise = null;

  function authFail() {
    ssDel(TOKEN_KEY);   // the provider stays registered: saves keep being attempted and counted as waiting
    renderButton(); render();
  }

  async function api(url, opts) {
    var t = getToken();
    if (!t) { authFail(); throw new Error('drive: not signed in'); }
    opts = opts || {};
    opts.headers = Object.assign({ Authorization: 'Bearer ' + t }, opts.headers || {});
    var r = await fetch(url, opts);
    if (r.status === 401) { authFail(); throw new Error('drive: token expired'); }
    if (!r.ok) throw new Error('drive: HTTP ' + r.status);
    return r;
  }

  function q(s) { return String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'"); }

  async function folderId(create) {
    var cached = ssGet(FOLDER_KEY);
    if (cached) return cached;
    if (!folderPromise) {
      folderPromise = (async function () {
        if (CONFIG.folderId) return CONFIG.folderId;
        var qs = "name='" + q(FOLDER_NAME) + "' and mimeType='application/vnd.google-apps.folder' and trashed=false";
        var r = await api(API + '?q=' + encodeURIComponent(qs) + '&fields=files(id,ownedByMe,createdTime)&pageSize=50&' + LIST);
        var j = await r.json();
        // A folder someone shared with this person wins over one they own (so a teammate does not
        // end up in a private duplicate); among equals the oldest wins, so everybody picks the same.
        var found = (j.files || []).slice().sort(function (a, b) {
          if (!!a.ownedByMe !== !!b.ownedByMe) return a.ownedByMe ? 1 : -1;
          return String(a.createdTime || '').localeCompare(String(b.createdTime || '')) || String(a.id).localeCompare(String(b.id));
        });
        if (found.length) return found[0].id;
        if (!create) return null;
        var c = await api(API + '?fields=id&' + ALL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: FOLDER_NAME, mimeType: 'application/vnd.google-apps.folder' })
        });
        return (await c.json()).id;
      })();
      folderPromise.then(function (id) { if (id) ssSet(FOLDER_KEY, id); else folderPromise = null; },
                         function () { folderPromise = null; });
    }
    return folderPromise;
  }

  async function findFile(name, fid) {
    if (idx[name]) return idx[name];
    var qs = "name='" + q(name) + "' and '" + fid + "' in parents and trashed=false";
    var r = await api(API + '?q=' + encodeURIComponent(qs) + '&fields=files(id)&pageSize=1&' + LIST);
    var j = await r.json();
    if (j.files && j.files.length) { idx[name] = j.files[0].id; return idx[name]; }
    return null;
  }

  // What this browser just wrote is already known: remember it so the next poll does not download it again
  function rememberOwn(name, id, text, meta) {
    try {
      if (meta && meta.modifiedTime && /^(del_)?session_.+\.json$/.test(name)) pullCache[name] = { id: id, mt: meta.modifiedTime, val: JSON.parse(text) };
    } catch (e) {}
  }

  // Writes to the same Drive file run one after another, in the order they were requested.
  // Without this, two quick saves of one inspection could create two files or finish out of order.
  var chains = {};
  function serial(name, fn) {
    var p = (chains[name] || Promise.resolve()).catch(function () {}).then(fn);
    chains[name] = p;
    p.catch(function () {}).then(function () { if (chains[name] === p) delete chains[name]; });
    return p;
  }

  function upsert(name, text, mime) { return serial(name, function () { return upsertNow(name, text, mime); }); }

  async function upsertNow(name, text, mime) {
    var fid = await folderId(true);
    var id = await findFile(name, fid);
    if (id) {
      var u = await api(UPLOAD + '/' + id + '?uploadType=media&fields=id,modifiedTime&' + ALL, { method: 'PATCH', headers: { 'Content-Type': mime }, body: text });
      rememberOwn(name, id, text, await u.json());
      return;
    }
    var b = 'fatt' + Math.random().toString(36).slice(2);
    var body = '--' + b + '\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n' +
      JSON.stringify({ name: name, parents: [fid] }) +
      '\r\n--' + b + '\r\nContent-Type: ' + mime + '\r\n\r\n' + text + '\r\n--' + b + '--';
    var r = await api(UPLOAD + '?uploadType=multipart&fields=id,modifiedTime&' + ALL, {
      method: 'POST', headers: { 'Content-Type': 'multipart/related; boundary=' + b }, body: body
    });
    var made = await r.json();
    idx[name] = made.id;
    rememberOwn(name, made.id, text, made);
  }

  function trash(name) { return serial(name, function () { return trashNow(name); }); }

  async function trashNow(name) {
    var fid = await folderId(false);
    if (!fid) return;
    var id = await findFile(name, fid);
    if (!id) return;
    await api(API + '/' + id + '?' + ALL, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ trashed: true }) });
    delete idx[name];
  }

  function enc(k) { return encodeURIComponent(k).replace(/'/g, '%27'); }

  async function listAll(fid) {
    var out = [], token = '';
    do {
      var qs = "'" + fid + "' in parents and trashed=false";
      var r = await api(API + '?q=' + encodeURIComponent(qs) + '&fields=nextPageToken,files(id,name,modifiedTime)&pageSize=1000&' + LIST + (token ? '&pageToken=' + encodeURIComponent(token) : ''));
      var j = await r.json();
      out = out.concat(j.files || []);
      token = j.nextPageToken || '';
    } while (token);
    return out;
  }

  async function pool(items, n, fn) {
    var i = 0;
    var workers = [];
    for (var w = 0; w < Math.min(n, items.length); w++) {
      workers.push((async function () {
        while (i < items.length) { var it = items[i++]; await fn(it); }
      })());
    }
    await Promise.all(workers);
  }

  async function hasLocalImage(key) {
    try {
      var db = await StorageAdapter._openImageDB();
      return await new Promise(function (resolve) {
        var r = db.transaction('images', 'readonly').objectStore('images').count(key);
        r.onsuccess = function () { resolve(r.result > 0); };
        r.onerror = function () { resolve(false); };
      });
    } catch (e) { return false; }
  }

  var pullCache = {};   // file name -> { id, mt, val }: unchanged files are not downloaded again

  var provider = {
    name: 'Google Drive',

    save: function (key, record) { return upsert(key + '.json', JSON.stringify(record), 'application/json'); },

    remove: async function (key, deletedAt) {
      await upsert('del_' + key + '.json', JSON.stringify({ deletedAt: deletedAt }), 'application/json');
      await trash(key + '.json');
    },

    saveImage: function (key, dataUrl) { return upsert('img_' + enc(key) + '.txt', dataUrl, 'text/plain'); },

    removeImage: function (key) { return trash('img_' + enc(key) + '.txt'); },

    pull: async function () {
      var fid = await folderId(false);
      var res = { sessions: {}, images: {}, deleted: {} };
      if (!fid) return res;
      var files = await listAll(fid);
      idx = {};
      files.forEach(function (f) { idx[f.name] = f.id; });
      var read = async function (id) { return (await api(API + '/' + id + '?alt=media&' + ALL)).text(); };
      var jobs = [], seen = {};
      var cached = function (f) { var c = pullCache[f.name]; return f.modifiedTime && c && c.id === f.id && c.mt === f.modifiedTime ? c : null; };
      var load = function (f, put) {
        seen[f.name] = true;
        var c = cached(f);
        if (c) { put(c.val); return; }
        jobs.push(function () { return read(f.id).then(function (t) { var v = JSON.parse(t); pullCache[f.name] = { id: f.id, mt: f.modifiedTime, val: v }; put(v); }).catch(skip); });
      };
      files.forEach(function (f) {
        var m;
        if ((m = /^del_(session_.+)\.json$/.exec(f.name))) load(f, function (v) { res.deleted[m[1]] = Number(v.deletedAt) || 0; });
        else if ((m = /^(session_.+)\.json$/.exec(f.name))) load(f, function (v) { res.sessions[m[1]] = v; });
      });
      Object.keys(pullCache).forEach(function (k) { if (!seen[k]) delete pullCache[k]; });
      function skip(e) { if (e && /HTTP 401|token/.test(e.message)) throw e; console.warn('[Drive] skipped one file:', e); }
      await pool(jobs, 6, function (j) { return j(); });

      // Photos: only the ones this browser does not have yet (storage-adapter drops photos of deleted inspections)
      var imgJobs = [];
      for (var n = 0; n < files.length; n++) {
        var mm = /^img_(.+)\.txt$/.exec(files[n].name);
        if (!mm) continue;
        var key;
        try { key = decodeURIComponent(mm[1]); } catch (e) { continue; }
        if (await hasLocalImage(key)) continue;
        imgJobs.push({ key: key, id: files[n].id });
      }
      await pool(imgJobs, 4, async function (j) {
        try { res.images[j.key] = await read(j.id); } catch (e) { skip(e); }
      });
      return res;
    }
  };

  /* ---------- sign-in (Google Identity Services, loaded only when needed) ---------- */
  function loadGsi() {
    if (window.google && google.accounts && google.accounts.oauth2) return Promise.resolve();
    return new Promise(function (resolve, reject) {
      var s = document.createElement('script');
      s.src = GSI; s.async = true;
      s.onload = function () { resolve(); };
      s.onerror = function () { reject(new Error('gsi')); };
      document.head.appendChild(s);
    });
  }

  function note(text, isErr) {
    var n = document.getElementById('driveNote');
    if (n) { n.textContent = text || ''; n.style.color = isErr ? '#ef5350' : ''; }
  }

  var expiryTimer = null;
  function storeToken(resp) {
    var life = Math.max(CONFIG.tokenFloorSeconds, (Number(resp.expires_in) || 3600) - CONFIG.tokenMarginSeconds);
    ssSet(TOKEN_KEY, JSON.stringify({ t: resp.access_token, exp: Date.now() + life * 1000 }));
    lsSet(ENABLED_KEY, '1');
    clearTimeout(expiryTimer);
    expiryTimer = setTimeout(function () { render(); ensureToken(); }, life * 1000 + 300);
    learnHint(resp.access_token);
  }

  // Remember which Google account signed in, only so the next sign-in can pick it by itself
  function learnHint(t) {
    if (lsGet(HINT_KEY)) return;
    try {
      fetch('https://www.googleapis.com/drive/v3/about?fields=user(emailAddress)', { headers: { Authorization: 'Bearer ' + t } })
        .then(function (r) { return r.ok ? r.json() : null; })
        .then(function (j) { if (j && j.user && j.user.emailAddress) lsSet(HINT_KEY, j.user.emailAddress); })
        .catch(function () {});
    } catch (e) {}
  }

  /* ---------- sync status, automatic pull, silent renewal ---------- */
  var st = { inflight: 0, inflightP: null, last: 0, pending: 0, failCount: 0, silentFails: 0, lastSilent: 0, silentBusy: false };
  var lastAuto = 0;

  function state() {
    if (!enabled()) return 'off';
    if (!getToken()) return 'expired';
    if (st.inflight > 0) return 'syncing';
    if (navigator.onLine === false) return 'offline';
    if (st.pending > 0) return 'pending';
    return 'ok';
  }
  function hhmm(t) { var d = new Date(t), p = function (n) { return String(n).padStart(2, '0'); }; return p(d.getHours()) + ':' + p(d.getMinutes()); }
  function label(sv) {
    switch (sv) {
      case 'ok': return st.last ? L('Drive 已同步 · ' + hhmm(st.last), 'Drive synced · ' + hhmm(st.last)) : L('Drive 已连接', 'Drive connected');
      case 'syncing': return L('Drive 同步中…', 'Drive syncing…');
      case 'pending': return L(st.pending + ' 处更改尚未同步到 Drive', st.pending + ' change(s) not yet on Drive');
      case 'offline': return L('离线，联网后自动同步', 'Offline - will sync when back online');
      case 'expired': return L('Drive 已断开，点此重新连接', 'Drive signed out - click to reconnect');
    }
    return '';
  }
  var DOT = { ok: '#66bb6a', syncing: '#4fc3f7', pending: '#ffa726', offline: '#ffa726', expired: '#ef5350' };

  function render() {
    if (!document.body) return;
    var sv = state();
    var info = document.getElementById('storageInfo');
    if (info) {   // landing page: the footer line carries the status
      if (sv === 'off') return;
      var tail = { ok: '✓' + (st.last ? ' ' + hhmm(st.last) : ''), syncing: '…', pending: '⚠ ' + st.pending, offline: '⚠', expired: '✗' }[sv];
      info.textContent = 'LocalStorage ✓ + Google Drive ' + tail;
      renderButton();
      return;
    }
    var b = document.getElementById('driveBadge');
    if (sv === 'off') { if (b) b.remove(); return; }
    if (!b) {
      if (!document.getElementById('driveBadgeCss')) {
        var css = document.createElement('style');
        css.id = 'driveBadgeCss';
        css.textContent = '@media print{#driveBadge{display:none!important}}';
        document.head.appendChild(css);
      }
      b = document.createElement('button');
      b.type = 'button'; b.id = 'driveBadge';
      b.setAttribute('style', 'position:fixed;left:10px;z-index:9999;display:flex;align-items:center;gap:6px;max-width:calc(100vw - 20px);' +
        'padding:5px 11px;border-radius:14px;border:1px solid #444;background:rgba(28,28,28,.94);color:#ddd;font-size:12px;line-height:1.3;cursor:pointer;text-align:left');
      var dot = document.createElement('span');
      dot.setAttribute('style', 'width:8px;height:8px;border-radius:50%;flex:none');
      var tx = document.createElement('span');
      b.appendChild(dot); b.appendChild(tx);
      b.addEventListener('click', badgeClick);
      document.body.appendChild(b);
    }
    var nav = document.querySelector('.bottom-nav');
    var h = nav && getComputedStyle(nav).display !== 'none' ? nav.offsetHeight : 0;
    b.style.bottom = (h + 10) + 'px';
    b.firstChild.style.background = DOT[sv];
    b.lastChild.textContent = label(sv);
    b.setAttribute('data-state', sv);
    b.title = L('点击：立即同步 / 重新连接', 'Click: sync now / reconnect');
  }

  function badgeClick() {
    var sv = state();
    if (sv === 'expired') connect();
    else if (sv !== 'syncing') syncAndNotify();
  }

  function guardOk() {
    try { return typeof window.FATT_SYNC_GUARD !== 'function' || window.FATT_SYNC_GUARD() !== false; } catch (e) { return true; }
  }

  // Wraps the adapter's sync so every caller (landing, Customer List, this file) feeds one status
  function wrapSync() {
    if (StorageAdapter.__driveWrapped) return;
    StorageAdapter.__driveWrapped = true;
    var orig = StorageAdapter.syncFromProvider.bind(StorageAdapter);
    StorageAdapter.syncFromProvider = function () {
      if (st.inflightP) return st.inflightP;
      var startFails = st.failCount;
      st.inflight++; render();
      var p = orig().then(function (r) {
        if (r && r.ok && !r.skipped) { st.last = Date.now(); st.pending = st.failCount - startFails; }
        return r;
      }).finally(function () { st.inflight--; st.inflightP = null; setTimeout(render, 30); });
      st.inflightP = p;
      return p;
    };
    var prev = StorageAdapter.onProviderError;
    StorageAdapter.onProviderError = function (op, e) {
      if (op !== 'pull') { st.failCount++; st.pending++; }
      render();
      try { if (typeof prev === 'function') prev(op, e); } catch (_) {}
    };
  }

  async function syncAndNotify() {
    var r = await StorageAdapter.syncFromProvider();
    if (r && r.ok && (r.added || r.updated || r.removed)) document.dispatchEvent(new CustomEvent('fatt:synced', { detail: r }));
    return r;
  }

  async function autoSync() {
    if (!enabled() || document.visibilityState === 'hidden' || navigator.onLine === false) return;
    ensureToken();
    if (!getToken() || !guardOk()) return;
    var gap = Math.min(5000, (CONFIG.pollSeconds * 1000) / 2);
    if (Date.now() - lastAuto < gap) return;
    lastAuto = Date.now();
    await syncAndNotify();
  }

  // Renew the sign-in quietly before it ends. Browsers may block this (no click involved); then the badge asks for one.
  function ensureToken() {
    if (!enabled()) return;
    var o = tokenObj();
    if (o && o.exp - Date.now() > CONFIG.renewBeforeSeconds * 1000) return;
    trySilent();
  }

  async function trySilent() {
    if (st.silentBusy || st.silentFails >= 3 || Date.now() - st.lastSilent < CONFIG.silentGapSeconds * 1000) return;
    var cid = CONFIG.clientId || lsGet(CLIENT_KEY);
    if (!cid) return;
    st.lastSilent = Date.now(); st.silentBusy = true;
    try {
      await loadGsi();
      await new Promise(function (resolve) {
        var done = false;
        var fin = function (ok) { if (done) return; done = true; if (!ok) st.silentFails++; resolve(); };
        var tc = google.accounts.oauth2.initTokenClient({
          client_id: cid, scope: SCOPE,
          callback: function (resp) {
            if (resp && resp.access_token && !resp.error) { storeToken(resp); st.silentFails = 0; fin(true); onRenewed(); } else fin(false);
          },
          error_callback: function () { fin(false); }
        });
        var opts = { prompt: 'none' };
        if (lsGet(HINT_KEY)) opts.hint = lsGet(HINT_KEY);
        try { tc.requestAccessToken(opts); } catch (e) { fin(false); }
        setTimeout(function () { fin(false); }, 15000);
      });
    } catch (e) { st.silentFails++; }
    st.silentBusy = false;
    render();
  }

  function onRenewed() { StorageAdapter.registerProvider(provider); render(); syncAndNotify(); }

  async function afterConnect() {
    StorageAdapter.registerProvider(provider);
    renderButton(); render();
    note('');
    if (typeof LandingPage !== 'undefined' && LandingPage._syncProvider) await LandingPage._syncProvider();
    else await syncAndNotify();
    render();
  }

  // Resolves true once signed in and the first sync finished, false if cancelled / failed
  function connect() {
    return new Promise(function (resolve) {
      var cid = CONFIG.clientId || lsGet(CLIENT_KEY);
      if (!cid) {
        cid = (window.prompt(L('请输入 Google OAuth 客户端 ID（xxx.apps.googleusercontent.com）。只保存在这个浏览器里。',
                                'Enter your Google OAuth client ID (xxx.apps.googleusercontent.com). Stored in this browser only.')) || '').trim();
        if (!cid) return resolve(false);
        if (!/^[\w.-]+\.apps\.googleusercontent\.com$/.test(cid)) { note(L('客户端 ID 格式不对', 'Client ID format looks wrong'), true); return resolve(false); }
        lsSet(CLIENT_KEY, cid);
      }
      loadGsi().then(function () {
        var tc = google.accounts.oauth2.initTokenClient({
          client_id: cid,
          scope: SCOPE,
          callback: function (resp) {
            if (!resp || resp.error || !resp.access_token) { note(L('登录失败：', 'Sign-in failed: ') + ((resp && resp.error) || ''), true); return resolve(false); }
            storeToken(resp);
            st.silentFails = 0;
            folderPromise = null; ssDel(FOLDER_KEY); idx = {}; pullCache = {};
            afterConnect().then(function () { resolve(true); }, function () { resolve(true); });
          },
          error_callback: function (err) { note(L('登录已取消或被拦截', 'Sign-in cancelled or blocked') + (err && err.type ? ' (' + err.type + ')' : ''), true); resolve(false); }
        });
        var opts = { prompt: '' };
        if (lsGet(HINT_KEY)) opts.hint = lsGet(HINT_KEY);
        tc.requestAccessToken(opts);
      }, function () { note(L('无法加载 Google 登录脚本', 'Could not load Google sign-in'), true); resolve(false); });
    });
  }

  async function disconnect() {
    var t = getToken();
    ssDel(TOKEN_KEY); ssDel(FOLDER_KEY); idx = {}; folderPromise = null; pullCache = {};
    clearTimeout(expiryTimer);
    lsDel(ENABLED_KEY); lsDel(HINT_KEY);
    if (typeof StorageAdapter !== 'undefined') StorageAdapter.unregisterProvider();
    try {
      if (t) { await loadGsi(); google.accounts.oauth2.revoke(t, function () {}); }
    } catch (e) {}
    lsDel(CLIENT_KEY);
    st.pending = 0; st.failCount = 0; st.last = 0;
    var info = document.getElementById('storageInfo');
    if (info) info.textContent = 'LocalStorage ✓';
    renderButton(); render();
    note(L('已断开，本机数据保留。Drive 里的文件没有删除。', 'Disconnected. Local data kept; files in Drive were not deleted.'));
  }

  function renderButton() {
    var b = document.getElementById('driveBtn');
    if (!b) return;
    var connected = !!getToken();
    b.textContent = connected ? L('断开 Drive', 'Disconnect Drive')
      : ((CONFIG.clientId || lsGet(CLIENT_KEY)) ? L('重新连接 Drive', 'Reconnect Drive') : L('连接 Google Drive', 'Connect Google Drive'));
    b.onclick = connected ? disconnect : connect;
  }

  // Small API for pages (Get Start uses it to look at Drive before deciding what to show)
  window.FATT_DRIVE = {
    enabled: function () { return !!(typeof StorageAdapter !== 'undefined' && enabled()); },
    signedIn: function () { return !!getToken(); },
    connect: connect,
    // Pull from Drive now, waiting at most `ms`. state: off | synced | expired | timeout | error
    pullNow: function (ms) {
      if (!enabled()) return Promise.resolve({ state: 'off' });
      var limit = new Promise(function (r) { setTimeout(function () { r({ state: 'timeout' }); }, ms || 3000); });
      var work = (async function () {
        if (!getToken()) await trySilent();
        if (!getToken()) return { state: 'expired' };
        var r = await syncAndNotify();
        return r && r.ok ? { state: 'synced', result: r } : { state: 'error' };
      })().catch(function () { return { state: 'error' }; });
      return Promise.race([work, limit]);
    },
    text: function () {
      return {
        syncing: L('正在从 Drive 同步…', 'Syncing from Drive…'),
        title: L('Drive 未连接', 'Drive not connected'),
        body: L('先连接 Drive，才能看到同事的草稿；也可以先跳过，直接新建检验。', 'Connect Drive to see your team\'s drafts, or skip and start a new inspection.'),
        banner: L('Drive 未连接，下面的列表可能不是最新的。', 'Drive is not connected - this list may be out of date.'),
        connect: L('连接 Drive', 'Connect Drive'),
        skip: L('跳过，直接新建', 'Skip, start new')
      };
    }
  };

  function initUi() {
    var info = document.getElementById('storageInfo');
    if (info && !document.getElementById('driveBtn')) {
      var b = document.createElement('button');
      b.type = 'button'; b.id = 'driveBtn'; b.className = 'btn btn-ghost btn-sm';
      b.style.marginLeft = '10px';
      var n = document.createElement('span');
      n.id = 'driveNote'; n.style.marginLeft = '8px'; n.style.fontSize = '12px';
      info.parentNode.appendChild(b);
      info.parentNode.appendChild(n);
      renderButton();
    }
    document.querySelectorAll('.lang-btn').forEach(function (x) { x.addEventListener('click', function () { setTimeout(function () { renderButton(); render(); }, 0); }); });
    render();
    // A page that only shows drafts for editing (Get Start) pulls once on arrival
    if (/bteam\.html/.test(location.pathname)) setTimeout(autoSync, 1500);
    else if (enabled()) setTimeout(ensureToken, 800);
    if (enabled()) loadGsi().catch(function () {});   // ready before the click, so the sign-in window is not blocked
  }

  if (typeof StorageAdapter !== 'undefined') {
    wrapSync();
    if (getToken()) lsSet(ENABLED_KEY, '1');           // signed in before this version existed
    if (enabled()) StorageAdapter.registerProvider(provider);   // also when the sign-in ended: saves are then counted as "waiting"
    setInterval(function () { render(); autoSync(); }, Math.max(1, CONFIG.pollSeconds) * 1000);
    document.addEventListener('visibilitychange', function () { if (document.visibilityState === 'visible') { render(); autoSync(); } });
    window.addEventListener('focus', function () { autoSync(); });
    window.addEventListener('online', function () { render(); autoSync(); });
    window.addEventListener('offline', render);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initUi);
  else initUi();
})();
