/* ============================================
   QC PAGE - Review and approve inspections
   ============================================ */

const QC = {
  storage: null,
  currentSession: null,
  currentBox: 1,
  currentFilter: 'pending',

  async init() {
    this.storage = await Storage.get();
    this.bindEvents();

    const params = InspectionCore.Utils.getParams();
    if (params.session) {
      await this.openSession(params.session);
    } else {
      await this.showDashboard();
    }
  },

  bindEvents() {
    document.querySelectorAll('.filter-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        this.currentFilter = btn.dataset.filter;
        this.loadSessions();
      });
    });
  },

  async showDashboard() {
    document.getElementById('dashboardView').classList.remove('hidden');
    document.getElementById('reviewView').classList.add('hidden');
    history.replaceState({}, '', '?role=qc');
    await this.loadSessions();
  },

  async loadSessions() {
    const sessions = await this.storage.listSessions();

    // Pending = in_progress with status not yet QC-reviewed
    const pending = sessions.filter(s => !s.qcReview);
    const reviewed = sessions.filter(s => s.qcReview);

    document.getElementById('pendingCount').textContent = pending.length;
    document.getElementById('reviewedCount').textContent = reviewed.length;

    let filtered = sessions;
    if (this.currentFilter === 'pending') filtered = pending;
    else if (this.currentFilter === 'reviewed') filtered = reviewed;

    const list = document.getElementById('sessionList');
    if (filtered.length === 0) {
      list.innerHTML = `
        <div class="empty-state">
          <div class="empty-state-title">${t('msg.no_data')}</div>
        </div>
      `;
      return;
    }

    const lang = I18n.current;
    list.innerHTML = filtered.map(s => {
      const defectCount = (s.defectCounts && s.defectCounts.total) || 0;
      const reviewBadge = s.qcReview
        ? `<span class="badge badge-${s.qcReview.decision === 'approved' ? 'ok' : 'error'}">${t('common.' + s.qcReview.decision)}</span>`
        : `<span class="badge badge-pending">${t('qc.pending_review')}</span>`;

      return `
        <div class="session-card" onclick="QC.openSession('${s.id}')">
          <div class="session-card-header">
            <div>
              <div class="session-id">${s.pi} Â· ${s.id}</div>
              <div class="session-title">${s.model}-${s.version}</div>
              <div class="session-customer">${s.customer} Â· ${s.color}</div>
            </div>
            ${reviewBadge}
          </div>
          <div class="session-meta">
            <span class="session-meta-item">ð ${InspectionCore.Utils.formatDate(s.inspectionDate, lang)}</span>
            <span class="session-meta-item">ð¦ ${s.boxCount} ${lang === 'zh' ? 'ç®±' : 'boxes'}</span>
            <span class="session-meta-item">ð·ï¸ ${s.type}</span>
            ${defectCount > 0 ? `<span class="session-meta-item defect-count">â  ${defectCount} ${lang === 'zh' ? 'ç¼ºé·' : 'defects'}</span>` : ''}
          </div>
        </div>
      `;
    }).join('');
  },

  async openSession(sessionId) {
    const session = await this.storage.getSession(sessionId);
    if (!session) {
      InspectionCore.Utils.toast(t('msg.error'), 'error');
      return;
    }

    this.currentSession = session;
    this.currentBox = 1;

    document.getElementById('dashboardView').classList.add('hidden');
    document.getElementById('reviewView').classList.remove('hidden');
    history.replaceState({}, '', '?role=qc&session=' + sessionId);

    document.getElementById('reviewTitle').textContent = `${session.model}-${session.version} Â· ${session.color}`;
    document.getElementById('reviewMeta').textContent = `${session.customer} Â· PI: ${session.pi} Â· ${session.type}`;

    if (session.qcReview && session.qcReview.comment) {
      document.getElementById('qcComment').value = session.qcReview.comment;
    } else {
      document.getElementById('qcComment').value = '';
    }

    this.renderInfo();
    await this.renderDefects();
    this.renderBoxTabs();
    await this.renderBoxContent();
  },

  renderInfo() {
    const s = this.currentSession;
    const lang = I18n.current;

    const items = [
      { label: t('form.inspector'), value: s.inspector || 'â' },
      { label: t('form.inspection_date'), value: InspectionCore.Utils.formatDate(s.inspectionDate, lang) },
      { label: t('form.supplier'), value: s.supplier || 'â' },
      { label: t('form.box_count'), value: s.boxCount },
      { label: t('form.sample_qty'), value: s.sampleQty || 'â' },
      { label: t('form.order_qty'), value: s.orderQty || 'â' },
    ];

    document.getElementById('reviewInfo').innerHTML = items.map(it => `
      <div class="review-info-item">
        <div class="review-info-label">${it.label}</div>
        <div class="review-info-value">${this.escape(it.value)}</div>
      </div>
    `).join('');
  },

  async renderDefects() {
    const defects = await this.storage.listDefects(this.currentSession.id);
    const container = document.getElementById('reviewDefects');
    const lang = I18n.current;

    if (defects.length === 0) {
      container.innerHTML = `<div class="text-tertiary text-sm">${t('defect.no_defects')}</div>`;
      return;
    }

    container.innerHTML = defects.map(d => {
      const code = InspectionCore.DEFECT_CODES.find(c => c.code === d.code);
      return `
        <div class="defect-card">
          <div class="defect-card-header">
            <div>
              <div class="defect-code">${d.code}</div>
              <div class="defect-desc">${this.escape(d.description)}</div>
            </div>
            <span class="badge badge-${d.severity}">${t('defect.' + d.severity)}</span>
          </div>
          ${d.photos && d.photos.length > 0 ? `
            <div class="defect-photos">
              ${d.photos.map(p => `
                <div class="defect-photo" onclick="QC.viewPhotoUrl('${p.dataUrl || p.url}')">
                  <img src="${p.dataUrl || p.url}" alt="" />
                </div>
              `).join('')}
            </div>
          ` : ''}
          <div class="defect-card-footer">
            <span>${lang === 'zh' ? 'å½±å' : 'Affects'}: ${d.affected} Â· ${lang === 'zh' ? 'ç¬¬' : 'Box'} ${d.boxNumber} ${lang === 'zh' ? 'ç®±' : ''}</span>
          </div>
        </div>
      `;
    }).join('');
  },

  renderBoxTabs() {
    const tabs = document.getElementById('reviewBoxTabs');
    const html = [];
    for (let i = 1; i <= this.currentSession.boxCount; i++) {
      const isActive = i === this.currentBox ? 'active' : '';
      html.push(`<button class="box-tab ${isActive}" onclick="QC.switchBox(${i})">${t('photo.box', { n: i })}</button>`);
    }
    tabs.innerHTML = html.join('');
  },

  switchBox(n) {
    this.currentBox = n;
    document.querySelectorAll('#reviewBoxTabs .box-tab').forEach((tab, i) => {
      tab.classList.toggle('active', i + 1 === n);
    });
    this.renderBoxContent();
  },

  async renderBoxContent() {
    const items = InspectionCore.Utils.getBoxItems(this.currentBox);
    const container = document.getElementById('reviewBoxContent');
    const sessionFiles = await this.storage.listFiles(this.currentSession.id);

    const html = items.map(item => {
      const folderPath = `box-${this.currentBox}/${item.key}`;

      if (item.sub) {
        const subContent = item.sub.map(sub => {
          const subPath = `box-${this.currentBox}/${item.key}/${sub.key}`;
          const photos = sessionFiles.filter(f => f.folderPath === subPath);
          return `
            <div class="sub-item">
              <div class="sub-item-title">${t(sub.i18n)}</div>
              ${this.renderPhotos(photos)}
            </div>
          `;
        }).join('');

        return `
          <div class="box-item-card">
            <div class="box-item-header">
              <div class="box-item-title">${t(item.i18n)}</div>
            </div>
            <div class="box-item-body">${subContent}</div>
          </div>
        `;
      } else {
        const photos = sessionFiles.filter(f => f.folderPath === folderPath);
        return `
          <div class="box-item-card">
            <div class="box-item-header">
              <div class="box-item-title">${t(item.i18n)}</div>
              <div class="box-item-status">${photos.length} ${I18n.current === 'zh' ? 'å¼ ' : 'photos'}</div>
            </div>
            <div class="box-item-body">${this.renderPhotos(photos)}</div>
          </div>
        `;
      }
    }).join('');

    container.innerHTML = html;
  },

  renderPhotos(photos) {
    if (photos.length === 0) {
      return `<div class="text-tertiary text-sm">${t('photo.no_photos')}</div>`;
    }
    return `
      <div class="photo-grid">
        ${photos.map(p => `
          <div class="photo-item" onclick="QC.viewPhotoUrl('${p.dataUrl || p.url}')">
            <img src="${p.dataUrl || p.url}" alt="" loading="lazy" />
          </div>
        `).join('')}
      </div>
    `;
  },

  viewPhotoUrl(url) {
    document.getElementById('photoViewerImg').src = url;
    document.getElementById('photoViewer').classList.remove('hidden');
  },

  closePhotoViewer() {
    document.getElementById('photoViewer').classList.add('hidden');
  },

  async approve() {
    if (!confirm(I18n.current === 'zh' ? 'ç¡®è®¤æ¹åæ­¤æ£éªï¼' : 'Approve this inspection?')) return;

    this.currentSession.qcReview = {
      decision: 'approved',
      comment: document.getElementById('qcComment').value.trim(),
      reviewedAt: new Date().toISOString(),
    };
    this.currentSession.status = 'approved';

    await this.storage.saveSession(this.currentSession);
    InspectionCore.Utils.toast(t('msg.saved'), 'success');
    setTimeout(() => this.showDashboard(), 800);
  },

  async reject() {
    const comment = document.getElementById('qcComment').value.trim();
    if (!comment) {
      InspectionCore.Utils.toast(I18n.current === 'zh' ? 'è¯·å¡«åæç»åå ' : 'Please add a comment', 'error');
      return;
    }
    if (!confirm(I18n.current === 'zh' ? 'ç¡®è®¤æç»æ­¤æ£éªï¼' : 'Reject this inspection?')) return;

    this.currentSession.qcReview = {
      decision: 'rejected',
      comment,
      reviewedAt: new Date().toISOString(),
    };
    this.currentSession.status = 'rejected';

    await this.storage.saveSession(this.currentSession);
    InspectionCore.Utils.toast(t('msg.saved'), 'success');
    setTimeout(() => this.showDashboard(), 800);
  },

  viewReport() {
    window.open(`report.html?session=${this.currentSession.id}`, '_blank');
  },

  escape(s) {
    if (s == null) return '';
    return String(s).replace(/[&<>"']/g, m => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[m]));
  },
};

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => QC.init());
} else {
  QC.init();
}

window.QC = QC;
