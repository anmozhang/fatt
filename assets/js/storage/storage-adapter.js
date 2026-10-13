/* ============================================
   STORAGE-ADAPTER.JS - Storage abstraction layer
   ============================================ */

const StorageAdapter = {
  prefix: 'fatt_',

  async save(key, data) {
    try {
      const serialized = JSON.stringify({ data, updatedAt: Date.now() });
      localStorage.setItem(this.prefix + key, serialized);
      return { ok: true };
    } catch (e) {
      console.error('[StorageAdapter] save error:', e);
      return { ok: false, error: e.message };
    }
  },

  async load(key) {
    try {
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

  /* ---- Local backup / restore ----
     Everything lives in this browser, so the user can save all inspections and
     photos to a file on their own device and load it back later (new phone,
     cleared cache, ...). Nothing is sent anywhere. Importing only adds or updates
     data; it never deletes what is already here. */
  BACKUP_APP: 'fatt-inspection',
  BACKUP_VERSION: 1,

  async _allImages() {
    const out = {};
    try {
      const db = await this._openImageDB();
      await new Promise((resolve, reject) => {
        const tx = db.transaction('images', 'readonly');
        const req = tx.objectStore('images').openCursor();
        req.onsuccess = () => {
          const c = req.result;
          if (c) { if (typeof c.value === 'string') out[c.key] = c.value; c.continue(); }
          else resolve();
        };
        req.onerror = () => reject(req.error);
      });
    } catch (e) { console.warn('[StorageAdapter] could not read photos for backup:', e); }
    return out;
  },

  // Returns { blob, sessions, images }; the file is built in pieces so big photo sets stay manageable.
  async exportBackup() {
    const local = {};
    let sessions = 0;
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (!k || !k.startsWith(this.prefix) || k === this.prefix + 'current_session') continue;
      local[k] = localStorage.getItem(k);
      if (k.startsWith(this.prefix + 'session_')) sessions++;
    }
    const images = await this._allImages();
    const keys = Object.keys(images);
    const parts = [
      '{"app":' + JSON.stringify(this.BACKUP_APP) + ',"version":' + this.BACKUP_VERSION +
      ',"createdAt":' + JSON.stringify(new Date().toISOString()) + ',"local":' + JSON.stringify(local) + ',"images":{'
    ];
    keys.forEach((k, i) => { parts.push((i ? ',' : '') + JSON.stringify(k) + ':' + JSON.stringify(images[k])); });
    parts.push('}}');
    return { blob: new Blob(parts, { type: 'application/json' }), sessions: sessions, images: keys.length };
  },

  // text: contents of a backup file. Returns { ok, error?, added, updated, kept, images }
  async importBackup(text) {
    let b;
    try { b = JSON.parse(text); } catch (e) { return { ok: false, error: 'invalid' }; }
    if (!b || b.app !== this.BACKUP_APP || b.version !== this.BACKUP_VERSION ||
        typeof b.local !== 'object' || b.local === null || typeof b.images !== 'object' || b.images === null) {
      return { ok: false, error: 'invalid' };
    }
    const res = { ok: true, added: 0, updated: 0, kept: 0, images: 0, failed: 0 };
    const sessionPrefix = this.prefix + 'session_';
    for (const k of Object.keys(b.local)) {
      const v = b.local[k];
      if (typeof v !== 'string' || !k.startsWith(this.prefix) || k === this.prefix + 'current_session') continue;
      const isSession = k.startsWith(sessionPrefix);
      try {
        if (isSession) {
          const incoming = JSON.parse(v);
          if (!incoming || typeof incoming.data !== 'object' || incoming.data === null) continue;
          const existingRaw = localStorage.getItem(k);
          if (existingRaw === null) { localStorage.setItem(k, v); res.added++; continue; }
          let existing = null;
          try { existing = JSON.parse(existingRaw); } catch (_) {}
          if (!existing || (incoming.updatedAt || 0) > (existing.updatedAt || 0)) { localStorage.setItem(k, v); res.updated++; }
          else res.kept++;
        } else if (localStorage.getItem(k) === null) {
          localStorage.setItem(k, v);
        }
      } catch (e) { res.failed++; }
    }
    // Photos: add the ones that are missing, never overwrite existing ones
    try {
      const db = await this._openImageDB();
      for (const k of Object.keys(b.images)) {
        const v = b.images[k];
        if (typeof v !== 'string' || v.indexOf('data:image/') !== 0) continue;
        const exists = await new Promise((resolve) => {
          const r = db.transaction('images', 'readonly').objectStore('images').count(k);
          r.onsuccess = () => resolve(r.result > 0); r.onerror = () => resolve(false);
        });
        if (exists) continue;
        await new Promise((resolve) => {
          const tx = db.transaction('images', 'readwrite');
          tx.objectStore('images').put(v, k);
          tx.oncomplete = () => { res.images++; resolve(); };
          tx.onerror = () => { res.failed++; resolve(); };
        });
      }
    } catch (e) { console.warn('[StorageAdapter] could not restore photos:', e); res.failed++; }
    return res;
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
  }
};

window.StorageAdapter = StorageAdapter;
