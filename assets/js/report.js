/* ============================================
   REPORT.JS - Inspection report view + PDF download
   Loads a submitted inspection (?session=<key>) from StorageAdapter,
   renders it as a printable report, and exports it to PDF in the browser
   (html2pdf.js). No network requests are made for the data itself.
   ============================================ */

const MEASURE_CATEGORIES = [
  { key: 'carton_dimension_weight', zh: '箱体尺寸与重量', en: 'Dimension Carton & Weight' },
  { key: 'every_panel', zh: '每个面板', en: 'Every Panel' },
  { key: 'assembly_instruction', zh: '装配说明', en: 'Assembly Instruction' },
  { key: 'accessories', zh: '配件', en: 'Accessories' },
  { key: 'fully_assembly', zh: '完整装配', en: 'Fully Assembly' },
  { key: 'dimension_assembly', zh: '装配尺寸', en: 'Dimension Assembly' },
  { key: 'warning_label', zh: '警告标签', en: 'Warning Label' }
];

// Supplier is fixed for this deployment; older records saved before the field existed show it too.
const SUPPLIER_NAME = 'Decor Trend Industries Sdn Bhd';

const Report = {
  sessionKey: null,
  data: null,
  imageMap: {},   // photoId -> data URL
  _busy: false,

  _lang() {
    return (window.I18n && I18n.current) || 'zh';
  },

  _esc(str) {
    return String(str == null ? '' : str).replace(/[&<>"']/g, c => (
      { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
    ));
  },

  _txt(zh, en) {
    return this._lang() === 'zh' ? zh : en;
  },

  async init() {
    const root = document.getElementById('reportRoot');
    const params = new URLSearchParams(window.location.search);
    this.sessionKey = params.get('session');

    if (!this.sessionKey || typeof StorageAdapter === 'undefined') {
      this._showMessage(this._txt('未指定检验单。请从客户列表中选择一份已提交的报告。',
        'No inspection selected. Please open a submitted report from the Customer List.'));
      return;
    }

    let data = null;
    try { data = await StorageAdapter.load(this.sessionKey); } catch (e) { console.error(e); }

    if (!data || (data.status !== 'submitted' && data.status !== 'approved')) {
      this._showMessage(this._txt('找不到这份已提交的检验单（可能保存在另一台设备或浏览器中）。',
        'This submitted inspection was not found (it may be stored on another device or browser).'));
      return;
    }
    this.data = data;

    // Resolve every photo to a data URL up front so render() and the PDF export
    // are synchronous and don't depend on timing.
    const originalId = this.sessionKey.replace(/^session_/, '');
    const ids = this._allPhotoIds(data);
    await Promise.all(ids.map(async id => {
      try { this.imageMap[id] = await StorageAdapter.loadImage(originalId, id); }
      catch (e) { this.imageMap[id] = null; }
    }));

    this.render();

    // Re-render when the language is switched (I18n only re-labels data-i18n nodes).
    document.querySelectorAll('.lang-btn').forEach(btn => {
      btn.addEventListener('click', () => setTimeout(() => this.render(), 0));
    });
    void root;
  },

  _allPhotoIds(data) {
    const set = new Set(data.photos || []);
    const boxes = (data.measurements && data.measurements.boxes) || {};
    Object.keys(boxes).forEach(b => {
      Object.keys(boxes[b] || {}).forEach(c => {
        ((boxes[b][c] || {}).photoIds || []).forEach(id => set.add(id));
      });
    });
    return Array.from(set);
  },

  _showMessage(msg) {
    const root = document.getElementById('reportRoot');
    root.innerHTML = '<div class="loading-screen"><p>' + this._esc(msg) + '</p></div>';
    const btn = document.getElementById('downloadPdfBtn');
    if (btn) btn.disabled = true;
  },

  _photoHtml(id) {
    const src = this.imageMap[id];
    if (!src) return '';
    return '<div class="report-photo"><img src="' + this._esc(src) + '" alt=""></div>';
  },

  _photoGrid(ids) {
    const html = (ids || []).map(id => this._photoHtml(id)).join('');
    return html ? '<div class="report-photo-grid">' + html + '</div>' : '';
  },

  render() {
    const d = this.data;
    if (!d) return;
    const lang = this._lang();
    const e = v => this._esc(v);
    const dash = v => (v == null || v === '' ? '-' : e(v));
    const typeKey = d.type ? 'form.type.' + d.type : null;
    const typeText = typeKey && window.t ? t(typeKey) : (d.type || '-');
    const date = d.inspectionDate
      ? InspectionCore.Utils.formatDate(d.inspectionDate, lang)
      : '-';

    const sub = document.getElementById('reportSubtitle');
    if (sub) sub.textContent = d.customer || '';

    const info = [
      [this._txt('客户', 'Customer'), dash(d.customer), this._txt('检验日期', 'Inspection Date'), dash(date)],
      [this._txt('PI 号', 'PI No.'), dash(d.pi), this._txt('批次', 'Batch'), dash(d.batch)],
      [this._txt('型号', 'Model'), dash(d.model), this._txt('版本', 'Version'), dash(d.version)],
      [this._txt('颜色', 'Color'), dash(d.color), this._txt('检验类型', 'Inspection Type'), dash(typeText)],
      [this._txt('箱数', 'Box Count'), dash(d.boxCount), this._txt('提交时间', 'Submitted'), dash(d.timestamp)],
      [this._txt('检验人', 'Inspection By'), dash(d.inspectionBy), this._txt('PO 号 / 订单号', 'PO No / Order No'), dash(d.poNo)],
      [this._txt('总数量', 'Total Quantity'), dash(d.totalQuantity), this._txt('抽样数量', 'Sample Size'), dash(d.sampleSize)]
    ].map(r => '<tr><td>' + r[0] + '</td><td>' + r[1] + '</td><td>' + r[2] + '</td><td>' + r[3] + '</td></tr>').join('') +
      '<tr><td>' + this._txt('供应商', 'Supplier') + '</td><td colspan="3">' + e(d.supplier || SUPPLIER_NAME) + '</td></tr>';

    // Measurements, grouped by box then category
    const boxes = (d.measurements && d.measurements.boxes) || {};
    const boxNums = Object.keys(boxes).sort((a, b) => Number(a) - Number(b));
    let measureHtml = '';
    boxNums.forEach(b => {
      let inner = '';
      MEASURE_CATEGORIES.forEach(cat => {
        const entry = (boxes[b] || {})[cat.key];
        if (!entry) return;
        const hasPhotos = (entry.photoIds || []).some(id => this.imageMap[id]);
        if (!hasPhotos && !(entry.detail || '').trim()) return;
        inner += '<div class="report-section">' +
          '<div class="section-title">' + e(cat[lang] || cat.en) + '</div>' +
          ((entry.detail || '').trim()
            ? '<div class="report-detail">' + e(entry.detail).replace(/\n/g, '<br>') + '</div>' : '') +
          this._photoGrid(entry.photoIds) +
          '</div>';
      });
      if (inner) {
        measureHtml += '<h3 class="report-box-title">' + this._txt('第 ' + b + ' 箱', 'Box ' + b) + '</h3>' + inner;
      }
    });

    // Photos not attached to any measurement category
    const used = new Set();
    boxNums.forEach(b => Object.keys(boxes[b] || {}).forEach(c => {
      ((boxes[b][c] || {}).photoIds || []).forEach(id => used.add(id));
    }));
    const loose = (d.photos || []).filter(id => !used.has(id));
    const looseHtml = this._photoGrid(loose)
      ? '<div class="report-section"><div class="section-title">' + this._txt('现场照片', 'Site Photos') + '</div>' +
        this._photoGrid(loose) + '</div>'
      : '';

    const root = document.getElementById('reportRoot');
    root.innerHTML =
      '<div class="report-header">' +
        '<div class="report-header-left"><h1>' + this._txt('检验报告', 'Inspection Report') + '</h1>' +
        '<h2>' + dash(d.customer) + '</h2></div>' +
        '<div class="report-header-right"><div class="report-logo">' + this._txt('检验门户', 'Inspection Portal') + '</div></div>' +
      '</div>' +
      '<table class="info-table">' + info + '</table>' +
      (measureHtml ? '<div class="report-section"><div class="section-title">' + this._txt('尺寸测量', 'Measurements') + '</div></div>' + measureHtml : '') +
      looseHtml +
      '<div class="report-footer"><span>' + this._txt('由检验门户生成', 'Generated by Inspection Portal') + '</span>' +
      '<span>' + e(new Date().toLocaleDateString(lang === 'zh' ? 'zh-CN' : 'en-US')) + '</span></div>';
  },

  _fileName() {
    const d = this.data || {};
    const clean = s => String(s || '').replace(/[\\/:*?"<>|\s]+/g, '_').replace(/^_+|_+$/g, '');
    const parts = ['Inspection_Report', clean(d.customer), clean(d.inspectionDate)].filter(Boolean);
    return parts.join('_') + '.pdf';
  },

  async downloadPDF() {
    if (this._busy || !this.data) return;
    if (typeof html2pdf === 'undefined') {
      InspectionCore.Utils.toast(this._txt('PDF 组件未能加载，请检查网络后刷新页面', 'PDF library failed to load. Check your connection and reload.'), 'error');
      return;
    }
    const btn = document.getElementById('downloadPdfBtn');
    const label = btn && btn.querySelector('span');
    const original = label ? label.textContent : '';
    this._busy = true;
    if (btn) btn.disabled = true;
    if (label) label.textContent = this._txt('生成中...', 'Generating...');

    try {
      await html2pdf().set({
        margin: [10, 10, 10, 10],
        filename: this._fileName(),
        image: { type: 'jpeg', quality: 0.92 },
        html2canvas: { scale: 2, useCORS: true, backgroundColor: '#ffffff', scrollY: 0 },
        jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' },
        pagebreak: { mode: ['css', 'legacy'], avoid: ['.report-photo', '.info-table tr', '.section-title'] }
      }).from(document.getElementById('reportRoot')).save();
      InspectionCore.Utils.toast(this._txt('PDF 已生成', 'PDF downloaded'), 'success');
    } catch (err) {
      console.error('[Report] PDF export failed:', err);
      InspectionCore.Utils.toast(this._txt('PDF 生成失败', 'PDF export failed'), 'error');
    } finally {
      this._busy = false;
      if (btn) btn.disabled = false;
      if (label) label.textContent = original;
    }
  }
};

window.Report = Report;
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => Report.init());
} else {
  Report.init();
}
