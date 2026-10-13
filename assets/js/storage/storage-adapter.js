/* ============================================
   STORAGE-ADAPTER.JS - Storage abstraction layer
   ============================================ */

const StorageAdapter = {
  prefix: 'fatt_',

  async save(key, data) {
    try {
      const record = { data, updatedAt: Date.now() };
      localStorage.setItem(this.prefix + key, JSON.stringify(record));
      if (key.indexOf('session_') === 0) localStorage.removeItem(this._tombKey(key)); // saved after a delete = alive again
      this._mirror('save', key, record);
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

  async remove(key) {
    localStorage.removeItem(this.prefix + key);
    const t = Date.now();
    if (key.indexOf('session_') === 0) { try { this._setTomb(key, t); } catch (_) {} }
    this._mirror('remove', key, t);
    return { ok: true };
  },

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
      this._mirror('saveImage', key, dataUrl);
      return true;
    } catch (e) {
      console.warn('[StorageAdapter] IndexedDB saveImage failed, falling back to localStorage:', e);
      try { localStorage.setItem(this.prefix + 'img_' + key, dataUrl); this._mirror('saveImage', key, dataUrl); return true; }
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

  /* ---- Deleting an inspection ----
     A delete leaves a small "tombstone" (fatt_tombstone_<key> = { deletedAt }) so that
     other devices can learn about it when they sync. Rule everywhere: whichever happened
     last wins. An inspection edited after it was deleted comes back; one deleted after
     its last edit is removed everywhere (record and photos). Needs the devices' clocks
     to be roughly right. */
  _tombKey(key) { return this.prefix + 'tombstone_' + key; },
  _getTomb(key) {
    try { const r = localStorage.getItem(this._tombKey(key)); return r ? (Number(JSON.parse(r).deletedAt) || 0) : 0; }
    catch (_) { return 0; }
  },
  _setTomb(key, t) { localStorage.setItem(this._tombKey(key), JSON.stringify({ deletedAt: t })); },

  // Removes every photo of one inspection from this browser. Returns the image keys removed.
  async _purgePhotos(sessionId) {
    const pre = sessionId + '_';
    const removed = [];
    try {
      const db = await this._openImageDB();
      await new Promise((resolve, reject) => {
        const tx = db.transaction('images', 'readwrite');
        const req = tx.objectStore('images').openCursor(IDBKeyRange.bound(pre, pre + '\uffff'));
        req.onsuccess = () => { const c = req.result; if (c) { removed.push(c.key); c.delete(); c.continue(); } };
        tx.oncomplete = resolve;
        tx.onerror = () => reject(tx.error);
      });
    } catch (e) { console.warn('[StorageAdapter] could not remove photos:', e); }
    const legacy = this.prefix + 'img_' + pre;
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const k = localStorage.key(i);
      if (k && k.indexOf(legacy) === 0) { removed.push(k.slice((this.prefix + 'img_').length)); localStorage.removeItem(k); }
    }
    return removed;
  },

  // { imageKey: dataUrl } for one inspection's photos in this browser
  async _photosOf(sessionId) {
    const pre = sessionId + '_', out = {};
    try {
      const db = await this._openImageDB();
      await new Promise((resolve, reject) => {
        const req = db.transaction('images', 'readonly').objectStore('images').openCursor(IDBKeyRange.bound(pre, pre + '\uffff'));
        req.onsuccess = () => { const c = req.result; if (c) { if (typeof c.value === 'string') out[c.key] = c.value; c.continue(); } else resolve(); };
        req.onerror = () => reject(req.error);
      });
    } catch (e) { console.warn('[StorageAdapter] could not read photos:', e); }
    return out;
  },

  // Delete one inspection (its record and photos) on this device and tell the provider, if any.
  async deleteSession(sessionId) {
    const key = 'session_' + sessionId;
    const t = Date.now();
    localStorage.removeItem(this.prefix + key);
    try { this._setTomb(key, t); } catch (e) { console.warn('[StorageAdapter] could not store delete marker:', e); }
    if (localStorage.getItem(this.prefix + 'current_session') === sessionId) localStorage.removeItem(this.prefix + 'current_session');
    const images = await this._purgePhotos(sessionId);
    this._mirror('remove', key, t);
    images.forEach(k => this._mirror('removeImage', k));
    return { ok: true, deletedAt: t };
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
    return this._merge(b);
  },

  // Shared by importBackup and syncFromProvider. b: { local: {fatt_key: string}, images: {key: dataUrl} }
  async _merge(b) {
    const res = { ok: true, added: 0, updated: 0, kept: 0, removed: 0, images: 0, failed: 0 };
    const sessionPrefix = this.prefix + 'session_';
    const tombPrefix = this.prefix + 'tombstone_';
    const dead = []; // "<sessionId>_" prefixes of inspections deleted after their last edit: their photos must not come back

    // 1) Deletions first: "whichever happened last wins" against what is stored here
    for (const k of Object.keys(b.local)) {
      const v = b.local[k];
      if (typeof v !== 'string' || k.indexOf(tombPrefix) !== 0) continue;
      const key = k.slice(tombPrefix.length);
      if (key.indexOf('session_') !== 0) continue;
      try {
        const d = Number(JSON.parse(v).deletedAt) || 0;
        if (!d) continue;
        const existingRaw = localStorage.getItem(this.prefix + key);
        if (existingRaw !== null) {
          let u = 0;
          try { u = Number(JSON.parse(existingRaw).updatedAt) || 0; } catch (_) {}
          if (d < u) continue; // edited here after it was deleted elsewhere: keep it
          localStorage.removeItem(this.prefix + key);
          res.removed++;
          const sid = key.slice('session_'.length);
          await this._purgePhotos(sid);
          if (localStorage.getItem(this.prefix + 'current_session') === sid) localStorage.removeItem(this.prefix + 'current_session');
          this._setTomb(key, d);
          dead.push(key.slice('session_'.length) + '_');
        } else if (d > this._getTomb(key)) {
          this._setTomb(key, d);
          dead.push(key.slice('session_'.length) + '_');
        } else if (d === this._getTomb(key)) {
          dead.push(key.slice('session_'.length) + '_');
        }
      } catch (e) { res.failed++; }
    }

    // 2) Inspections and other data
    for (const k of Object.keys(b.local)) {
      const v = b.local[k];
      if (typeof v !== 'string' || !k.startsWith(this.prefix) || k === this.prefix + 'current_session' || k.indexOf(tombPrefix) === 0) continue;
      const isSession = k.startsWith(sessionPrefix);
      try {
        if (isSession) {
          const incoming = JSON.parse(v);
          if (!incoming || typeof incoming.data !== 'object' || incoming.data === null) continue;
          const key = k.slice(this.prefix.length);
          const inU = Number(incoming.updatedAt) || 0;
          const tomb = this._getTomb(key);
          if (tomb && inU <= tomb) { res.kept++; dead.push(key.slice('session_'.length) + '_'); continue; } // deleted after this version
          const existingRaw = localStorage.getItem(k);
          if (existingRaw === null) { localStorage.setItem(k, v); res.added++; if (tomb) localStorage.removeItem(this._tombKey(key)); continue; }
          let existing = null;
          try { existing = JSON.parse(existingRaw); } catch (_) {}
          if (!existing || inU > (Number(existing.updatedAt) || 0)) { localStorage.setItem(k, v); res.updated++; }
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
        if (dead.some(pr => k.indexOf(pr) === 0)) continue;
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
    this._mirror('removeImage', key);
  },

  /* ---- Optional data-drive provider (a hook; does nothing unless one is registered) ----
     This file contains no addresses, keys or network code. A customer who wants to
     share data through their own drive supplies a small script (see assets/js/drive-provider.js)
     that calls StorageAdapter.registerProvider({...}). Without a provider everything behaves
     exactly as before: data lives in this browser only.

     Provider shape - every method is optional and may be async:
       name                       label shown on the landing page
       save(key, record)          key 'session_<id>', record { data, updatedAt }
       remove(key, deletedAt)     a session was deleted at that time (ms). Keep a record of the deletion, not just a missing file
       saveImage(key, dataUrl)    key '<sessionId>_<photoId>'
       removeImage(key)
       pull()                     returns { sessions: { 'session_<id>': record }, images: { key: dataUrl },
                                  deleted: { 'session_<id>': deletedAt } }
                                  (or null/undefined when there is nothing)
     The browser copy stays the source of truth: a provider failure never blocks or
     rolls back a local save. Failures are reported to StorageAdapter.onProviderError. */
  _provider: null,
  onProviderError: null,

  registerProvider(p) {
    if (!p || typeof p !== 'object') return false;
    this._provider = p;
    return true;
  },
  unregisterProvider() { this._provider = null; },
  hasProvider() { return !!this._provider; },
  providerName() { return this._provider ? String(this._provider.name || '') : ''; },

  _providerFailed(op, e) {
    console.warn('[StorageAdapter] provider.' + op + ' failed:', e);
    try { if (typeof this.onProviderError === 'function') this.onProviderError(op, e); } catch (_) {}
  },

  // Fire-and-forget copy of a local change to the provider. Never throws, never awaited by callers.
  _mirror(op, key, value) {
    const p = this._provider;
    if (!p) return;
    const sessionKey = key.indexOf('session_') === 0;
    let call = null;
    if (op === 'save' && sessionKey && typeof p.save === 'function') call = () => p.save(key, value);
    else if (op === 'remove' && sessionKey && typeof p.remove === 'function') call = () => p.remove(key, value);
    else if (op === 'saveImage' && typeof p.saveImage === 'function') call = () => p.saveImage(key, value);
    else if (op === 'removeImage' && typeof p.removeImage === 'function') call = () => p.removeImage(key);
    if (!call) return;
    try { Promise.resolve(call()).catch(e => this._providerFailed(op, e)); }
    catch (e) { this._providerFailed(op, e); }
  },

  // Bring data from the provider into this browser, using the same merge rules as importBackup
  // (adds or updates, never deletes; newer inspection wins). Returns the merge result, or
  // { ok: true, skipped: true } when there is no provider or nothing to pull.
  async syncFromProvider() {
    const p = this._provider;
    if (!p || typeof p.pull !== 'function') return { ok: true, skipped: true };
    let got;
    try { got = await p.pull(); } catch (e) { this._providerFailed('pull', e); return { ok: false, error: 'provider' }; }
    if (!got || typeof got !== 'object') return { ok: true, skipped: true };
    const local = {};
    const sessions = got.sessions && typeof got.sessions === 'object' ? got.sessions : {};
    for (const k of Object.keys(sessions)) {
      const rec = sessions[k];
      if (k.indexOf('session_') !== 0 || !rec || typeof rec !== 'object') continue;
      local[this.prefix + k] = JSON.stringify({ data: rec.data, updatedAt: rec.updatedAt });
    }
    const deleted = got.deleted && typeof got.deleted === 'object' ? got.deleted : {};
    for (const k of Object.keys(deleted)) {
      if (k.indexOf('session_') !== 0) continue;
      local[this._tombKey(k)] = JSON.stringify({ deletedAt: Number(deleted[k]) || 0 });
    }
    const images = got.images && typeof got.images === 'object' ? got.images : {};
    const res = await this._merge({ local: local, images: images });
    res.pushed = await this._pushToProvider(sessions, deleted);
    return res;
  },

  // Second half of a sync: hand the provider whatever it is missing or has an older version of
  // (covers changes made while it was unreachable). Photos are sent as they are saved, not here.
  async _pushToProvider(remoteSessions, remoteDeleted) {
    const p = this._provider, out = { sessions: 0, deleted: 0 };
    if (!p) return out;
    const jobs = [];
    const tombPrefix = this.prefix + 'tombstone_', sessionPrefix = this.prefix + 'session_';
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (!k) continue;
      try {
        if (k.indexOf(tombPrefix) === 0 && typeof p.remove === 'function') {
          const key = k.slice(tombPrefix.length);
          const d = this._getTomb(key);
          if (d > (Number(remoteDeleted[key]) || 0)) { out.deleted++; jobs.push(() => p.remove(key, d)); }
        } else if (k.indexOf(sessionPrefix) === 0 && typeof p.save === 'function') {
          const key = k.slice(this.prefix.length);
          const rec = JSON.parse(localStorage.getItem(k));
          const ru = remoteSessions[key] && Number(remoteSessions[key].updatedAt) || 0;
          if (rec && rec.data && (Number(rec.updatedAt) || 0) > ru) {
            out.sessions++;
            jobs.push(async () => {
              await p.save(key, rec);
              // a version that comes back after a delete needs its photos on the drive again
              if (typeof p.saveImage === 'function') {
                const photos = await this._photosOf(key.slice('session_'.length));
                for (const ik of Object.keys(photos)) await p.saveImage(ik, photos[ik]);
              }
            });
          }
        }
      } catch (_) {}
    }
    await Promise.all(jobs.map(j => { try { return Promise.resolve(j()).catch(e => this._providerFailed('push', e)); } catch (e) { this._providerFailed('push', e); return null; } }));
    return out;
  }
};

window.StorageAdapter = StorageAdapter;
