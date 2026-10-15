/* ============================================
   REPORT.JS - Inspection report view + Excel download
   Loads a submitted inspection (?session=<key>) from StorageAdapter,
   renders it as a report preview, and exports it to an .xlsx file in the
   browser (ExcelJS, bundled in assets/vendor). Photos are embedded in the
   sheet. No network requests are made.
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
  { key: 'dimension_assembly', zh: '装配尺寸', en: 'Dimension Assembly', dims: true }
];
// Each box has its own Weight section (Gross Weight + photos + note)
const BOX_WEIGHT = { key: 'carton_weight', zh: '重量', en: 'Weight', grossWeight: true };
// Weight / test sections (independent, stored in measurements.assembly)
const TEST_SECTIONS = [
  { key: 'weight_of_product', zh: '产品重量', en: 'Weight of Product', netWeight: true },
  { key: 'drop_test', zh: '跌落测试', en: 'Drop Test' },
  { key: 'drop_test_result', zh: '跌落测试检验结果', en: 'Drop Test Inspection Result', result: true }
];
const CONSTRUCTION_TITLE = { zh: '结构测试', en: 'Construction Test' };
const CONSTRUCTION_ITEMS = [
  { key: 'strength_test', zh: '强度测试', en: 'Strength Test' },
  { key: 'static_test', zh: '静态测试', en: 'Static Test' },
  { key: 'moisture_test', zh: '湿度测试', en: 'Moisture Test' }
];
const DIM_FIELD_WEIGHT_LEGACY = { key: 'weight', zh: '重量 (kg)', en: 'Weight (kg)' };
const DIM_FIELDS = [
  { key: 'length', zh: '长 (mm)', en: 'Length (mm)' },
  { key: 'width', zh: '宽 (mm)', en: 'Width (mm)' },
  { key: 'height', zh: '高 (mm)', en: 'Height (mm)' }
];

// Supplier is fixed for this deployment; older records saved before the field existed show it too.
const SUPPLIER_NAME = 'Decor Trend Industries Sdn Bhd';

const Report = {
  sessionKey: null,
  data: null,
  imageMap: {},   // photoId -> data URL
  _busy: false,

  // Dates are always printed as DD/MM/YYYY
  _dmy(v) {
    const m = String(v == null ? '' : v).match(/^(\d{4})-(\d{2})-(\d{2})(.*)$/);
    return m ? m[3] + '/' + m[2] + '/' + m[1] + m[4] : String(v == null ? '' : v);
  },
  _dmyTime(ms) {
    const d = new Date(ms), p = n => String(n).padStart(2, '0');
    return p(d.getDate()) + '/' + p(d.getMonth() + 1) + '/' + d.getFullYear() + ' ' + p(d.getHours()) + ':' + p(d.getMinutes()) + ':' + p(d.getSeconds());
  },

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

  // The Excel file can only be exported once a result has been chosen.
  _updateExportState() {
    const btn = document.getElementById('downloadXlsxBtn');
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
      note.textContent = this._txt('请先在 客户列表 → Feedback 中选择 Pass / Fail，才能下载 Excel。',
        'Choose Pass / Fail under Customer List → Feedback before downloading the Excel file.');
    } else if (note) {
      note.remove();
    }
  },

  async init() {
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

    // Resolve every photo to a data URL up front so render() and the Excel export
    // are synchronous and don't depend on timing.
    const originalId = this.sessionKey.replace(/^session_/, '');
    const ids = this._allPhotoIds(data);
    await Promise.all(ids.map(async id => {
      try { this.imageMap[id] = await StorageAdapter.loadImage(originalId, id); }
      catch (e) { this.imageMap[id] = null; }
    }));

    this.render();

    // Tap a photo in the on-screen report to see it larger
    document.getElementById('reportRoot').addEventListener('click', (ev) => {
      const img = ev.target && ev.target.closest ? ev.target.closest('.report-photo img') : null;
      if (img && window.Lightbox) Lightbox.openFrom(img, '#reportRoot .report-photo img');
    });

    // Re-render when the language is switched (I18n only re-labels data-i18n nodes).
    document.querySelectorAll('.lang-btn').forEach(btn => {
      btn.addEventListener('click', () => setTimeout(() => this.render(), 0));
    });
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
    const btn = document.getElementById('downloadXlsxBtn');
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


  /* ---- Report content as plain data ----
     The on-screen preview (render) and the Excel export both read this, so they always
     show the same thing. Empty values print as Not Applicable. */
  _model() {
    const d = this.data;
    const lang = this._lang();
    const NA = 'Not Applicable';
    const plain = v => (v == null || String(v).trim() === '' || v === '-' ? NA : String(v));
    const typeKey = d.type ? 'form.type.' + d.type : null;
    const typeText = typeKey && window.t ? t(typeKey) : (d.type || '-');
    const date = d.inspectionDate ? this._dmy(d.inspectionDate) : '';

    const info = [
      [this._txt('客户代码', 'Customer Code'), plain(d.customer), this._txt('检验日期', 'Inspection Date'), plain(date)],
      [this._txt('PI 号', 'PI No.'), plain(d.pi), this._txt('批次', 'Batch'), plain(d.batch)],
      [this._txt('型号', 'Model'), plain(d.model), this._txt('版本', 'Version'), plain(d.version)],
      [this._txt('颜色', 'Color'), plain(d.color), this._txt('检验类型', 'Inspection Type'), plain(typeText)],
      [this._txt('箱数', 'Box Count'), plain(d.boxCount), this._txt('提交时间', 'Submitted'), plain(d.submittedAt ? this._dmyTime(d.submittedAt) : this._dmy(d.timestamp))],
      [this._txt('检验人', 'Inspection By'), plain(d.inspectionBy), this._txt('PO 号 / 订单号', 'PO No / Order No'), plain(d.poNo)],
      [this._txt('总数量', 'Total Quantity'), plain(d.totalQuantity), this._txt('抽样数量', 'Sample Size'), plain(d.sampleSize)]
    ];

    const boxes = (d.measurements && d.measurements.boxes) || {};
    const assembly = (d.measurements && d.measurements.assembly) || {};
    // Every box listed in the inspection is shown, even if nothing was filled in.
    const boxSet = new Set(Object.keys(boxes).map(Number));
    for (let i = 1; i <= (parseInt(d.boxCount, 10) || 0); i++) boxSet.add(i);
    const boxNums = Array.from(boxSet).sort((x, y) => x - y);

    const visible = id => !!this.imageMap[id];
    const hasContent = (cat, entry) => {
      if (!entry) return false;
      if (this._entryPhotoIds(entry).some(visible)) return true;
      if ((entry.detail || '').trim()) return true;
      if (cat.netWeight && String(entry.netWeight || '').trim()) return true;
      if (cat.grossWeight && String(entry.grossWeight || '').trim()) return true;
      if (cat.result && entry.result) return true;
      const dims = entry.dims || {};
      return !!cat.dims && DIM_FIELDS.concat([DIM_FIELD_WEIGHT_LEGACY]).some(f => String(dims[f.key] == null ? '' : dims[f.key]).trim() !== '');
    };

    // Section items: kv (label + value or badge), inlinekv (several values on one line),
    // note, photos, na
    const photos = ids => { const list = (ids || []).filter(visible); return list.length ? [{ t: 'photos', ids: list }] : []; };
    const kv = (label, value, badge) => ({ t: 'kv', label: label, value: value ? String(value) : null, badge: badge || null });
    const naItem = text => ({ t: 'na', text: text });
    const photosNA = () => naItem(this._txt('照片：', 'Photos: ') + NA);
    const trimmed = v => String(v == null ? '' : v).trim();

    // Dimension sections: every field prints its value with its own photos underneath.
    // Reports submitted before per-field photos existed keep the old inline layout.
    const dimsItems = entry => {
      const dims = entry.dims || {};
      // Reports saved when Weight was still a dimension field keep printing it
      const hasLegacyW = trimmed(dims.weight) !== '' || ((entry.dimPhotos && entry.dimPhotos.weight) || []).some(visible);
      const fields = hasLegacyW ? DIM_FIELDS.concat([DIM_FIELD_WEIGHT_LEGACY]) : DIM_FIELDS;
      if (!entry.dimPhotos) {
        const out = [{ t: 'inlinekv', cells: fields.map(f => ({ label: f[lang] || f.en, value: trimmed(dims[f.key]) || null })) }];
        out.push(...photos(entry.photoIds));
        if (!(entry.photoIds || []).some(visible)) out.push(photosNA());
        return out;
      }
      const out = [];
      fields.forEach(f => {
        const ids = entry.dimPhotos[f.key] || [];
        out.push(kv(f[lang] || f.en, trimmed(dims[f.key])));
        if (ids.some(visible)) out.push(...photos(ids)); else out.push(photosNA());
      });
      return out;
    };

    // A section with no photos / measurements / notes prints Not Applicable instead of vanishing.
    const section = (cat, entry, isSub) => {
      entry = entry || {};
      const note = (entry.detail || '').trim();
      const empty = !hasContent(cat, entry);
      const items = [];
      // Net weight / gross weight / pass-fail result print right under the title
      if (cat.netWeight) items.push(kv(this._txt('净重 (kg)', 'Net Weight (kg)'), trimmed(entry.netWeight)));
      if (cat.grossWeight) items.push(kv(this._txt('毛重 (kg)', 'Gross Weight (kg)'), trimmed(entry.grossWeight)));
      if (cat.result && entry.result) {
        const r = entry.result === 'pass' ? { color: '#14b8a6', text: this._txt('合格 (Pass)', 'Pass') }
          : entry.result === 'fail' ? { color: '#e53935', text: this._txt('不合格 (Fail)', 'Fail') } : null;
        items.push(kv(this._txt('结果', 'Result'), null, r));
      }
      if (note) items.push({ t: 'note', text: note });
      if (cat.dims) items.push(...dimsItems(entry)); else items.push(...photos(entry.photoIds));
      if (!cat.dims && empty && !cat.netWeight && !cat.grossWeight) items.push(naItem(NA));
      return { kind: 'section', title: cat[lang] || cat.en, sub: !!isSub, items: items };
    };
    const heading = text => ({ kind: 'heading', text: text });

    const blocks = [{ kind: 'section', title: this._txt('尺寸测量', 'Measurements'), sub: false, items: [] }];
    boxNums.forEach(b => {
      blocks.push(heading(this._txt('第 ' + b + ' 箱', 'Box ' + b)));
      MEASURE_CATEGORIES.forEach(cat => blocks.push(section(cat, (boxes[b] || {})[cat.key])));
      if ((boxes[b] || {})[BOX_WEIGHT.key]) blocks.push(section(BOX_WEIGHT, boxes[b][BOX_WEIGHT.key]));
      // Reports saved before these became independent sections kept them per box
      GLOBAL_CATEGORIES.forEach(cat => {
        const old = (boxes[b] || {})[cat.key];
        if (!assembly[cat.key] && hasContent(cat, old)) blocks.push(section(cat, old));
      });
    });
    blocks.push(heading(this._txt('装配', 'Assembly')));
    GLOBAL_CATEGORIES.forEach(cat => blocks.push(section(cat, assembly[cat.key])));

    // Weight & tests: always printed. Drop Test onward are optional to fill in, so
    // anything left empty (or never opened) prints Not Applicable.
    const customKeys = Array.isArray(d.measurements && d.measurements.constructionCustom)
      ? d.measurements.constructionCustom
      : Object.keys(assembly).filter(k => assembly[k] && assembly[k].custom);
    blocks.push(heading(this._txt('重量与测试', 'Weight & Tests')));
    TEST_SECTIONS.forEach(cat => blocks.push(section(cat, assembly[cat.key])));
    const construction = [];
    CONSTRUCTION_ITEMS.forEach(it => {
      if (hasContent(it, assembly[it.key])) construction.push(section(it, assembly[it.key], true));
    });
    customKeys.forEach(k => {
      const en = assembly[k] || {};
      if (!hasContent({ key: k }, en)) return;
      const title = String(en.title || '').trim() || this._txt('未命名项目', 'Untitled');
      construction.push(section({ key: k, zh: title, en: title }, en, true));
    });
    blocks.push({ kind: 'section', title: CONSTRUCTION_TITLE[lang] || CONSTRUCTION_TITLE.en, sub: false, items: construction.length ? [] : [naItem(NA)] });
    construction.forEach(x => blocks.push(x));

    // Photos not attached to any measurement category
    const used = new Set();
    boxNums.forEach(b => Object.keys(boxes[b] || {}).forEach(c => this._entryPhotoIds(boxes[b][c]).forEach(id => used.add(id))));
    Object.keys(assembly).forEach(c => this._entryPhotoIds(assembly[c]).forEach(id => used.add(id)));
    const loose = photos((d.photos || []).filter(id => !used.has(id)));
    if (loose.length) blocks.push({ kind: 'section', title: this._txt('现场照片', 'Site Photos'), sub: false, items: loose });

    return {
      customer: plain(d.customer),
      info: info,
      supplier: d.supplier || SUPPLIER_NAME,
      result: this._result() ? { label: this._resultLabel(), pass: this._result() === 'pass' } : null,
      blocks: blocks
    };
  },

  _itemHtml(it) {
    const e = v => this._esc(v);
    const NA = 'Not Applicable';
    if (it.t === 'kv') {
      const val = it.badge
        ? '<span style="display:inline-block;padding:2px 12px;border-radius:4px;background:' + it.badge.color + ';color:#ffffff;font-weight:700;">' + e(it.badge.text) + '</span>'
        : (it.value ? e(it.value) : NA);
      return '<div class="report-detail report-dims"><b>' + e(it.label) + ':</b> ' + val + '</div>';
    }
    if (it.t === 'inlinekv') {
      return '<div class="report-detail report-dims">' +
        it.cells.map(c => '<span class="report-dim"><b>' + e(c.label) + ':</b> ' + (c.value ? e(c.value) : NA) + '</span>').join(' &nbsp; ') + '</div>';
    }
    if (it.t === 'note') return '<div class="report-detail">' + e(it.text).replace(/\n/g, '<br>') + '</div>';
    if (it.t === 'photos') return this._photoGrid(it.ids);
    if (it.t === 'na') return '<div class="report-detail report-na">' + e(it.text) + '</div>';
    return '';
  },

  _blockHtml(bl) {
    const e = v => this._esc(v);
    if (bl.kind === 'heading') return '<h3 class="report-box-title">' + e(bl.text) + '</h3>';
    const titleStyle = bl.sub ? ' style="font-size:13px;text-transform:none;letter-spacing:0;font-weight:600;border-bottom-width:1px;border-bottom-color:#bbbbbb;margin-left:12px;"' : '';
    return '<div class="report-section"><div class="section-title"' + titleStyle + '>' + e(bl.title) + '</div>' +
      bl.items.map(it => this._itemHtml(it)).join('') + '</div>';
  },

  render() {
    const d = this.data;
    if (!d) return;
    const e = v => this._esc(v);
    const m = this._model();

    // Overall Result sits right under Supplier: teal highlight for Pass, red for Fail
    const overallRow = m.result
      ? '<tr><td colspan="4" style="background:' + (m.result.pass ? '#14b8a6' : '#e53935') + ';color:#ffffff;font-weight:700;font-size:15px;padding:10px 12px;border:none;width:auto;">' +
        this._txt('总体结果', 'Overall Result') + ' : ' + m.result.label + '</td></tr>'
      : '';
    const sub = document.getElementById('reportSubtitle');
    if (sub) sub.textContent = d.customer || '';

    const info = m.info.map(r => '<tr><td>' + e(r[0]) + '</td><td>' + e(r[1]) + '</td><td>' + e(r[2]) + '</td><td>' + e(r[3]) + '</td></tr>').join('') +
      '<tr><td>' + this._txt('供应商', 'Supplier') + '</td><td colspan="3">' + e(m.supplier) + '</td></tr>' + overallRow;

    let body = '';
    m.blocks.forEach(bl => { body += this._blockHtml(bl); });

    document.getElementById('reportRoot').innerHTML =
      '<div class="report-header" style="display:block;text-align:center;">' +
        '<h1 style="margin:0 0 4px;font-size:26px;font-weight:400;color:var(--text-secondary);">' + this._txt('检验报告', 'Inspection Report') + '</h1>' +
        '<h2 style="margin:0;font-size:22px;font-weight:600;color:var(--text-primary);">' + e(m.customer) + '</h2>' +
      '</div>' +
      '<table class="info-table">' + info + '</table>' +
      body +
      '<div class="report-footer"><span></span>' +
      '<span>' + e(this._dmyTime(Date.now()).slice(0, 10)) + '</span></div>';
    this._updateExportState();
  },

  _fileName() {
    const d = this.data || {};
    const clean = s => String(s || '').replace(/[\\/:*?"<>|\s]+/g, '_').replace(/^_+|_+$/g, '');
    const parts = ['Inspection_Report', clean(d.customer), this._resultLabel(), clean(this._dmy(d.inspectionDate).replace(/\//g, '-'))].filter(Boolean);
    return parts.join('_') + '.xlsx';
  },

  /* ---- Excel export ---- */

  // Photos are stored at camera size (several MB each). Scale them down to a long edge of
  // 1280px before embedding so the workbook stays a sensible size while details stay checkable.
  _shrinkPhoto(src) {
    const MAX_EDGE = 1280;
    return new Promise(resolve => {
      const img = new Image();
      img.onload = () => {
        const w0 = img.naturalWidth, h0 = img.naturalHeight;
        if (!w0 || !h0) { resolve(null); return; }
        try {
          const k = Math.min(1, MAX_EDGE / Math.max(w0, h0));
          const w = Math.max(1, Math.round(w0 * k)), h = Math.max(1, Math.round(h0 * k));
          const cv = document.createElement('canvas');
          cv.width = w; cv.height = h;
          const cx = cv.getContext('2d');
          cx.fillStyle = '#ffffff';
          cx.fillRect(0, 0, w, h);
          cx.drawImage(img, 0, 0, w, h);
          resolve({ url: cv.toDataURL('image/jpeg', 0.85), ext: 'jpeg', w: w, h: h });
        } catch (err) {
          const mt = /^data:image\/(png|jpeg|jpg)/i.exec(src);
          resolve(mt ? { url: src, ext: mt[1].toLowerCase() === 'png' ? 'png' : 'jpeg', w: w0, h: h0 } : null);
        }
      };
      img.onerror = () => resolve(null);
      img.src = src;
    });
  },

  async _buildWorkbook() {
    const m = this._model();
    const NA = 'Not Applicable';
    const COLS = 12, COL_W = 9.7;
    const COL_PX = Math.trunc(COL_W * 7 + 5);              // Excel's column width -> pixels
    const EMU = 9525;                                       // EMU per pixel
    const PER_ROW = 3, SPAN = COLS / PER_ROW;               // 3 photos per row, 4 columns each
    const BOX_W = SPAN * COL_PX - 8, BOX_H = Math.round(BOX_W * 3 / 4);
    const GREY = 'FF6B7280', LINE = 'FF9CA3AF';
    const argb = hex => 'FF' + String(hex).replace('#', '').toUpperCase();

    const wb = new ExcelJS.Workbook();
    wb.created = new Date();
    const ws = wb.addWorksheet(this._txt('检验报告', 'Inspection Report'), {
      views: [{ showGridLines: false }],
      pageSetup: { paperSize: 9, orientation: 'portrait', fitToPage: true, fitToWidth: 1, fitToHeight: 0,
        margins: { left: 0.4, right: 0.4, top: 0.5, bottom: 0.5, header: 0.3, footer: 0.3 } }
    });
    ws.columns = Array.from({ length: COLS }, () => ({ width: COL_W }));

    let r = 0;
    // One merged row (or a range inside it). Style is applied before merging so every merged cell shares it.
    const put = (value, o) => {
      o = o || {};
      const row = ++r, c1 = o.c1 || 1, c2 = o.c2 || COLS;
      const cell = ws.getCell(row, c1);
      cell.value = value;
      cell.font = Object.assign({ name: 'Calibri', size: 11 }, o.font || {});
      cell.alignment = Object.assign({ vertical: 'middle', wrapText: true }, o.align || {});
      if (o.fill) cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: o.fill } };
      if (o.border) cell.border = o.border;
      if (c2 > c1) ws.mergeCells(row, c1, row, c2);
      if (o.height) ws.getRow(row).height = o.height;
      return row;
    };
    // Same row, another merged range (for the info table)
    const putAt = (row, c1, c2, value, o) => {
      o = o || {};
      const cell = ws.getCell(row, c1);
      cell.value = value;
      cell.font = Object.assign({ name: 'Calibri', size: 11 }, o.font || {});
      cell.alignment = Object.assign({ vertical: 'middle', wrapText: true }, o.align || {});
      if (o.fill) cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: o.fill } };
      if (o.border) cell.border = o.border;
      if (c2 > c1) ws.mergeCells(row, c1, row, c2);
    };
    const thin = { style: 'thin', color: { argb: 'FFD1D5DB' } };
    const box = { top: thin, left: thin, bottom: thin, right: thin };
    const spacer = h => { ++r; ws.getRow(r).height = h; };

    // Title
    put(this._txt('检验报告', 'Inspection Report'), { font: { size: 22, color: { argb: GREY } }, align: { horizontal: 'center', wrapText: false }, height: 34 });
    put(m.customer, { font: { size: 18, bold: true }, align: { horizontal: 'center', wrapText: false }, height: 28 });
    spacer(8);

    // Info table: label | value | label | value
    m.info.forEach(rw => {
      const row = r + 1; r = row;
      ws.getRow(row).height = 20;
      putAt(row, 1, 2, rw[0], { font: { color: { argb: GREY } }, fill: 'FFF3F4F6', border: box });
      putAt(row, 3, 6, rw[1], { border: box });
      putAt(row, 7, 8, rw[2], { font: { color: { argb: GREY } }, fill: 'FFF3F4F6', border: box });
      putAt(row, 9, 12, rw[3], { border: box });
    });
    { const row = ++r; ws.getRow(row).height = 20;
      putAt(row, 1, 2, this._txt('供应商', 'Supplier'), { font: { color: { argb: GREY } }, fill: 'FFF3F4F6', border: box });
      putAt(row, 3, 12, m.supplier, { border: box }); }
    if (m.result) {
      put(this._txt('总体结果', 'Overall Result') + ' : ' + m.result.label,
        { font: { size: 14, bold: true, color: { argb: 'FFFFFFFF' } }, fill: argb(m.result.pass ? '#14b8a6' : '#e53935'), align: { horizontal: 'left', indent: 1 }, height: 28 });
    }
    spacer(10);

    // Photos: shrink once per photo id, embed once per workbook
    const embedded = {};
    const getPhoto = async id => {
      if (id in embedded) return embedded[id];
      const src = this.imageMap[id];
      const ph = src ? await this._shrinkPhoto(src) : null;
      embedded[id] = ph ? { imageId: wb.addImage({ base64: ph.url, extension: ph.ext }), w: ph.w, h: ph.h } : null;
      return embedded[id];
    };

    for (const bl of m.blocks) {
      if (bl.kind === 'heading') {
        spacer(6);
        put(bl.text, { font: { size: 14, bold: true }, fill: 'FFE5E7EB', align: { horizontal: 'left', indent: 1, wrapText: false }, height: 24 });
        continue;
      }
      // Section title with a rule underneath
      const sub = bl.sub;
      put(bl.title, {
        font: { size: sub ? 11 : 12, bold: true },
        align: { horizontal: 'left', indent: sub ? 2 : 0, wrapText: false },
        border: { bottom: { style: sub ? 'hair' : 'thin', color: { argb: sub ? LINE : 'FF111827' } } },
        height: 22
      });
      for (const it of bl.items) {
        if (it.t === 'kv') {
          if (it.badge) {
            const row = ++r; ws.getRow(row).height = 22;
            putAt(row, 1, 3, it.label + ':', { font: { bold: true } });
            putAt(row, 4, 6, it.badge.text, { font: { bold: true, color: { argb: 'FFFFFFFF' } }, fill: argb(it.badge.color), align: { horizontal: 'center' } });
          } else {
            put({ richText: [{ font: { name: 'Calibri', size: 11, bold: true }, text: it.label + ': ' }, { font: { name: 'Calibri', size: 11 }, text: it.value || NA }] }, { height: 20 });
          }
        } else if (it.t === 'inlinekv') {
          const rt = [];
          it.cells.forEach((c, i) => {
            rt.push({ font: { name: 'Calibri', size: 11, bold: true }, text: (i ? '      ' : '') + c.label + ': ' });
            rt.push({ font: { name: 'Calibri', size: 11 }, text: c.value || NA });
          });
          put({ richText: rt }, { height: 20 });
        } else if (it.t === 'note') {
          const lines = String(it.text).split('\n').reduce((n, ln) => n + Math.max(1, Math.ceil(ln.length / 90)), 0);
          put(it.text, { align: { vertical: 'top' }, height: Math.max(20, lines * 16) });
        } else if (it.t === 'na') {
          put(it.text, { font: { italic: true, color: { argb: GREY } }, height: 20 });
        } else if (it.t === 'photos') {
          for (let i = 0; i < it.ids.length; i += PER_ROW) {
            const row = ++r;
            ws.getRow(row).height = (BOX_H + 8) * 0.75;
            const chunk = it.ids.slice(i, i + PER_ROW);
            for (let k = 0; k < chunk.length; k++) {
              const ph = await getPhoto(chunk[k]);
              if (!ph) continue;
              const sc = Math.min(BOX_W / ph.w, BOX_H / ph.h);
              ws.addImage(ph.imageId, {
                tl: { nativeCol: k * SPAN, nativeColOff: 4 * EMU, nativeRow: row - 1, nativeRowOff: 2 * EMU },
                ext: { width: Math.round(ph.w * sc), height: Math.round(ph.h * sc) },
                editAs: 'oneCell'
              });
            }
          }
        }
      }
    }
    spacer(8);
    put(this._dmyTime(Date.now()).slice(0, 10), { font: { size: 9, color: { argb: GREY } }, align: { horizontal: 'right', wrapText: false } });

    const buf = await wb.xlsx.writeBuffer();
    return new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  },

  async downloadXlsx() {
    if (this._busy || !this.data) return;
    if (!this._result()) {
      InspectionCore.Utils.toast(this._txt('请先选择 Pass / Fail', 'Choose Pass / Fail first'), 'error');
      return;
    }
    if (typeof ExcelJS === 'undefined') {
      InspectionCore.Utils.toast(this._txt('Excel 组件未能加载，请刷新页面后重试', 'The Excel library failed to load. Please reload the page and try again.'), 'error');
      return;
    }
    const btn = document.getElementById('downloadXlsxBtn');
    const label = btn && btn.querySelector('span');
    const original = label ? label.textContent : '';
    this._busy = true;
    if (btn) btn.disabled = true;
    if (label) label.textContent = this._txt('生成中...', 'Generating...');
    try {
      const blob = await this._buildWorkbook();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = this._fileName();
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 30000);
      InspectionCore.Utils.toast(this._txt('Excel 已生成', 'Excel downloaded'), 'success');
    } catch (err) {
      console.error('[Report] Excel export failed:', err);
      InspectionCore.Utils.toast(this._txt('Excel 生成失败', 'Excel export failed'), 'error');
    } finally {
      this._busy = false;
      this._updateExportState();
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
