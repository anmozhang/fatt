/* ============================================
   REPORT.JS - Inspection report view + PDF download
   Loads a submitted inspection (?session=<key>) from StorageAdapter,
   renders it as a printable report, and exports it to PDF in the browser
   (html2pdf.js). No network requests are made for the data itself.
   ============================================ */

// Per-box categories
const MEASURE_CATEGORIES = [
  { key: 'carton_dimension_weight', zh: '箱体尺寸与重量', en: 'Dimension Carton & Weight', dims: true },
  { key: 'carton_marking_barcode', zh: '箱唛与条码', en: 'Carton Shipping Marking & Barcode' },
  { key: 'every_panel', zh: '内部包装', en: 'Internal Packaging' },
  { key: 'assembly_instruction', zh: '装配说明', en: 'Assembly Instruction' },
  { key: 'accessories', zh: '配件', en: 'Accessories' },
  { key: 'warning_label', zh: '警告标签/产品标签', en: 'Warning Label/Product label' }
];
// Independent sections (not repeated per box), stored in measurements.assembly
const GLOBAL_CATEGORIES = [
  { key: 'fully_assembly', zh: '完整装配', en: 'Fully Assembly' },
  { key: 'dimension_assembly', zh: '装配尺寸', en: 'Dimension Assembly', dims: true },
  { key: 'assembly_weight', zh: '重量', en: 'Weight', grossWeight: true }
];
// Each box has its own Weight section (Gross Weight + photos + note)
const BOX_WEIGHT = { key: 'carton_weight', zh: '重量', en: 'Weight', grossWeight: true };
// Weight / test sections (independent, stored in measurements.assembly)
const TEST_SECTIONS = [
  { key: 'weight_of_product', zh: '产品重量', en: 'Weight of Product', netWeight: true },
  { key: 'drop_test', zh: '跌落测试', en: 'Drop Test', optional: true },
  { key: 'drop_test_result', zh: '跌落测试检验结果', en: 'Drop Test Inspection Result', result: true, optional: true }
];
const CONSTRUCTION_TITLE = { zh: '结构测试', en: 'Construction Test' };
const CONSTRUCTION_ITEMS = [
  { key: 'strength_test', zh: '强度测试', en: 'Strength Test' },
  { key: 'static_test', zh: '静态测试', en: 'Static Test' },
  { key: 'moisture_test', zh: '湿度测试', en: 'Moisture Test' }
];
const DIM_FIELD_WEIGHT_LEGACY = { key: 'weight', zh: '重量', en: 'Weight' };
const DIM_FIELDS = [
  { key: 'length', zh: '长', en: 'Length' },
  { key: 'width', zh: '宽', en: 'Width' },
  { key: 'height', zh: '高', en: 'Height' }
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

  // Pass / Fail decided in Customer List -> Feedback (stored as data.result).
  _result() {
    const r = this.data && this.data.result;
    return r === 'pass' || r === 'fail' ? r : null;
  },
  _resultLabel() {
    const r = this._result();
    return r === 'pass' ? 'Pass' : r === 'fail' ? 'Fail' : '';
  },

  // The PDF can only be exported once a result has been chosen.
  _updatePdfState() {
    const btn = document.getElementById('downloadPdfBtn');
    const ok = !!this._result();
    if (btn) {
      btn.disabled = !ok || this._busy;
      btn.title = ok ? '' : this._txt('请先在 客户列表 → Feedback 中选择 Pass / Fail', 'Choose Pass / Fail in Customer List → Feedback first');
    }
    let note = document.getElementById('resultNotice');
    if (!ok) {
      if (!note) {
        note = document.createElement('div');
        note.id = 'resultNotice';
        note.className = 'no-print';
        note.style.cssText = 'max-width:960px;margin:12px auto 0;padding:10px 14px;border-radius:8px;background:rgba(255,167,38,0.15);color:#ffa726;font-size:13px;';
        const root = document.getElementById('reportRoot');
        root.parentNode.insertBefore(note, root);
      }
      note.textContent = this._txt('请先在 客户列表 → Feedback 中选择 Pass / Fail，才能下载 PDF。',
        'Choose Pass / Fail under Customer List → Feedback before downloading the PDF.');
    } else if (note) {
      note.remove();
    }
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

  // Every photo id attached to a measurement entry (general list + per-dimension lists)
  _entryPhotoIds(entry) {
    const ids = [...((entry && entry.photoIds) || [])];
    if (entry && entry.dimPhotos) Object.keys(entry.dimPhotos).forEach(f => ids.push(...(entry.dimPhotos[f] || [])));
    return ids;
  },

  _allPhotoIds(data) {
    const set = new Set(data.photos || []);
    const boxes = (data.measurements && data.measurements.boxes) || {};
    Object.keys(boxes).forEach(b => {
      Object.keys(boxes[b] || {}).forEach(c => {
        this._entryPhotoIds(boxes[b][c]).forEach(id => set.add(id));
      });
    });
    const asm = (data.measurements && data.measurements.assembly) || {};
    Object.keys(asm).forEach(c => this._entryPhotoIds(asm[c]).forEach(id => set.add(id)));
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
    // Empty values print as Not Applicable
    const NA = 'Not Applicable';
    const dash = v => (v == null || String(v).trim() === '' || v === '-' ? NA : e(v));
    const typeKey = d.type ? 'form.type.' + d.type : null;
    const typeText = typeKey && window.t ? t(typeKey) : (d.type || '-');
    const date = d.inspectionDate
      ? InspectionCore.Utils.formatDate(d.inspectionDate, lang)
      : '';

    const resultLabel = this._resultLabel();
    // Overall Result sits right under Supplier: teal highlight for Pass, red for Fail
    const resultBg = this._result() === 'pass' ? '#14b8a6' : '#e53935';
    const overallRow = resultLabel
      ? '<tr><td colspan="4" style="background:' + resultBg + ';color:#ffffff;font-weight:700;font-size:15px;padding:10px 12px;border:none;width:auto;">' +
        this._txt('总体结果', 'Overall Result') + ' : ' + resultLabel + '</td></tr>'
      : '';

    const sub = document.getElementById('reportSubtitle');
    if (sub) sub.textContent = d.customer || '';

    const info = [
      [this._txt('客户代码', 'Customer Code'), dash(d.customer), this._txt('检验日期', 'Inspection Date'), dash(date)],
      [this._txt('PI 号', 'PI No.'), dash(d.pi), this._txt('批次', 'Batch'), dash(d.batch)],
      [this._txt('型号', 'Model'), dash(d.model), this._txt('版本', 'Version'), dash(d.version)],
      [this._txt('颜色', 'Color'), dash(d.color), this._txt('检验类型', 'Inspection Type'), dash(typeText)],
      [this._txt('箱数', 'Box Count'), dash(d.boxCount), this._txt('提交时间', 'Submitted'), dash(d.submittedAt ? new Date(d.submittedAt).toLocaleString(lang === 'zh' ? 'zh-CN' : 'en-GB', { hour12: false }) : d.timestamp)],
      [this._txt('检验人', 'Inspection By'), dash(d.inspectionBy), this._txt('PO 号 / 订单号', 'PO No / Order No'), dash(d.poNo)],
      [this._txt('总数量', 'Total Quantity'), dash(d.totalQuantity), this._txt('抽样数量', 'Sample Size'), dash(d.sampleSize)]
    ].map(r => '<tr><td>' + r[0] + '</td><td>' + r[1] + '</td><td>' + r[2] + '</td><td>' + r[3] + '</td></tr>').join('') +
      '<tr><td>' + this._txt('供应商', 'Supplier') + '</td><td colspan="3">' + e(d.supplier || SUPPLIER_NAME) + '</td></tr>' + overallRow;

    // Measurements: per-box categories first, then the independent sections.
    const boxes = (d.measurements && d.measurements.boxes) || {};
    const assembly = (d.measurements && d.measurements.assembly) || {};
    // Every box listed in the inspection is shown, even if nothing was filled in.
    const boxSet = new Set(Object.keys(boxes).map(Number));
    for (let i = 1; i <= (parseInt(d.boxCount, 10) || 0); i++) boxSet.add(i);
    const boxNums = Array.from(boxSet).sort((x, y) => x - y);

    const hasContent = (cat, entry) => {
      if (!entry) return false;
      if (this._entryPhotoIds(entry).some(id => this.imageMap[id])) return true;
      if ((entry.detail || '').trim()) return true;
      if (cat.netWeight && String(entry.netWeight || '').trim()) return true;
      if (cat.grossWeight && String(entry.grossWeight || '').trim()) return true;
      if (cat.result && entry.result) return true;
      const dims = entry.dims || {};
      return !!cat.dims && DIM_FIELDS.concat([DIM_FIELD_WEIGHT_LEGACY]).some(f => String(dims[f.key] == null ? '' : dims[f.key]).trim() !== '');
    };
    // Dimension sections: every field prints its value with its own photos underneath.
    // Reports submitted before per-field photos existed keep the old inline layout.
    const dimsHtml = entry => {
      const dims = entry.dims || {};
      // Reports saved when Weight was still a dimension field keep printing it
      const legacyW = DIM_FIELD_WEIGHT_LEGACY;
      const hasLegacyW = String(dims.weight == null ? '' : dims.weight).trim() !== '' ||
        ((entry.dimPhotos && entry.dimPhotos.weight) || []).some(id => this.imageMap[id]);
      const fields = hasLegacyW ? DIM_FIELDS.concat([legacyW]) : DIM_FIELDS;
      const val = f => { const v = String(dims[f.key] == null ? '' : dims[f.key]).trim(); return v ? e(v) : NA; };
      if (!entry.dimPhotos) {
        const cells = fields.map(f => '<span class="report-dim"><b>' + e(f[lang] || f.en) + ':</b> ' + val(f) + '</span>');
        const anyPhoto = (entry.photoIds || []).some(id => this.imageMap[id]);
        return '<div class="report-detail report-dims">' + cells.join(' &nbsp; ') + '</div>' +
          this._photoGrid(entry.photoIds) +
          (anyPhoto ? '' : '<div class="report-detail report-na">' + this._txt('照片：', 'Photos: ') + NA + '</div>');
      }
      return fields.map(f => {
        const ids = entry.dimPhotos[f.key] || [];
        const has = ids.some(id => this.imageMap[id]);
        return '<div class="report-detail report-dims"><b>' + e(f[lang] || f.en) + ':</b> ' + val(f) + '</div>' +
          (has ? this._photoGrid(ids) : '<div class="report-detail report-na">' + this._txt('照片：', 'Photos: ') + NA + '</div>');
      }).join('');
    };
    // A section with no photos / measurements / notes prints Not Applicable instead of vanishing.
    const sectionHtml = (cat, entry, sub) => {
      entry = entry || {};
      const note = (entry.detail || '').trim();
      const empty = !hasContent(cat, entry);
      // Net weight / pass-fail result print right under the title
      let extra = '';
      if (cat.netWeight) {
        const nw = String(entry.netWeight || '').trim();
        extra = '<div class="report-detail report-dims"><b>' + this._txt('净重', 'Net Weight') + ':</b> ' + (nw ? e(nw) : NA) + '</div>';
      }
      if (cat.grossWeight) {
        const gw = String(entry.grossWeight || '').trim();
        extra = '<div class="report-detail report-dims"><b>' + this._txt('毛重', 'Gross Weight') + ':</b> ' + (gw ? e(gw) : NA) + '</div>';
      }
      if (cat.result) {
        const r = entry.result === 'pass' ? ['#14b8a6', this._txt('合格 (Pass)', 'Pass')] : entry.result === 'fail' ? ['#e53935', this._txt('不合格 (Fail)', 'Fail')] : null;
        extra = '<div class="report-detail report-dims"><b>' + this._txt('结果', 'Result') + ':</b> ' +
          (r ? '<span style="display:inline-block;padding:2px 12px;border-radius:4px;background:' + r[0] + ';color:#ffffff;font-weight:700;">' + r[1] + '</span>' : NA) + '</div>';
      }
      const titleStyle = sub ? ' style="font-size:13px;text-transform:none;letter-spacing:0;font-weight:600;border-bottom-width:1px;border-bottom-color:#bbbbbb;margin-left:12px;"' : '';
      return '<div class="report-section">' +
        '<div class="section-title"' + titleStyle + '>' + e(cat[lang] || cat.en) + '</div>' + extra +
        (note ? '<div class="report-detail">' + e(note).replace(/\n/g, '<br>') + '</div>' : '') +
        (cat.dims ? dimsHtml(entry) : this._photoGrid(entry.photoIds)) +
        (!cat.dims && empty ? '<div class="report-detail report-na">' + NA + '</div>' : '') +
        '</div>';
    };

    let measureHtml = '';
    boxNums.forEach(b => {
      let inner = '';
      MEASURE_CATEGORIES.forEach(cat => { inner += sectionHtml(cat, (boxes[b] || {})[cat.key]); });
      if ((boxes[b] || {})[BOX_WEIGHT.key]) inner += sectionHtml(BOX_WEIGHT, boxes[b][BOX_WEIGHT.key]);
      // Reports saved before these became independent sections kept them per box
      GLOBAL_CATEGORIES.forEach(cat => {
        const old = (boxes[b] || {})[cat.key];
        if (!assembly[cat.key] && hasContent(cat, old)) inner += sectionHtml(cat, old);
      });
      measureHtml += '<h3 class="report-box-title">' + this._txt('第 ' + b + ' 箱', 'Box ' + b) + '</h3>' + inner;
    });
    let globalInner = '';
    GLOBAL_CATEGORIES.forEach(cat => {
      if (cat.grossWeight && !assembly[cat.key]) return;      // reports from before Weight became its own section
      globalInner += sectionHtml(cat, assembly[cat.key]);
    });
    measureHtml += '<h3 class="report-box-title">' + this._txt('装配', 'Assembly') + '</h3>' + globalInner;

    // Weight & tests (only for inspections that have these sections)
    const customKeys = Array.isArray(d.measurements && d.measurements.constructionCustom)
      ? d.measurements.constructionCustom
      : Object.keys(assembly).filter(k => assembly[k] && assembly[k].custom);
    const hasTests = TEST_SECTIONS.concat(CONSTRUCTION_ITEMS).some(c => assembly[c.key]) || customKeys.length > 0;
    if (hasTests) {
      // From Drop Test onward the sections are optional: nothing filled in = not printed
      let testInner = '';
      TEST_SECTIONS.forEach(cat => {
        if (cat.optional && !hasContent(cat, assembly[cat.key])) return;
        testInner += sectionHtml(cat, assembly[cat.key]);
      });
      let constructionInner = '';
      CONSTRUCTION_ITEMS.forEach(it => {
        if (!hasContent(it, assembly[it.key])) return;
        constructionInner += sectionHtml(it, assembly[it.key], true);
      });
      customKeys.forEach(k => {
        const en = assembly[k] || {};
        if (!hasContent({ key: k }, en)) return;
        const title = String(en.title || '').trim() || this._txt('未命名项目', 'Untitled');
        constructionInner += sectionHtml({ key: k, zh: title, en: title }, en, true);
      });
      if (constructionInner) {
        testInner += '<div class="report-section"><div class="section-title">' + e(CONSTRUCTION_TITLE[lang] || CONSTRUCTION_TITLE.en) + '</div></div>' + constructionInner;
      }
      measureHtml += '<h3 class="report-box-title">' + this._txt('重量与测试', 'Weight & Tests') + '</h3>' + testInner;
    }

    // Photos not attached to any measurement category
    const used = new Set();
    boxNums.forEach(b => Object.keys(boxes[b] || {}).forEach(c => {
      this._entryPhotoIds(boxes[b][c]).forEach(id => used.add(id));
    }));
    Object.keys(assembly).forEach(c => this._entryPhotoIds(assembly[c]).forEach(id => used.add(id)));
    const loose = (d.photos || []).filter(id => !used.has(id));
    const looseHtml = this._photoGrid(loose)
      ? '<div class="report-section"><div class="section-title">' + this._txt('现场照片', 'Site Photos') + '</div>' +
        this._photoGrid(loose) + '</div>'
      : '';

    const root = document.getElementById('reportRoot');
    root.innerHTML =
      '<div class="report-header" style="display:block;text-align:center;">' +
        '<h1 style="margin:0 0 4px;font-size:26px;font-weight:400;color:var(--text-secondary);">' + this._txt('检验报告', 'Inspection Report') + '</h1>' +
        '<h2 style="margin:0;font-size:22px;font-weight:600;color:var(--text-primary);">' + dash(d.customer) + '</h2>' +
      '</div>' +
      '<table class="info-table">' + info + '</table>' +
      '<div class="report-section"><div class="section-title">' + this._txt('尺寸测量', 'Measurements') + '</div></div>' + measureHtml +
      looseHtml +
      '<div class="report-footer"><span></span>' +
      '<span>' + e(new Date().toLocaleDateString(lang === 'zh' ? 'zh-CN' : 'en-US')) + '</span></div>';
    this._updatePdfState();
  },

  _fileName() {
    const d = this.data || {};
    const clean = s => String(s || '').replace(/[\\/:*?"<>|\s]+/g, '_').replace(/^_+|_+$/g, '');
    const parts = ['Inspection_Report', clean(d.customer), this._resultLabel(), clean(d.inspectionDate)].filter(Boolean);
    return parts.join('_') + '.pdf';
  },


  // Builds an off-screen, fixed-width copy of the report for PDF export and
  // pre-paginates it: any block (a photo row, a heading with its first photo
  // row, ...) that would straddle a page boundary is pushed down to the top of
  // the next page, so photos are never cut in half. Returns { el, height }.
  _buildPdfSource() {
    const WIDTH = 720;                       // px, maps to the 190mm printable width
    const PAGE_H = WIDTH * 277 / 190 - 3;    // px per A4 page (297mm - 2x10mm margin), small safety gap
    const el = document.getElementById('reportRoot').cloneNode(true);
    el.removeAttribute('id');
    // The wrapper keeps the copy off-screen; the copy itself stays in normal flow
    // because html2pdf clones its inline styles.
    const wrap = document.createElement('div');
    wrap.style.cssText = 'position:absolute;left:-99999px;top:0;width:' + WIDTH + 'px;';
    el.style.cssText = 'width:' + WIDTH + 'px;max-width:none;margin:0;padding:0;background:#ffffff;';

    // Photos in rows of three, one block per row (a grid can't be split between rows)
    el.querySelectorAll('.report-photo-grid').forEach(grid => {
      const items = Array.from(grid.children);
      grid.innerHTML = '';
      grid.style.display = 'block';
      for (let i = 0; i < items.length; i += 3) {
        const row = document.createElement('div');
        row.className = 'report-photo-row';
        row.style.cssText = 'display:flex;gap:8px;margin-bottom:8px;';
        items.slice(i, i + 3).forEach(it => {
          it.style.flex = '0 0 calc((100% - 16px) / 3)';
          row.appendChild(it);
        });
        grid.appendChild(row);
      }
    });
    wrap.appendChild(el);
    document.body.appendChild(wrap);

    const blocks = Array.from(el.querySelectorAll(
      '.report-header, .info-table, .report-box-title, .section-title, .report-detail, .report-photo-row, .report-footer'));
    const top0 = () => el.getBoundingClientRect().top;
    const rect = b => { const r = b.getBoundingClientRect(), t0 = top0(); return { t: r.top - t0, b: r.bottom - t0 }; };
    // Headings/measurements stay with whatever follows them
    const keepNext = (b, next) => {
      if (!next) return false;
      const c = b.classList;
      if (c.contains('report-box-title') || c.contains('section-title') || c.contains('report-dims')) return true;
      return c.contains('report-detail') && next.classList.contains('report-photo-row');
    };

    for (let i = 0; i < blocks.length; i++) {
      const b = blocks[i];
      const r = rect(b);
      let end = r.b, j = i;
      while (keepNext(blocks[j], blocks[j + 1])) { j++; end = rect(blocks[j]).b; }
      if (end - r.t >= PAGE_H) end = r.b;              // chain taller than a page: protect the block only
      // The small "generated by" footer is dropped rather than printed alone on a new page
      if (b.classList.contains('report-footer') && (r.t % PAGE_H < 60 || r.b > (Math.floor(r.t / PAGE_H) + 1) * PAGE_H)) {
        b.parentNode.removeChild(b);
        continue;
      }
      const page = Math.floor((r.t + 0.5) / PAGE_H);
      const boundary = (page + 1) * PAGE_H;
      if (end > boundary + 0.5 && r.t > page * PAGE_H + 0.5 && r.b - r.t < PAGE_H) {
        const spacer = document.createElement('div');
        spacer.style.cssText = 'height:' + Math.ceil(boundary - r.t) + 'px;';
        b.parentNode.insertBefore(spacer, b);
        for (let k = 0; k < 4; k++) {            // margin collapsing can leave it short: top up
          const now = rect(b).t;
          if (now >= boundary - 0.5) break;
          spacer.style.height = (parseFloat(spacer.style.height) + Math.ceil(boundary - now)) + 'px';
        }
      }
    }
    // Trim trailing margins so they can't spill onto an empty extra page
    const live = blocks.filter(x => el.contains(x));
    const lastBottom = live.length ? rect(live[live.length - 1]).b : el.getBoundingClientRect().height;
    el.style.height = Math.ceil(lastBottom) + 'px';
    el.style.overflow = 'hidden';
    return { el, wrap, height: Math.ceil(lastBottom), width: WIDTH };
  },

  async downloadPDF() {
    if (this._busy || !this.data) return;
    if (!this._result()) {
      InspectionCore.Utils.toast(this._txt('请先选择 Pass / Fail', 'Choose Pass / Fail first'), 'error');
      return;
    }
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

    let src = null;
    try {
      src = this._buildPdfSource();
      // Keep the canvas inside what phone browsers can allocate (area and height limits)
      const scale = Math.max(1, Math.min(2, Math.sqrt(14e6 / (src.width * src.height)), 16000 / src.height));
      await html2pdf().set({
        margin: [10, 10, 10, 10],
        filename: this._fileName(),
        image: { type: 'jpeg', quality: 0.92 },
        html2canvas: { scale: scale, useCORS: true, backgroundColor: '#ffffff', scrollY: 0, scrollX: 0 },
        jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' },
        pagebreak: { mode: [] }   // pages are laid out by _buildPdfSource()
      }).from(src.el).save();
      InspectionCore.Utils.toast(this._txt('PDF 已生成', 'PDF downloaded'), 'success');
    } catch (err) {
      console.error('[Report] PDF export failed:', err);
      InspectionCore.Utils.toast(this._txt('PDF 生成失败', 'PDF export failed'), 'error');
    } finally {
      if (src && src.wrap.parentNode) src.wrap.parentNode.removeChild(src.wrap);
      this._busy = false;
      this._updatePdfState();
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
