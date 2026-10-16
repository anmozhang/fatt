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

   Provider shape (documented in storage-adapter.js): save, remove, saveImage, removeImage, pull.
   ============================================ */
(function () {
  'use strict';

  var CLIENT_KEY = 'drivecfg_clientid';
  var TOKEN_KEY = 'drivecfg_token';
  var FOLDER_KEY = 'drivecfg_folder';
  // ---- CONFIG: edit this block (no secret belongs here; a client ID is public) ----
  var CONFIG = {
    clientId: '',                    // '' = ask the person once and remember it in this browser
    folderId: '',                    // '' = look the folder up by name (shared-with-me first), create it if missing
    folderName: 'FATT Inspection Sync',
    scope: 'drive'                   // 'drive' (shared team folder) or 'drive.file' (own files only)
  };
  try { if (window.FATT_DRIVE_CONFIG) Object.keys(window.FATT_DRIVE_CONFIG).forEach(function (k) { CONFIG[k] = window.FATT_DRIVE_CONFIG[k]; }); } catch (e) {}
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

  function getToken() {
    try {
      var o = JSON.parse(ssGet(TOKEN_KEY) || 'null');
      if (o && o.t && o.exp > Date.now()) return o.t;
    } catch (e) {}
    return null;
  }

  var idx = {}; // file name -> Drive file id (filled by pull / lookups)
  var folderPromise = null;

  function authFail() {
    ssDel(TOKEN_KEY);
    if (typeof StorageAdapter !== 'undefined') StorageAdapter.unregisterProvider();
    renderButton();
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
      await api(UPLOAD + '/' + id + '?uploadType=media&' + ALL, { method: 'PATCH', headers: { 'Content-Type': mime }, body: text });
      return;
    }
    var b = 'fatt' + Math.random().toString(36).slice(2);
    var body = '--' + b + '\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n' +
      JSON.stringify({ name: name, parents: [fid] }) +
      '\r\n--' + b + '\r\nContent-Type: ' + mime + '\r\n\r\n' + text + '\r\n--' + b + '--';
    var r = await api(UPLOAD + '?uploadType=multipart&fields=id&' + ALL, {
      method: 'POST', headers: { 'Content-Type': 'multipart/related; boundary=' + b }, body: body
    });
    idx[name] = (await r.json()).id;
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
      var r = await api(API + '?q=' + encodeURIComponent(qs) + '&fields=nextPageToken,files(id,name)&pageSize=1000&' + LIST + (token ? '&pageToken=' + encodeURIComponent(token) : ''));
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
      var jobs = [];
      files.forEach(function (f) {
        var m;
        if ((m = /^del_(session_.+)\.json$/.exec(f.name))) {
          jobs.push(function () { return read(f.id).then(function (t) { res.deleted[m[1]] = Number(JSON.parse(t).deletedAt) || 0; }).catch(skip); });
        } else if ((m = /^(session_.+)\.json$/.exec(f.name))) {
          jobs.push(function () { return read(f.id).then(function (t) { res.sessions[m[1]] = JSON.parse(t); }).catch(skip); });
        }
      });
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

  /* ---------- sign-in (Google Identity Services, loaded only when someone clicks Connect) ---------- */
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

  async function afterConnect() {
    StorageAdapter.registerProvider(provider);
    renderButton();
    note('');
    if (typeof LandingPage !== 'undefined' && LandingPage._syncProvider) await LandingPage._syncProvider();
    else await StorageAdapter.syncFromProvider();
  }

  async function connect() {
    var cid = CONFIG.clientId || lsGet(CLIENT_KEY);
    if (!cid) {
      cid = (window.prompt(L('请输入 Google OAuth 客户端 ID（xxx.apps.googleusercontent.com）。只保存在这个浏览器里。',
                              'Enter your Google OAuth client ID (xxx.apps.googleusercontent.com). Stored in this browser only.')) || '').trim();
      if (!cid) return;
      if (!/^[\w.-]+\.apps\.googleusercontent\.com$/.test(cid)) { note(L('客户端 ID 格式不对', 'Client ID format looks wrong'), true); return; }
      lsSet(CLIENT_KEY, cid);
    }
    try { await loadGsi(); }
    catch (e) { note(L('无法加载 Google 登录脚本', 'Could not load Google sign-in'), true); return; }
    var tc = google.accounts.oauth2.initTokenClient({
      client_id: cid,
      scope: SCOPE,
      callback: function (resp) {
        if (!resp || resp.error || !resp.access_token) { note(L('登录失败：', 'Sign-in failed: ') + ((resp && resp.error) || ''), true); return; }
        ssSet(TOKEN_KEY, JSON.stringify({ t: resp.access_token, exp: Date.now() + Math.max(60, (Number(resp.expires_in) || 3600) - 60) * 1000 }));
        folderPromise = null; ssDel(FOLDER_KEY); idx = {};
        afterConnect();
      },
      error_callback: function (err) { note(L('登录已取消或被拦截', 'Sign-in cancelled or blocked') + (err && err.type ? ' (' + err.type + ')' : ''), true); }
    });
    tc.requestAccessToken({ prompt: '' });
  }

  async function disconnect() {
    var t = getToken();
    ssDel(TOKEN_KEY); ssDel(FOLDER_KEY); idx = {}; folderPromise = null;
    if (typeof StorageAdapter !== 'undefined') StorageAdapter.unregisterProvider();
    try {
      if (t) { await loadGsi(); google.accounts.oauth2.revoke(t, function () {}); }
    } catch (e) {}
    lsDel(CLIENT_KEY);
    var info = document.getElementById('storageInfo');
    if (info) info.textContent = 'LocalStorage ✓';
    renderButton();
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

  function initUi() {
    var info = document.getElementById('storageInfo');
    if (!info || document.getElementById('driveBtn')) return;
    var b = document.createElement('button');
    b.type = 'button'; b.id = 'driveBtn'; b.className = 'btn btn-ghost btn-sm';
    b.style.marginLeft = '10px';
    var n = document.createElement('span');
    n.id = 'driveNote'; n.style.marginLeft = '8px'; n.style.fontSize = '12px';
    info.parentNode.appendChild(b);
    info.parentNode.appendChild(n);
    renderButton();
    document.querySelectorAll('.lang-btn').forEach(function (x) { x.addEventListener('click', function () { setTimeout(renderButton, 0); }); });
  }

  // Already signed in earlier in this tab (token still valid): use the drive straight away
  if (typeof StorageAdapter !== 'undefined' && getToken()) StorageAdapter.registerProvider(provider);

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initUi);
  else initUi();
})();
