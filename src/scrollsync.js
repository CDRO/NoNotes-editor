/* NoNotes – Synchrones Scrollen in der geteilten Ansicht.
   Der Text des Editors wird in einem unsichtbaren Spiegel mit denselben Schriftmassen gemessen; so ist
   bekannt, auf welcher Pixelhöhe jede Quellzeile liegt, auch wenn Zeilen umbrechen. Die Vorschau trägt
   an ihren Blöcken data-line. Zwischen beiden Seiten wird linear interpoliert. Es führt immer die Seite,
   auf der der Benutzer zuletzt war (Zeiger, Rad, Fokus, Tastatur), damit sich beide nicht gegenseitig
   anstossen. */
(function (global) {
  'use strict';

  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

  function create(opts) {
    const textarea = opts.textarea;
    const preview = opts.preview;
    const mirror = opts.mirror;
    const isActive = opts.isActive || (() => true);
    let driver = 'editor';
    let cache = { text: null, width: 0, tops: null };

    /** Pixelhöhe jeder Quellzeile im Editor (Index = Zeile, letzter Eintrag = Ende des Textes). */
    function measure() {
      const text = textarea.value;
      const width = textarea.clientWidth;
      if (cache.tops && cache.text === text && cache.width === width) return cache.tops;
      const lines = text.split('\n');
      mirror.style.width = width + 'px';
      const frag = document.createDocumentFragment();
      for (const l of lines) {
        const d = document.createElement('div');
        if (l === '') d.appendChild(document.createElement('br'));
        else d.textContent = l;
        frag.appendChild(d);
      }
      mirror.replaceChildren(frag);
      const tops = new Float64Array(lines.length + 1);
      const kids = mirror.children;
      for (let i = 0; i < kids.length; i++) tops[i] = kids[i].offsetTop;
      const last = kids[kids.length - 1];
      tops[lines.length] = last ? last.offsetTop + last.offsetHeight : 0;
      cache = { text, width, tops };
      return tops;
    }

    const lineCount = () => measure().length - 1;
    const editorMax = () => Math.max(0, textarea.scrollHeight - textarea.clientHeight);
    const previewMax = () => Math.max(0, preview.scrollHeight - preview.clientHeight);

    /** Quellzeile (mit Bruchteil) an der Oberkante des Editors. */
    function lineAt(scrollTop) {
      const tops = measure();
      const n = tops.length - 1;
      if (n <= 0) return 0;
      let lo = 0, hi = n - 1;
      while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (tops[mid] <= scrollTop) lo = mid; else hi = mid - 1; }
      const h = tops[lo + 1] - tops[lo];
      return lo + (h > 0 ? clamp((scrollTop - tops[lo]) / h, 0, 1) : 0);
    }

    /** scrollTop des Editors für eine Quellzeile (mit Bruchteil). */
    function topOfLine(pos) {
      const tops = measure();
      const n = tops.length - 1;
      if (n <= 0) return 0;
      const i = clamp(Math.floor(pos), 0, n - 1);
      return tops[i] + clamp(pos - i, 0, 1) * (tops[i + 1] - tops[i]);
    }

    /** Blöcke der Vorschau mit data-line, mit ihrer Höhe in Scroll-Koordinaten der Vorschau, aufsteigend. */
    function anchors() {
      const base = preview.getBoundingClientRect().top - preview.scrollTop;
      const found = [];
      for (const elm of preview.querySelectorAll('[data-line]')) {
        const line = Number(elm.dataset.line);
        if (Number.isFinite(line)) found.push({ line, top: elm.getBoundingClientRect().top - base });
      }
      found.sort((a, b) => a.line - b.line || a.top - b.top);
      const total = lineCount();
      const pts = [{ line: 0, top: 0 }];
      for (const a of found) {
        const prev = pts[pts.length - 1];
        if (a.line > prev.line && a.top >= prev.top) pts.push(a);
      }
      const end = pts[pts.length - 1];
      if (end.line < total || end.top < preview.scrollHeight) pts.push({ line: Math.max(total, end.line + 1), top: Math.max(preview.scrollHeight, end.top) });
      return pts;
    }

    function interpolate(pts, key, other, value) {
      let i = 0;
      while (i < pts.length - 2 && pts[i + 1][key] <= value) i++;
      const a = pts[i], b = pts[i + 1];
      const span = b[key] - a[key];
      const t = span > 0 ? clamp((value - a[key]) / span, 0, 1) : 0;
      return a[other] + t * (b[other] - a[other]);
    }

    const previewTopForLine = pos => interpolate(anchors(), 'line', 'top', pos);
    const lineForPreviewTop = top => interpolate(anchors(), 'top', 'line', top);

    function fromEditor() {
      if (!isActive()) return;
      const st = textarea.scrollTop;
      const target = st >= editorMax() - 1 ? previewMax() : clamp(previewTopForLine(lineAt(st)), 0, previewMax());
      if (Math.abs(preview.scrollTop - target) >= 1) preview.scrollTop = target;
    }

    function fromPreview() {
      if (!isActive()) return;
      const st = preview.scrollTop;
      const target = st >= previewMax() - 1 ? editorMax() : clamp(topOfLine(lineForPreviewTop(st)), 0, editorMax());
      if (Math.abs(textarea.scrollTop - target) >= 1) textarea.scrollTop = target;
    }

    const lead = who => () => { driver = who; };
    for (const ev of ['pointerenter', 'wheel', 'touchstart', 'focus', 'keydown', 'pointerdown']) {
      textarea.addEventListener(ev, lead('editor'), { passive: true });
      preview.addEventListener(ev, lead('preview'), { passive: true });
    }
    textarea.addEventListener('scroll', () => { if (driver === 'editor') fromEditor(); }, { passive: true });
    preview.addEventListener('scroll', () => { if (driver === 'preview') fromPreview(); }, { passive: true });

    return {
      fromEditor,
      fromPreview,
      /** Nach dem Neuzeichnen der Vorschau: an den Editor angleichen (ausser der Benutzer scrollt gerade die Vorschau). */
      afterRender() { if (driver !== 'preview') fromEditor(); },
      invalidate() { cache = { text: null, width: 0, tops: null }; },
      get driver() { return driver; },
      topOfLine,
      lineAt,
    };
  }

  global.NoNotesScrollSync = { create };
})(window);
