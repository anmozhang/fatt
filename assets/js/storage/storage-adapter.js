/* ============================================
   STORAGE-ADAPTER.JS - Storage abstraction layer
   ============================================ */

const StorageAdapter = {
  mode: 'local',
  prefix: 'fatt_',
  driveToken: null,

  init() {
    const savedMode = localStorage.getItem(this.prefix + 'storage_mode');
    if (savedMode) this.mode = savedMode;
    this._updateStatus();
    return this;
  },

  setMode(mode) {
    if (!['local', 'gdrive'].includes(mode)) return;
    this.mode = mode;
    localStorage.setItem(this.prefix + 'storage_mode', mode);
    this._updateStatus();
  },

  _updateStatus() {
    const dot = document.getElementById('storageStatus');
    const info = document.getElementById('storageInfo');
    if (dot) dot.style.background = this.mode === 'local' ? '#ffa726' : '#66bb6a';
    if (info) info.textContent = this.mode === 'local' ? 'LocalStorage' : 'Google Drive';
  },

  async save(key, data) {
    try {
      const serialized = JSON.stringify({ data, updatedAt: Date.now() });
      localStorage.setItem(this.prefix + key, serialized);
      if (this.mode === 'gdrive' && this.driveToken) await this._driveSave(key, serialized);
      return { ok: true };
    } catch (e) {
      console.error('[StorageAdapter] save error:', e);
      return { ok: false, error: e.message };
    }
  },

  async load(key) {
    try {
      if (this.mode === 'gdrive' && this.driveToken) {
        const remote = await this._driveLoad(key);
        if (remote) { localStorage.setItem(this.prefix + key, remote); return JSON.parse(remote).data; }
      }
      const raw = localStorage.getItem(this.prefix + key);
      return raw ? JSON.parse(raw).data : null;
    } catch (e) { console.error('[StorageAdapter] load error:', e); return null; }
  },

  async remove(key) { localStorage.removeItem(this.prefix + key); return { ok: true }; },

  async list(prefix) {
    const results = [];
    const searchPrefix = this.prefix + (prefix || '');
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith(searchPrefix)) {
        try {
          const raw = localStorage.getItem(k);
          const parsed = JSON.parse(raw);
          results.push({ key: k.replace(this.prefix, ''), data: parsed.data, updatedAt: parsed.updatedAt });
        } catch (_) {}
      }
    }
    return results.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
  },

  async saveSession(sessionId, sessionData) { return this.save('session_' + sessionId, sessionData); },
  async loadSession(sessionId) { return this.load('session_' + sessionId); },
  async listSessions() { return this.list('session_'); },

  /* ---- Image storage (IndexedDB) ----
     Photos are kept out of localStorage on purpose: localStorage's ~5-10MB
     quota fills up after just a few on-site photos, and writes past the quota
     fail silently (the photoId stays referenced in the session but the image
     data never lands), which is what made photos appear to "disappear" when
     navigating between steps. IndexedDB has a much larger practical quota
     (typically hundreds of MB or more), so photo blobs live here instead.
     Text/session data is unaffected and stays on localStorage via save/load
     above. Callers (bteam.html) must await these — they are Promise-based. */
  _dbPromise: null,

  _openImageDB() {
    if (this._dbPromise) return this._dbPromise;
    this._dbPromise = new Promise((resolve, reject) => {
      if (typeof indexedDB === 'undefined') { reject(new Error('IndexedDB unavailable')); return; }
      const req = indexedDB.open('fatt_images_db', 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains('images')) db.createObjectStore('images');
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    return this._dbPromise;
  },

  async saveImage(sessionId, imageId, dataUrl) {
    const key = sessionId + '_' + imageId;
    try {
      const db = await this._openImageDB();
      await new Promise((resolve, reject) => {
        const tx = db.transaction('images', 'readwrite');
        tx.objectStore('images').put(dataUrl, key);
        tx.oncomplete = resolve;
        tx.onerror = () => reject(tx.error);
      });
      return true;
    } catch (e) {
      console.warn('[StorageAdapter] IndexedDB saveImage failed, falling back to localStorage:', e);
      try { localStorage.setItem(this.prefix + 'img_' + key, dataUrl); return true; }
      catch (e2) { console.warn('[StorageAdapter] localStorage fallback also failed:', e2); return false; }
    }
  },

  async loadImage(sessionId, imageId) {
    const key = sessionId + '_' + imageId;
    try {
      const db = await this._openImageDB();
      const result = await new Promise((resolve, reject) => {
        const tx = db.transaction('images', 'readonly');
        const req = tx.objectStore('images').get(key);
        req.onsuccess = () => resolve(req.result || null);
        req.onerror = () => reject(req.error);
      });
      if (result) return result;
    } catch (e) {
      console.warn('[StorageAdapter] IndexedDB loadImage failed:', e);
    }
    // Fall back to the legacy localStorage location — covers images saved
    // before this migration, and anything written via the fallback path above.
    return localStorage.getItem(this.prefix + 'img_' + key);
  },

  async removeImage(sessionId, imageId) {
    const key = sessionId + '_' + imageId;
    try {
      const db = await this._openImageDB();
      await new Promise((resolve, reject) => {
        const tx = db.transaction('images', 'readwrite');
        tx.objectStore('images').delete(key);
        tx.oncomplete = resolve;
        tx.onerror = () => reject(tx.error);
      });
    } catch (e) {
      console.warn('[StorageAdapter] IndexedDB removeImage failed:', e);
    }
    localStorage.removeItem(this.prefix + 'img_' + key); // clean up any legacy copy too
  },

  setDriveToken(token) { this.driveToken = token; if (token) this.setMode('gdrive'); },
  async _driveSave(key) { console.log('[StorageAdapter] Drive save stub:', key); return { ok: true }; },
  async _driveLoad(key) { console.log('[StorageAdapter] Drive load stub:', key); return null; },

  exportAll() {
    const data = {};
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith(this.prefix)) {
        try { data[k] = JSON.parse(localStorage.getItem(k)); } catch (_) {}
      }
    }
    return JSON.stringify(data, null, 2);
  },

  importAll(jsonString) {
    try {
      const data = JSON.parse(jsonString);
      Object.entries(data).forEach(([k, v]) => {
        if (k.startsWith(this.prefix)) localStorage.setItem(k, JSON.stringify(v));
      });
      return { ok: true, count: Object.keys(data).length };
    } catch (e) { return { ok: false, error: e.message }; }
  },

  getUsage() {
    let total = 0;
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith(this.prefix)) total += (localStorage.getItem(k) || '').length * 2;
    }
    return { bytes: total, kb: (total / 1024).toFixed(1), mb: (total / 1024 / 1024).toFixed(2) };
  }
};

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => StorageAdapter.init());
} else { StorageAdapter.init(); }

window.StorageAdapter = StorageAdapter;
