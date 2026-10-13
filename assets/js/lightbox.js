/* ============================================
   LIGHTBOX.JS - Tap a photo to view it larger
   Fit-to-screen view, tap the photo again for 100% (actual pixels) to check
   sharpness, arrows / swipe-free buttons to step through the other photos.
   Everything happens locally; no network requests.
   ============================================ */

const Lightbox = {
  _el: null,
  _img: null,
  _srcs: [],
  _idx: 0,
  _actual: false,

  _zh() { return !(window.I18n && I18n.current === 'en'); },
  _txt(zh, en) { return this._zh() ? zh : en; },

  // sources: array of image URLs / data URLs; index: which one to show first
  open(sources, index) {
    const list = (sources || []).filter(Boolean);
    if (!list.length) return;
    this._srcs = list;
    this._idx = Math.min(Math.max(index || 0, 0), list.length - 1);
    this._build();
    this._show();
  },

  // Convenience: open the clicked <img> within a group of <img> elements
  openFrom(imgEl, groupSelector) {
    const group = groupSelector ? Array.from(document.querySelectorAll(groupSelector)) : [imgEl];
    const srcs = group.map(i => i.currentSrc || i.src);
    const idx = Math.max(0, group.indexOf(imgEl));
    this.open(srcs, idx);
  },

  close() {
    if (!this._el) return;
    document.removeEventListener('keydown', this._onKey, true);
    this._el.remove();
    this._el = this._img = null;
    document.body.style.overflow = this._prevOverflow || '';
  },

  _build() {
    if (this._el) this.close();
    const el = document.createElement('div');
    el.className = 'lightbox';
    el.setAttribute('role', 'dialog');
    el.setAttribute('aria-modal', 'true');
    el.innerHTML =
      '<div class="lightbox-stage"><img class="lightbox-img" alt="" draggable="false"></div>' +
      '<div class="lightbox-bar">' +
        '<span class="lightbox-info"></span>' +
        '<button type="button" class="lightbox-close" aria-label="Close">✕</button>' +
      '</div>' +
      '<button type="button" class="lightbox-nav lightbox-prev" aria-label="Previous">‹</button>' +
      '<button type="button" class="lightbox-nav lightbox-next" aria-label="Next">›</button>' +
      '<div class="lightbox-hint"></div>';
    this._el = el;
    this._img = el.querySelector('.lightbox-img');
    document.body.appendChild(el);
    this._prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    el.querySelector('.lightbox-close').addEventListener('click', () => this.close());
    el.querySelector('.lightbox-prev').addEventListener('click', (e) => { e.stopPropagation(); this._step(-1); });
    el.querySelector('.lightbox-next').addEventListener('click', (e) => { e.stopPropagation(); this._step(1); });
    // Tap the dark area to close; tap the photo to switch fit / 100%
    el.querySelector('.lightbox-stage').addEventListener('click', (e) => {
      if (e.target === this._img) this._toggleActual();
      else this.close();
    });
    this._onKey = (e) => {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); this.close(); }
      else if (e.key === 'ArrowLeft') this._step(-1);
      else if (e.key === 'ArrowRight') this._step(1);
    };
    document.addEventListener('keydown', this._onKey, true);
  },

  _step(d) {
    if (this._srcs.length < 2) return;
    this._idx = (this._idx + d + this._srcs.length) % this._srcs.length;
    this._actual = false;
    this._show();
  },

  _toggleActual() {
    this._actual = !this._actual;
    this._apply();
  },

  _show() {
    if (!this._el) return;
    this._actual = false;
    const img = this._img;
    img.onload = () => this._apply();
    img.src = this._srcs[this._idx];
    if (img.complete) this._apply();
    const multi = this._srcs.length > 1;
    this._el.querySelector('.lightbox-prev').style.display = multi ? '' : 'none';
    this._el.querySelector('.lightbox-next').style.display = multi ? '' : 'none';
  },

  _apply() {
    if (!this._el || !this._img) return;
    const img = this._img, stage = this._el.querySelector('.lightbox-stage');
    stage.classList.toggle('actual', this._actual);
    img.classList.toggle('actual', this._actual);
    if (this._actual) { stage.scrollLeft = (stage.scrollWidth - stage.clientWidth) / 2; stage.scrollTop = (stage.scrollHeight - stage.clientHeight) / 2; }
    const n = this._srcs.length;
    const dims = img.naturalWidth ? img.naturalWidth + ' × ' + img.naturalHeight + ' px' : '';
    this._el.querySelector('.lightbox-info').textContent = (n > 1 ? (this._idx + 1) + ' / ' + n + '   ' : '') + dims;
    this._el.querySelector('.lightbox-hint').textContent = this._actual
      ? this._txt('原始大小 · 拖动查看 · 点击图片缩回', 'Actual size · scroll to inspect · tap the photo to fit')
      : this._txt('点击图片查看原始大小', 'Tap the photo to see it at actual size');
  }
};

window.Lightbox = Lightbox;
