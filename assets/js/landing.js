/* ============================================
   LANDING.JS - Landing Page Logic for FATT Portal
   ============================================ */

const LandingPage = {
  init() {
    this._checkStorage();
    this._bindRoleCards();
    this._bindBackup();
    console.log('[Landing] Initialized');
  },

  /* ---- Storage Status ---- */
  _checkStorage() {
    try {
      localStorage.setItem('fatt_test', '1');
      localStorage.removeItem('fatt_test');
      const dot = document.getElementById('storageStatus');
      const info = document.getElementById('storageInfo');
      if (dot) { dot.style.background = '#66bb6a'; }
      if (info) { info.textContent = 'LocalStorage ✓'; }
    } catch (e) {
      const dot = document.getElementById('storageStatus');
      if (dot) { dot.style.background = '#ef5350'; }
      console.warn('[Landing] Storage unavailable:', e);
    }
  },

  /* ---- Backup / restore (local file only) ---- */
  _backupMsg(text, isError) {
    const el = document.getElementById('backupMsg');
    if (!el) return;
    el.textContent = text || '';
    el.classList.toggle('error', !!isError);
  },

  _bindBackup() {
    const exportBtn = document.getElementById('backupExportBtn');
    const importBtn = document.getElementById('backupImportBtn');
    const fileInput = document.getElementById('backupFile');
    if (!exportBtn || !importBtn || !fileInput || typeof StorageAdapter === 'undefined') return;
    const T = (k, p) => (window.t ? window.t(k, p) : k);
    // The status line is built from translated text, so clear it when the language changes
    document.querySelectorAll('.lang-btn').forEach(btn => btn.addEventListener('click', () => this._backupMsg('')));

    exportBtn.addEventListener('click', async () => {
      try {
        const r = await StorageAdapter.exportBackup();
        if (!r.sessions && !r.images) { this._backupMsg(T('backup.nothing'), true); return; }
        const d = new Date(), p = n => String(n).padStart(2, '0');
        const name = 'FATT_Backup_' + p(d.getDate()) + '-' + p(d.getMonth() + 1) + '-' + d.getFullYear() + '.json';
        const url = URL.createObjectURL(r.blob);
        const a = document.createElement('a');
        a.href = url; a.download = name;
        document.body.appendChild(a); a.click(); a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 10000);
        this._backupMsg(T('backup.exported', { n: r.sessions, m: r.images }));
      } catch (e) {
        console.error('[Landing] export failed:', e);
        this._backupMsg(T('backup.failed'), true);
      }
    });

    importBtn.addEventListener('click', () => fileInput.click());
    fileInput.addEventListener('change', async () => {
      const file = fileInput.files && fileInput.files[0];
      fileInput.value = '';
      if (!file) return;
      try {
        const text = await file.text();
        let ok = false;
        try { const probe = JSON.parse(text); ok = !!probe && probe.app === StorageAdapter.BACKUP_APP; } catch (_) {}
        if (!ok) { this._backupMsg(T('backup.invalid'), true); return; }
        if (!window.confirm(T('backup.confirm'))) return;
        const r = await StorageAdapter.importBackup(text);
        if (!r.ok) { this._backupMsg(T('backup.invalid'), true); return; }
        let msg = T('backup.imported', { a: r.added, u: r.updated, k: r.kept, m: r.images });
        if (r.failed) msg += ' · ' + T('backup.partial', { f: r.failed });
        this._backupMsg(msg, !!r.failed);
      } catch (e) {
        console.error('[Landing] import failed:', e);
        this._backupMsg(T('backup.failed'), true);
      }
    });
  },

  /* ---- Role Card Navigation ---- */
  _bindRoleCards() {
    document.querySelectorAll('.role-card').forEach(card => {
      card.addEventListener('click', (e) => {
        const href = card.getAttribute('href');
        if (!href) return;
        // Add transition effect
        card.style.opacity = '0.7';
        card.style.transform = 'scale(0.98)';
        setTimeout(() => { window.location.href = href; }, 150);
        e.preventDefault();
      });
      // Keyboard support
      card.setAttribute('tabindex', '0');
      card.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          card.click();
          e.preventDefault();
        }
      });
    });
  }
};

/* ---- Auto Init ---- */
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => LandingPage.init());
} else {
  LandingPage.init();
}

window.LandingPage = LandingPage;
