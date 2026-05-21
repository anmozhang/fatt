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

  saveImage(sessionId, imageId, dataUrl) {
    const key = this.prefix + 'img_' + sessionId + '_' + imageId;
    try { localStorage.setItem(key, dataUrl); return true; }
    catch (e) { console.warn('[StorageAdapter] image save failed:', e); return false; }
  },

  loadImage(sessionId, imageId) {
    return localStorage.getItem(this.prefix + 'img_' + sessionId + '_' + imageId);
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
