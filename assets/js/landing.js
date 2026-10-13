/* ============================================
   LANDING.JS - Landing Page Logic for FATT Portal
   ============================================ */

const LandingPage = {
  init() {
    this._checkStorage();
    this._bindRoleCards();
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
