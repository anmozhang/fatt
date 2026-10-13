/* ============================================
   INSPECTION CORE - Shared utilities
   ============================================ */

const InspectionCore = {
  Utils: {
    // Show a toast notification
    toast(message, type = 'info') {
      // Remove any existing toast
      const existing = document.getElementById('ic-toast');
      if (existing) existing.remove();

      const toast = document.createElement('div');
      toast.id = 'ic-toast';
      toast.textContent = message;
      toast.style.cssText = [
        'position:fixed', 'bottom:24px', 'left:50%',
        'transform:translateX(-50%)', 'padding:12px 24px',
        'border-radius:8px', 'font-size:14px', 'font-weight:500',
        'z-index:9999', 'color:#fff', 'box-shadow:0 4px 12px rgba(0,0,0,0.3)',
        'transition:opacity 0.3s ease'
      ].join(';');

      const colors = {
        success: '#22c55e',
        error:   '#ef4444',
        warning: '#f59e0b',
        info:    '#3b82f6'
      };
      toast.style.background = colors[type] || colors.info;

      document.body.appendChild(toast);
      setTimeout(() => {
        toast.style.opacity = '0';
        setTimeout(() => toast.remove(), 300);
      }, 2500);
    }
  }
};

window.InspectionCore = InspectionCore;
