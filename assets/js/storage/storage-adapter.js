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
