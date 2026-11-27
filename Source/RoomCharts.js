/* RoomCharts.js - Media normalization, Perseus/SVG/Table enhancements, KaTeX math typesetting, Lightbox & CSA Code Editor */
(function () {
  const IS_APP_WEBKIT = !!(
    window.location.protocol === 'file:' &&
    window.webkit &&
    window.webkit.messageHandlers &&
    window.webkit.messageHandlers.roomHistory
  );

  window.ROOM_IS_APP_WEBKIT = IS_APP_WEBKIT;

  window.roomDataUrl = function (rel) {
    const cleaned = String(rel || '').replace(/^\/+/, '');
    if (IS_APP_WEBKIT) return 'apexam://' + cleaned;
    return 'Data/' + cleaned.replace(/^data\//i, '');
  };

  window.roomPdfUrl = function (kind, params) {
    const qs = Object.entries(params || {})
      .filter(([, v]) => v !== undefined && v !== null)
      .map(([k, v]) => encodeURIComponent(k) + '=' + encodeURIComponent(String(v)))
      .join('&');
    if (IS_APP_WEBKIT) return 'apexam://' + kind + '?' + qs;
    return '/' + kind + '?' + qs;
  };

  window.roomIconUrl = function (name) {
    return 'Assets/icons/' + String(name || '').replace(/^\/+/, '');
  };

  window.roomOpenPdfExternal = function (relPath) {
    if (!relPath) return;
    if (IS_APP_WEBKIT && window.webkit?.messageHandlers?.roomOpenExternalPdf) {
      window.webkit.messageHandlers.roomOpenExternalPdf.postMessage(relPath);
      return;
    }
    if (window.location.protocol.startsWith('http')) {
      window.open('/open-pdf?path=' + encodeURIComponent(relPath), '_blank');
      return;
    }
    window.open(roomPdfUrl('pdf-page', { path: relPath, page: 1, scale: '2.0' }), '_blank');
  };

  // --- Server capability detection + Client-side PDF.js fallback for Windows / Zero-Dep ---
  window.roomServerInfoPromise = (!IS_APP_WEBKIT && window.location.protocol.startsWith('http'))
    ? fetch('/server-info').then((r) => (r.ok ? r.json() : null)).catch(() => null)
    : Promise.resolve(null);

  async function shouldUsePdfJs() {
    if (IS_APP_WEBKIT) return false;
    const info = await window.roomServerInfoPromise;
    return !!(info && info.pdfEngine === 'pdfjs');
  }

  let pdfJsPromise = null;
  function ensurePdfJs() {
    if (window.pdfjsLib) {
      if (window.pdfjsLib.GlobalWorkerOptions) {
        window.pdfjsLib.GlobalWorkerOptions.workerSrc = 'Assets/pdfjs/pdf.worker.min.js';
      }
      return Promise.resolve(window.pdfjsLib);
    }
    if (!pdfJsPromise) {
      pdfJsPromise = new Promise((resolve, reject) => {
        const s = document.createElement('script');
        s.src = 'Assets/pdfjs/pdf.min.js';
        s.onload = () => {
          if (window.pdfjsLib) {
            window.pdfjsLib.GlobalWorkerOptions.workerSrc = 'Assets/pdfjs/pdf.worker.min.js';
            resolve(window.pdfjsLib);
          } else {
            reject(new Error('pdfjsLib did not initialize'));
          }
        };
        s.onerror = () => reject(new Error('Failed to load Assets/pdfjs/pdf.min.js'));
        document.head.appendChild(s);
      });
    }
    return pdfJsPromise;
  }

  const pdfDocCache = new Map();
  const pdfPageUrlCache = new Map();

  async function getPdfDoc(relPath) {
    if (pdfDocCache.has(relPath)) {
      const val = pdfDocCache.get(relPath);
      pdfDocCache.delete(relPath);
      pdfDocCache.set(relPath, val);
      return await val;
    }
    const pdfjsLib = await ensurePdfJs();
    const taskPromise = (async () => {
      const loadingTask = pdfjsLib.getDocument({
        url: '/pdf-raw?path=' + encodeURIComponent(relPath),
        cMapUrl: 'Assets/pdfjs/cmaps/',
        cMapPacked: true,
      });
      return await loadingTask.promise;
    })();
    pdfDocCache.set(relPath, taskPromise);
    while (pdfDocCache.size > 6) {
      const oldestKey = pdfDocCache.keys().next().value;
      const oldestVal = pdfDocCache.get(oldestKey);
      pdfDocCache.delete(oldestKey);
      Promise.resolve(oldestVal).then((doc) => doc?.destroy?.()).catch(() => {});
    }
    try {
      return await taskPromise;
    } catch (err) {
      pdfDocCache.delete(relPath);
      throw err;
    }
  }

  async function renderPdfPageToBlobUrl(relPath, pageNum, scale = 2.0) {
    const num = Math.max(1, Number(pageNum) || 1);
    const sc = Number(scale) || 2.0;
    const cacheKey = `${relPath}#${num}@${sc}`;
    if (pdfPageUrlCache.has(cacheKey)) {
      const existing = pdfPageUrlCache.get(cacheKey);
      pdfPageUrlCache.delete(cacheKey);
      pdfPageUrlCache.set(cacheKey, existing);
      return existing;
    }
    const doc = await getPdfDoc(relPath);
    const clampedPage = Math.min(Math.max(1, num), doc.numPages || num);
    const page = await doc.getPage(clampedPage);
    const viewport = page.getViewport({ scale: sc });
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.floor(viewport.width));
    canvas.height = Math.max(1, Math.floor(viewport.height));
    const ctx = canvas.getContext('2d', { alpha: false });
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    await page.render({ canvasContext: ctx, viewport }).promise;
    const blob = await new Promise((resolve, reject) => {
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Canvas toBlob failed'))), 'image/png');
    });
    const blobUrl = URL.createObjectURL(blob);
    pdfPageUrlCache.set(cacheKey, blobUrl);
    while (pdfPageUrlCache.size > 24) {
      const oldestKey = pdfPageUrlCache.keys().next().value;
      const oldestUrl = pdfPageUrlCache.get(oldestKey);
      pdfPageUrlCache.delete(oldestKey);
      if (oldestUrl) URL.revokeObjectURL(oldestUrl);
    }
    return blobUrl;
  }

  function showPdfMissingBanner(imgEl, relPath) {
    if (!imgEl || !imgEl.parentElement) return;
    let banner = imgEl.parentElement.querySelector('.cb-pdf-missing-banner');
    if (!banner) {
      banner = document.createElement('div');
      banner.className = 'cb-pdf-missing-banner';
      imgEl.insertAdjacentElement('afterend', banner);
    }
    banner.innerHTML = `<strong>PDF File Not Found Locally:</strong> <code>${String(relPath || '').replace(/</g, '&lt;')}</code><br>
      <span>Attach your own local PDF folder or import JSON question sets via <strong>Question Bank → Import JSON</strong>; all interactive MCQs, Desmos, Java editor, Mistake Bank, and History work offline without external PDFs.</span>`;
  }

  function clearPdfMissingBanner(imgEl) {
    const banner = imgEl?.parentElement?.querySelector('.cb-pdf-missing-banner');
    if (banner) banner.remove();
  }

  window.roomGetPdfInfo = async function (relPath) {
    if (!relPath) return { pages: 1 };
    if (await shouldUsePdfJs()) {
      try {
        const doc = await getPdfDoc(relPath);
        return { pages: doc.numPages || 1 };
      } catch (_) {
        return { pages: 1 };
      }
    }
    try {
      const r = await fetch(roomPdfUrl('pdf-info', { path: relPath }));
      if (!r.ok) return { pages: 1 };
      return await r.json();
    } catch (_) {
      return { pages: 1 };
    }
  };

  window.roomRenderPdfIntoImg = async function (imgEl, relPath, pageNum, scale = 2.0) {
    if (!imgEl || !relPath) return;
    const reqId = String((Number(imgEl.dataset.pdfReqId || 0)) + 1);
    imgEl.dataset.pdfReqId = reqId;
    clearPdfMissingBanner(imgEl);
    if (await shouldUsePdfJs()) {
      try {
        const blobUrl = await renderPdfPageToBlobUrl(relPath, pageNum, scale);
        if (imgEl.dataset.pdfReqId !== reqId || !imgEl.isConnected) return;
        imgEl.src = blobUrl;
      } catch (_) {
        if (imgEl.dataset.pdfReqId !== reqId) return;
        showPdfMissingBanner(imgEl, relPath);
      }
      return;
    }
    imgEl.onerror = () => {
      if (imgEl.dataset.pdfReqId === reqId) showPdfMissingBanner(imgEl, relPath);
    };
    imgEl.src = roomPdfUrl('pdf-page', { path: relPath, page: pageNum, scale: String(scale) });
  };

  window.roomPrefetchPdfPage = async function (relPath, pageNum, scale = 2.0) {
    if (!relPath) return;
    if (await shouldUsePdfJs()) {
      renderPdfPageToBlobUrl(relPath, pageNum, scale).catch(() => {});
      return;
    }
    const img = new Image();
    img.src = roomPdfUrl('pdf-page', { path: relPath, page: pageNum, scale: String(scale) });
  };

  window.roomLocalFetch = async function (url, opts = {}) {
    const method = (opts.method || 'POST').toUpperCase();
    const body = typeof opts.body === 'string' ? opts.body : opts.body ? JSON.stringify(opts.body) : '';
    const headers = opts.headers || { 'Content-Type': 'application/json' };
    if (IS_APP_WEBKIT && window.webkit?.messageHandlers?.roomLocalFetch) {
      return await window.webkit.messageHandlers.roomLocalFetch.postMessage({
        url,
        method,
        headers,
        body,
      });
    }
    const resp = await fetch('/local-proxy', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url, method, headers, body }),
    });
    const text = await resp.text();
    if (!resp.ok) throw new Error(text || 'Proxy error ' + resp.status);
    return text;
  };

  window.roomRunJava = async function (code) {
    if (IS_APP_WEBKIT && window.webkit?.messageHandlers?.roomRunJava) {
      return await window.webkit.messageHandlers.roomRunJava.postMessage({ code });
    }
    const resp = await fetch('/run-java', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code }),
    });
    return await resp.json();
  };

  // --- Image Lightbox ---
  let lbZoom = 1;
  function ensureLightbox() {
    let lb = document.getElementById('room-lightbox');
    if (lb) return lb;
    lb = document.createElement('div');
    lb.id = 'room-lightbox';
    lb.className = 'room-lightbox';
    lb.setAttribute('hidden', '');
    lb.innerHTML = `
      <div class="room-lb-bar">
        <span class="room-lb-caption">Figure Zoom</span>
        <div class="room-lb-actions">
          <button type="button" data-lb="out" title="Zoom Out">−</button>
          <span class="room-lb-pct">100%</span>
          <button type="button" data-lb="in" title="Zoom In">+</button>
          <button type="button" data-lb="reset" title="Reset">1:1</button>
          <button type="button" data-lb="close" title="Close (Esc)">✕</button>
        </div>
      </div>
      <div class="room-lb-stage">
        <div class="room-lb-content"></div>
      </div>`;
    document.body.appendChild(lb);
    lb.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-lb]');
      if (btn) {
        const act = btn.dataset.lb;
        if (act === 'close') closeLightbox();
        else if (act === 'in') setLbZoom(Math.min(3, lbZoom + 0.25));
        else if (act === 'out') setLbZoom(Math.max(0.5, lbZoom - 0.25));
        else if (act === 'reset') setLbZoom(1);
        return;
      }
      if (e.target.classList.contains('room-lb-stage')) closeLightbox();
    });
    return lb;
  }

  function setLbZoom(z) {
    lbZoom = z;
    const lb = document.getElementById('room-lightbox');
    if (!lb) return;
    lb.querySelector('.room-lb-pct').textContent = Math.round(z * 100) + '%';
    const content = lb.querySelector('.room-lb-content');
    content.style.transform = `scale(${z})`;
    content.style.transformOrigin = 'center top';
  }

  window.openRoomLightbox = function (nodeOrSrc, caption) {
    const lb = ensureLightbox();
    const content = lb.querySelector('.room-lb-content');
    const cap = lb.querySelector('.room-lb-caption');
    cap.textContent = caption || 'High-Resolution Figure';
    content.innerHTML = '';
    if (typeof nodeOrSrc === 'string') {
      const img = document.createElement('img');
      img.src = nodeOrSrc;
      img.alt = caption || '';
      content.appendChild(img);
    } else if (nodeOrSrc && nodeOrSrc.tagName === 'SVG') {
      const clone = nodeOrSrc.cloneNode(true);
      clone.removeAttribute('width');
      clone.removeAttribute('height');
      clone.style.width = '760px';
      clone.style.maxWidth = '90vw';
      clone.style.height = 'auto';
      content.appendChild(clone);
    } else if (nodeOrSrc && nodeOrSrc.tagName === 'IMG') {
      const img = document.createElement('img');
      img.src = nodeOrSrc.src;
      img.alt = nodeOrSrc.alt || caption || '';
      content.appendChild(img);
    }
    setLbZoom(1);
    lb.removeAttribute('hidden');
  };

  window.closeLightbox = function () {
    const lb = document.getElementById('room-lightbox');
    if (lb) lb.setAttribute('hidden', '');
  };

  // --- KaTeX Math Typesetting ---
  const MATH_SKIP_TAGS = new Set(['SCRIPT', 'STYLE', 'TEXTAREA', 'PRE', 'CODE', 'KBD', 'SAMP', 'NOSCRIPT', 'SVG']);
  window.typesetMath = function (rootEl) {
    try {
      const katexApi = window.katex;
      if (!katexApi || typeof katexApi.renderToString !== 'function') return Promise.resolve();
      const root = rootEl || document.getElementById('app') || document.body;
      if (!root) return Promise.resolve();

      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null);
      const targets = [];
      let node;
      while ((node = walker.nextNode())) {
        const val = node.nodeValue;
        if (!val || (!val.includes('$') && !val.includes('\\(') && !val.includes('\\['))) continue;
        let p = node.parentNode;
        let skip = false;
        while (p && p !== root) {
          if (MATH_SKIP_TAGS.has(p.tagName) || (p.classList && (p.classList.contains('katex') || p.classList.contains('cb-code')))) {
            skip = true;
            break;
          }
          p = p.parentNode;
        }
        if (!skip) targets.push(node);
      }

      const delimRe = /\$\$([\s\S]+?)\$\$|\\\[([\s\S]+?)\\\]|\\\(([\s\S]+?)\\\)|\$([^\s$][^$\n]*?[^\s$]|[^\s$])\$/g;
      for (const textNode of targets) {
        const text = textNode.nodeValue;
        delimRe.lastIndex = 0;
        let match;
        let lastIdx = 0;
        const frag = document.createDocumentFragment();
        let replaced = false;
        while ((match = delimRe.exec(text))) {
          // Guard currency prices like $6.00 followed by text or space+word unless inside single math
          const inner = match[1] || match[2] || match[3] || match[4] || '';
          const isDollar = match[0].startsWith('$') && !match[0].startsWith('$$');
          if (isDollar && /^\d[\d,.]*(?:\s|$)/.test(inner) && !/[=+\-*/^_{}\\]/.test(inner)) {
            continue;
          }
          if (match.index > lastIdx) {
            frag.appendChild(document.createTextNode(text.slice(lastIdx, match.index)));
          }
          const displayMode = !!(match[1] || match[2]);
          try {
            const html = katexApi.renderToString(inner.trim(), { displayMode, throwOnError: false });
            const span = document.createElement('span');
            span.className = displayMode ? 'cb-math-display' : 'cb-math-inline';
            span.innerHTML = html;
            frag.appendChild(span);
            replaced = true;
          } catch (_) {
            frag.appendChild(document.createTextNode(match[0]));
          }
          lastIdx = delimRe.lastIndex;
        }
        if (replaced) {
          if (lastIdx < text.length) {
            frag.appendChild(document.createTextNode(text.slice(lastIdx)));
          }
          textNode.parentNode.replaceChild(frag, textNode);
        }
      }
    } catch (e) {
      console.warn('typesetMath skipped:', e);
    }
    return Promise.resolve();
  };

  // --- Universal Chart / Figure / PDF-Embed / Table / CSA Editor Enhancer ---
  window.enhanceQuestionMedia = function (rootEl) {
    const root = rootEl || document.getElementById('app') || document.body;
    if (!root) return;

    // 1. Hydrate .cb-pdf-embed placeholders (FRQ prompts, Rubric solutions, Workbook figure pages)
    root.querySelectorAll('.cb-pdf-embed[data-pdf-rel]').forEach((box) => {
      if (box.dataset.hydrated === '1') return;
      box.dataset.hydrated = '1';
      const rel = box.dataset.pdfRel;
      let pages = [];
      try {
        pages = JSON.parse(box.dataset.pages || '[]');
      } catch (_) {}
      const caption = box.dataset.caption || '';
      const header = document.createElement('div');
      header.className = 'cb-pdf-embed-bar';
      header.innerHTML = `<span class="cb-pdf-embed-cap">${caption ? caption : 'Original Document Pages'}</span>
        <button type="button" class="cb-pdf-open-ext">Open PDF ↗</button>`;
      header.querySelector('.cb-pdf-open-ext').addEventListener('click', () => roomOpenPdfExternal(rel));
      box.innerHTML = '';
      box.appendChild(header);

      const list = document.createElement('div');
      list.className = 'cb-pdf-embed-pages';
      pages.forEach((p) => {
        const card = document.createElement('figure');
        card.className = 'cb-figure cb-pdf-page-card';
        const img = document.createElement('img');
        img.className = 'cb-pdf-page-img';
        img.loading = 'lazy';
        img.alt = `Page ${p}`;
        img.addEventListener('click', () => {
          if (img.src) openRoomLightbox(img.src, `${caption || 'Document'} — Page ${p}`);
        });
        const cap = document.createElement('figcaption');
        cap.textContent = `Page ${p} (Click to zoom)`;
        card.appendChild(img);
        card.appendChild(cap);
        list.appendChild(card);
        window.roomRenderPdfIntoImg(img, rel, p, 2.0);
      });
      box.appendChild(list);
    });

    // 2. Style & make zoomable any question images or SVGs
    root.querySelectorAll('.stem-pane img, .question-pane img, .explanation-box img, .results-detail img').forEach((img) => {
      if (img.closest('.room-brand, .room-nav-item, .room-card-icon, .tool-chip, .cb-pdf-page-card, .cb-figure')) {
        if (img.closest('.cb-figure') && !img.dataset.zoomWired) {
          img.dataset.zoomWired = '1';
          img.style.cursor = 'zoom-in';
          img.addEventListener('click', () => openRoomLightbox(img, img.alt || 'Diagram'));
        }
        return;
      }
      if (img.dataset.zoomWired) return;
      img.dataset.zoomWired = '1';
      img.classList.add('cb-enhanced-img');
      img.style.cursor = 'zoom-in';
      img.addEventListener('click', () => openRoomLightbox(img, img.alt || 'Figure'));
    });

    root.querySelectorAll('figure.cb-figure svg, .cb-figure-generated svg').forEach((svg) => {
      if (svg.dataset.zoomWired) return;
      svg.dataset.zoomWired = '1';
      svg.style.cursor = 'zoom-in';
      svg.addEventListener('click', () => openRoomLightbox(svg, svg.getAttribute('aria-label') || 'Diagram'));
    });

    // 3. Wrap wide tables cleanly
    root.querySelectorAll('table').forEach((tbl) => {
      tbl.classList.add('cb-table');
      if (!tbl.parentElement?.classList.contains('cb-table-wrap')) {
        const wrap = document.createElement('div');
        wrap.className = 'cb-table-wrap';
        tbl.parentNode.insertBefore(wrap, tbl);
        wrap.appendChild(tbl);
      }
    });
  };

  // --- CSA Java Code Editor Upgrade ---
  window.mountCsaCodeEditor = function (rootEl) {
    const root = rootEl || document.getElementById('app');
    if (!root) return;
    const ex = typeof window.getCurrentExam === 'function' ? window.getCurrentExam() : null;
    const isCsa = ex && ex.subjectKey === 'csa';
    root.querySelectorAll('textarea.room-response').forEach((ta) => {
      if (ta.dataset.csaWired) return;
      ta.dataset.csaWired = '1';
      if (!isCsa) return;
      ta.classList.add('cb-java-editor');
      ta.setAttribute('spellcheck', 'false');
      ta.setAttribute('autocomplete', 'off');
      ta.setAttribute('autocorrect', 'off');
      ta.setAttribute('autocapitalize', 'off');

      // Add subtle Java toolbar & local runner button
      const bar = document.createElement('div');
      bar.className = 'cb-code-bar';
      bar.innerHTML = `<span class="cb-code-lang"><img src="${roomIconUrl('code.svg')}" alt="" width="15" height="15"> Java Code Editor (Tab = 4 spaces)</span>
        <div class="cb-code-actions">
          <span class="cb-code-lines">${ta.value.split('\n').length} lines</span>
          <button type="button" class="cb-code-run-btn" title="Run snippet via local Java runner (127.0.0.1:18765)">▶ Run Java</button>
        </div>`;
      const outBox = document.createElement('pre');
      outBox.className = 'cb-code-output';
      outBox.hidden = true;

      ta.parentNode.insertBefore(bar, ta);
      ta.parentNode.insertBefore(outBox, ta.nextSibling);

      const updateLines = () => {
        bar.querySelector('.cb-code-lines').textContent = `${ta.value.split('\n').length} lines · ${ta.value.length} chars`;
      };
      ta.addEventListener('input', updateLines);
      ta.addEventListener('keydown', (e) => {
        if (e.key === 'Tab') {
          e.preventDefault();
          const s = ta.selectionStart;
          const end = ta.selectionEnd;
          ta.value = ta.value.slice(0, s) + '    ' + ta.value.slice(end);
          ta.selectionStart = ta.selectionEnd = s + 4;
          ta.dispatchEvent(new Event('input', { bubbles: true }));
        } else if (e.key === 'Enter') {
          const s = ta.selectionStart;
          const lineStart = ta.value.lastIndexOf('\n', s - 1) + 1;
          const curLine = ta.value.slice(lineStart, s);
          const indentMatch = curLine.match(/^\s*/);
          let indent = indentMatch ? indentMatch[0] : '';
          if (curLine.trimEnd().endsWith('{')) indent += '    ';
          if (indent) {
            e.preventDefault();
            ta.value = ta.value.slice(0, s) + '\n' + indent + ta.value.slice(ta.selectionEnd);
            ta.selectionStart = ta.selectionEnd = s + 1 + indent.length;
            ta.dispatchEvent(new Event('input', { bubbles: true }));
          }
        }
      });

      bar.querySelector('.cb-code-run-btn').addEventListener('click', async () => {
        outBox.hidden = false;
        outBox.classList.remove('is-err');
        outBox.textContent = 'Compiling & running with javac/java...';
        try {
          const res = await window.roomRunJava(ta.value);
          outBox.classList.toggle('is-err', !res.ok);
          outBox.textContent = res.output || '(Finished with exit code 0.)';
        } catch (err) {
          outBox.classList.add('is-err');
          outBox.textContent = 'Runner unavailable: ' + err.message;
        }
      });
    });
  };
})();
