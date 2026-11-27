/* BluebookTools.js - Floating Desmos Graphing & Scientific Calculator (+ Offline Canvas Fallback), Reference Sheet, Dark Mode & Shortcuts */
(function () {
  const THEME_KEY = 'room_theme_v1';
  let desmosInstance = null;
  let desmosMode = 'graphing'; // 'graphing' | 'scientific'
  let desmosOpen = false;
  let refOpen = false;
  let refPage = 1;
  let refTotalPages = 1;
  let refZoom = 1;
  let refPath = '';
  let refRenderedPath = '';
  let refObserver = null;

  window.roomInitTheme = function () {
    const saved = localStorage.getItem(THEME_KEY) || 'light';
    document.documentElement.setAttribute('data-theme', saved);
  };

  window.roomToggleTheme = function () {
    const cur = document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light';
    const next = cur === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', next);
    localStorage.setItem(THEME_KEY, next);
    document.querySelectorAll('[data-action="room-toggle-theme"]').forEach((btn) => {
      btn.setAttribute('aria-pressed', next === 'dark' ? 'true' : 'false');
    });
  };

  // Call immediately on load
  window.roomInitTheme();

  const PANEL_DEFAULT_DOCK_W = { desmos: 460, ref: 440 };
  const PANEL_WIDE_DOCK_W = { desmos: 600, ref: 580 };
  const panelRegistry = {};
  let topZ = 9002;
  let dockGhostEl = null;

  function clamp(val, min, max) {
    return Math.min(max, Math.max(min, val));
  }

  function resizeDesmosSafely() {
    if (!desmosInstance || typeof desmosInstance.resize !== 'function') return;
    const run = () => {
      if (!desmosOpen || !desmosInstance || typeof desmosInstance.resize !== 'function') return;
      try { desmosInstance.resize(); } catch (_) {}
    };
    requestAnimationFrame(run);
    setTimeout(run, 310);
  }

  function getDockTopOffset() {
    const header = document.querySelector('.exam-blue-bar, .pdf-exam-shell .exam-header, .exam-header');
    if (!header) return 0;
    const r = header.getBoundingClientRect();
    if (!r || r.height <= 0 || r.bottom <= 0) return 0;
    return Math.max(0, Math.round(r.bottom));
  }

  function clampDockWidth(raw) {
    const maxW = Math.max(340, Math.min(760, Math.round(window.innerWidth * 0.54)));
    return clamp(Math.round(raw), 320, maxW);
  }

  function ensureDockGhost() {
    if (dockGhostEl && dockGhostEl.isConnected) return dockGhostEl;
    dockGhostEl = document.createElement('div');
    dockGhostEl.id = 'room-dock-ghost';
    dockGhostEl.className = 'room-dock-ghost';
    dockGhostEl.setAttribute('aria-hidden', 'true');
    dockGhostEl.innerHTML = '<span class="room-dock-ghost-label"></span>';
    document.body.appendChild(dockGhostEl);
    return dockGhostEl;
  }

  function showDockGhost(side) {
    const ghost = ensureDockGhost();
    if (!side) {
      ghost.classList.remove('is-visible', 'is-left', 'is-right');
      return;
    }
    const topPx = getDockTopOffset();
    document.documentElement.style.setProperty('--room-dock-top', topPx + 'px');
    ghost.classList.toggle('is-left', side === 'left');
    ghost.classList.toggle('is-right', side === 'right');
    const lbl = ghost.querySelector('.room-dock-ghost-label');
    if (lbl) lbl.textContent = side === 'left' ? 'Dock to Left Side' : 'Dock to Right Side';
    ghost.classList.add('is-visible');
  }

  function updateDockButtons(meta) {
    const ov = meta?.el;
    if (!ov) return;
    ov.querySelectorAll('[data-dock-cmd]').forEach((btn) => {
      const side = btn.dataset.dockCmd;
      const active = meta.dock === side;
      btn.classList.toggle('is-active', active);
      btn.setAttribute('aria-pressed', active ? 'true' : 'false');
    });
  }

  function syncDockLayout() {
    const topPx = getDockTopOffset();
    const rootStyle = document.documentElement.style;
    rootStyle.setProperty('--room-dock-top', topPx + 'px');

    let leftW = 0;
    let rightW = 0;
    Object.values(panelRegistry).forEach((meta) => {
      const ov = meta.el;
      if (!ov) return;
      if (meta.open && meta.dock === 'left') {
        meta.dockWidth = clampDockWidth(meta.dockWidth || PANEL_DEFAULT_DOCK_W[meta.id] || 440);
        leftW = Math.max(leftW, meta.dockWidth);
        if (!ov.classList.contains('is-morphing')) {
          ov.style.left = '0px';
          ov.style.right = 'auto';
          ov.style.top = topPx + 'px';
          ov.style.bottom = '0px';
          ov.style.width = meta.dockWidth + 'px';
          ov.style.height = `calc(100vh - ${topPx}px)`;
        }
      } else if (meta.open && meta.dock === 'right') {
        meta.dockWidth = clampDockWidth(meta.dockWidth || PANEL_DEFAULT_DOCK_W[meta.id] || 440);
        rightW = Math.max(rightW, meta.dockWidth);
        if (!ov.classList.contains('is-morphing')) {
          ov.style.right = '0px';
          ov.style.left = 'auto';
          ov.style.top = topPx + 'px';
          ov.style.bottom = '0px';
          ov.style.width = meta.dockWidth + 'px';
          ov.style.height = `calc(100vh - ${topPx}px)`;
        }
      } else if (meta.open && meta.dock === 'float' && meta.floatRect && !ov.classList.contains('is-dragging') && !ov.classList.contains('is-morphing')) {
        const w = clamp(meta.floatRect.width, 320, Math.max(340, window.innerWidth - 24));
        const h = clamp(meta.floatRect.height, 260, Math.max(280, window.innerHeight - 24));
        const maxLeft = Math.max(8, window.innerWidth - Math.min(w, 160));
        const minLeft = Math.min(8, -(w - 140));
        const l = clamp(meta.floatRect.left, Math.max(8, minLeft), maxLeft);
        const t = clamp(meta.floatRect.top, 8, Math.max(8, window.innerHeight - 64));
        ov.style.left = Math.round(l) + 'px';
        ov.style.top = Math.round(t) + 'px';
        ov.style.right = 'auto';
        ov.style.bottom = 'auto';
        ov.style.width = Math.round(w) + 'px';
        ov.style.height = Math.round(h) + 'px';
      }
    });

    rootStyle.setProperty('--room-dock-left-w', leftW + 'px');
    rootStyle.setProperty('--room-dock-right-w', rightW + 'px');
    document.body.classList.toggle('room-dock-left', leftW > 0);
    document.body.classList.toggle('room-dock-right', rightW > 0);
  }

  function applyFloatStyleFromMeta(meta) {
    const ov = meta.el;
    if (!ov) return;
    ov.classList.remove('is-docked', 'is-dock-left', 'is-dock-right');
    ov.style.bottom = 'auto';
    if (meta.floatRect) {
      const w = clamp(meta.floatRect.width, 320, Math.max(340, window.innerWidth - 24));
      const h = clamp(meta.floatRect.height, 260, Math.max(280, window.innerHeight - 24));
      const l = clamp(meta.floatRect.left, 8, Math.max(8, window.innerWidth - 140));
      const t = clamp(meta.floatRect.top, 8, Math.max(8, window.innerHeight - 64));
      ov.style.left = Math.round(l) + 'px';
      ov.style.top = Math.round(t) + 'px';
      ov.style.right = 'auto';
      ov.style.width = Math.round(w) + 'px';
      ov.style.height = Math.round(h) + 'px';
    } else {
      ov.style.left = '';
      ov.style.right = '';
      ov.style.top = '';
      ov.style.width = '';
      ov.style.height = '';
    }
    updateDockButtons(meta);
  }

  function setPanelDock(meta, targetDock, animate = true) {
    if (!meta || !meta.el) return;
    const ov = meta.el;
    const prevDock = meta.dock;
    if (prevDock === targetDock && !ov.classList.contains('is-dragging')) {
      syncDockLayout();
      updateDockButtons(meta);
      return;
    }

    // If another open panel already occupies target side, cleanly undock it to floating first
    if (targetDock === 'left' || targetDock === 'right') {
      Object.values(panelRegistry).forEach((other) => {
        if (other !== meta && other.open && other.dock === targetDock) {
          setPanelDock(other, 'float', true);
        }
      });
    }

    const fromRect = (animate && meta.open && !ov.hasAttribute('hidden')) ? ov.getBoundingClientRect() : null;
    if (prevDock === 'float' && fromRect && fromRect.width > 120 && !ov.classList.contains('is-wide')) {
      meta.floatRect = {
        left: fromRect.left,
        top: fromRect.top,
        width: fromRect.width,
        height: fromRect.height,
      };
    }

    meta.dock = targetDock;
    ov.classList.toggle('is-docked', targetDock === 'left' || targetDock === 'right');
    ov.classList.toggle('is-dock-left', targetDock === 'left');
    ov.classList.toggle('is-dock-right', targetDock === 'right');
    updateDockButtons(meta);

    if (fromRect) {
      if (meta.morphTimer) { clearTimeout(meta.morphTimer); meta.morphTimer = null; }
      ov.classList.remove('is-morphing');
      ov.style.left = Math.round(fromRect.left) + 'px';
      ov.style.top = Math.round(fromRect.top) + 'px';
      ov.style.width = Math.round(fromRect.width) + 'px';
      ov.style.height = Math.round(fromRect.height) + 'px';
      ov.style.right = 'auto';
      ov.style.bottom = 'auto';
      void ov.offsetWidth;
      ov.classList.add('is-morphing');

      const topPx = getDockTopOffset();
      if (targetDock === 'left' || targetDock === 'right') {
        const w = clampDockWidth(meta.dockWidth || PANEL_DEFAULT_DOCK_W[meta.id] || 440);
        meta.dockWidth = w;
        const targetLeft = targetDock === 'left' ? 0 : Math.max(0, window.innerWidth - w);
        ov.style.left = Math.round(targetLeft) + 'px';
        ov.style.top = topPx + 'px';
        ov.style.width = w + 'px';
        ov.style.height = Math.max(240, window.innerHeight - topPx) + 'px';
      } else {
        const defW = meta.id === 'desmos' ? Math.min(490, Math.round(window.innerWidth * 0.92)) : Math.min(490, Math.round(window.innerWidth * 0.92));
        const defH = Math.min(560, Math.round(window.innerHeight * 0.8));
        const fallbackLeft = meta.id === 'ref' ? 22 : Math.max(22, window.innerWidth - defW - 22);
        const fRect = meta.floatRect || { left: fallbackLeft, top: 72, width: defW, height: defH };
        const w = clamp(fRect.width, 320, Math.max(340, window.innerWidth - 24));
        const h = clamp(fRect.height, 260, Math.max(280, window.innerHeight - 24));
        const l = clamp(fRect.left, 8, Math.max(8, window.innerWidth - w - 8));
        const t = clamp(fRect.top, 8, Math.max(8, window.innerHeight - 64));
        ov.style.left = Math.round(l) + 'px';
        ov.style.top = Math.round(t) + 'px';
        ov.style.width = Math.round(w) + 'px';
        ov.style.height = Math.round(h) + 'px';
      }
      syncDockLayout();
      meta.morphTimer = setTimeout(() => {
        meta.morphTimer = null;
        ov.classList.remove('is-morphing');
        if (meta.dock === 'float') applyFloatStyleFromMeta(meta);
        else syncDockLayout();
        if (meta.id === 'desmos') resizeDesmosSafely();
      }, 300);
      return;
    }

    if (targetDock === 'float') applyFloatStyleFromMeta(meta);
    syncDockLayout();
    if (meta.id === 'desmos') resizeDesmosSafely();
  }

  function openManagedPanel(meta) {
    const ov = meta.el;
    if (!ov) return;
    if (meta.closeTimer) { clearTimeout(meta.closeTimer); meta.closeTimer = null; }
    if (meta.morphTimer) { clearTimeout(meta.morphTimer); meta.morphTimer = null; }
    meta.open = true;
    ov.style.zIndex = String(++topZ);
    ov.classList.remove('is-closing', 'is-morphing');
    if (meta.dock === 'float') applyFloatStyleFromMeta(meta);
    ov.removeAttribute('hidden');
    syncDockLayout();
    updateDockButtons(meta);
    void ov.offsetWidth;
    ov.classList.add('is-open');
    if (meta.id === 'desmos') resizeDesmosSafely();
  }

  function closeManagedPanel(meta, immediate = false) {
    const ov = meta?.el;
    if (!ov) return;
    if (meta.closeTimer) { clearTimeout(meta.closeTimer); meta.closeTimer = null; }
    if (meta.morphTimer) { clearTimeout(meta.morphTimer); meta.morphTimer = null; }
    meta.open = false;
    ov.classList.remove('is-open', 'is-morphing', 'is-dragging');
    showDockGhost(null);
    document.body.classList.remove('room-is-dragging', 'room-is-resizing');
    if (immediate || ov.hasAttribute('hidden')) {
      ov.classList.remove('is-closing');
      ov.setAttribute('hidden', '');
      syncDockLayout();
      return;
    }
    ov.classList.add('is-closing');
    syncDockLayout();
    meta.closeTimer = setTimeout(() => {
      meta.closeTimer = null;
      if (!meta.open) {
        ov.classList.remove('is-closing');
        ov.setAttribute('hidden', '');
      }
    }, 230);
  }

  function makeDraggable(panel, handle, meta) {
    panelRegistry[meta.id] = meta;
    let dragging = false;
    let pointerId = null;
    let sx = 0, sy = 0, ox = 0, oy = 0, rectW = 0, rectH = 0;
    let startedDocked = false;
    let undockedDuringDrag = false;
    let snapSide = null;

    panel.addEventListener('pointerdown', () => {
      if (meta.open) panel.style.zIndex = String(++topZ);
    }, { capture: true });

    handle.addEventListener('dblclick', (e) => {
      if (e.target.closest('button, input, select, a, label')) return;
      const defaultSide = meta.id === 'ref' ? 'left' : 'right';
      setPanelDock(meta, meta.dock === 'float' ? defaultSide : 'float', true);
    });

    handle.addEventListener('pointerdown', (e) => {
      if (e.button !== undefined && e.button !== 0) return;
      if (e.target.closest('button, input, select, a, label')) return;
      if (!meta.open) return;

      e.preventDefault();
      dragging = true;
      pointerId = e.pointerId;
      try { handle.setPointerCapture?.(e.pointerId); } catch (_) {}

      const rect = panel.getBoundingClientRect();
      sx = e.clientX;
      sy = e.clientY;
      ox = rect.left;
      oy = rect.top;
      rectW = rect.width;
      rectH = rect.height;
      startedDocked = meta.dock === 'left' || meta.dock === 'right';
      undockedDuringDrag = false;
      snapSide = null;

      if (meta.morphTimer) { clearTimeout(meta.morphTimer); meta.morphTimer = null; }
      panel.classList.remove('is-morphing');
      panel.style.zIndex = String(++topZ);
      panel.classList.add('is-dragging');
      document.body.classList.add('room-is-dragging');

      if (!startedDocked) {
        panel.style.right = 'auto';
        panel.style.bottom = 'auto';
        panel.style.left = Math.round(ox) + 'px';
        panel.style.top = Math.round(oy) + 'px';
        panel.style.width = Math.round(rectW) + 'px';
        panel.style.height = Math.round(rectH) + 'px';
      }
    });

    const onMove = (e) => {
      if (!dragging) return;
      if (pointerId !== null && e.pointerId !== undefined && e.pointerId !== pointerId) return;
      const dx = e.clientX - sx;
      const dy = e.clientY - sy;

      if (startedDocked && !undockedDuringDrag) {
        if (Math.hypot(dx, dy) < 10) return;
        undockedDuringDrag = true;
        const targetW = meta.floatRect ? clamp(meta.floatRect.width, 320, Math.max(340, window.innerWidth - 24)) : Math.min(490, Math.round(window.innerWidth * 0.92));
        const targetH = meta.floatRect ? clamp(meta.floatRect.height, 260, Math.max(280, window.innerHeight - 24)) : Math.min(560, Math.round(window.innerHeight * 0.8));
        const ratioX = rectW > 0 ? clamp((sx - ox) / rectW, 0.15, 0.85) : 0.5;
        ox = clamp(sx - ratioX * targetW, 8, Math.max(8, window.innerWidth - targetW - 8));
        oy = clamp(sy - 20, 8, Math.max(8, window.innerHeight - 64));
        rectW = targetW;
        rectH = targetH;

        meta.dock = 'float';
        panel.classList.remove('is-docked', 'is-dock-left', 'is-dock-right');
        updateDockButtons(meta);
        syncDockLayout();
        panel.style.right = 'auto';
        panel.style.bottom = 'auto';
        panel.style.width = Math.round(rectW) + 'px';
        panel.style.height = Math.round(rectH) + 'px';
      }

      if (startedDocked && !undockedDuringDrag) return;

      const minLeft = Math.min(8, -(rectW - 140));
      const maxLeft = Math.max(8, window.innerWidth - 120);
      const nx = clamp(ox + dx, Math.min(minLeft, 8), maxLeft);
      const ny = clamp(oy + dy, 8, Math.max(8, window.innerHeight - 56));
      panel.style.left = Math.round(nx) + 'px';
      panel.style.top = Math.round(ny) + 'px';

      if (e.clientX <= 56) {
        snapSide = 'left';
        showDockGhost('left');
      } else if (e.clientX >= window.innerWidth - 56) {
        snapSide = 'right';
        showDockGhost('right');
      } else {
        snapSide = null;
        showDockGhost(null);
      }
    };

    const onUp = (e) => {
      if (!dragging) return;
      if (pointerId !== null && e.pointerId !== undefined && e.pointerId !== pointerId) return;
      dragging = false;
      try { if (pointerId !== null) handle.releasePointerCapture?.(pointerId); } catch (_) {}
      pointerId = null;

      panel.classList.remove('is-dragging');
      document.body.classList.remove('room-is-dragging');
      showDockGhost(null);

      if (snapSide === 'left' || snapSide === 'right') {
        const chosen = snapSide;
        snapSide = null;
        setPanelDock(meta, chosen, true);
        return;
      }

      if (meta.dock === 'float') {
        const r = panel.getBoundingClientRect();
        if (r.width >= 300 && r.height >= 240) {
          meta.floatRect = { left: r.left, top: r.top, width: r.width, height: r.height };
        }
        if (undockedDuringDrag && meta.id === 'desmos') resizeDesmosSafely();
      }
    };

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);

    // Corner resize handle (floating mode) & vertical edge splitter (docked mode)
    const cornerGrip = panel.querySelector('.room-float-resize-se');
    const edgeGrip = panel.querySelector('.room-dock-resizer');

    if (cornerGrip) {
      let resizing = false;
      let rPid = null;
      let rsx = 0, rsy = 0, rw = 0, rh = 0, rl = 0, rt = 0;
      cornerGrip.addEventListener('pointerdown', (e) => {
        if (e.button !== undefined && e.button !== 0) return;
        if (meta.dock !== 'float' || !meta.open) return;
        e.preventDefault();
        e.stopPropagation();
        resizing = true;
        rPid = e.pointerId;
        try { cornerGrip.setPointerCapture?.(e.pointerId); } catch (_) {}
        const r = panel.getBoundingClientRect();
        rsx = e.clientX; rsy = e.clientY;
        rw = r.width; rh = r.height; rl = r.left; rt = r.top;
        panel.classList.remove('is-wide', 'is-morphing');
        panel.style.left = Math.round(rl) + 'px';
        panel.style.top = Math.round(rt) + 'px';
        panel.style.right = 'auto';
        panel.style.bottom = 'auto';
        document.body.classList.add('room-is-resizing');
      });
      const onRM = (e) => {
        if (!resizing) return;
        if (rPid !== null && e.pointerId !== undefined && e.pointerId !== rPid) return;
        const nw = clamp(rw + (e.clientX - rsx), 340, Math.max(360, window.innerWidth - rl - 8));
        const nh = clamp(rh + (e.clientY - rsy), 280, Math.max(300, window.innerHeight - rt - 8));
        panel.style.width = Math.round(nw) + 'px';
        panel.style.height = Math.round(nh) + 'px';
      };
      const onRU = (e) => {
        if (!resizing) return;
        if (rPid !== null && e.pointerId !== undefined && e.pointerId !== rPid) return;
        resizing = false;
        try { if (rPid !== null) cornerGrip.releasePointerCapture?.(rPid); } catch (_) {}
        rPid = null;
        document.body.classList.remove('room-is-resizing');
        const r = panel.getBoundingClientRect();
        meta.floatRect = { left: r.left, top: r.top, width: r.width, height: r.height };
        if (meta.id === 'desmos') resizeDesmosSafely();
      };
      window.addEventListener('pointermove', onRM);
      window.addEventListener('pointerup', onRU);
      window.addEventListener('pointercancel', onRU);
    }

    if (edgeGrip) {
      let edgeResizing = false;
      let ePid = null;
      let esx = 0, startW = 0;
      edgeGrip.addEventListener('pointerdown', (e) => {
        if (e.button !== undefined && e.button !== 0) return;
        if (meta.dock === 'float' || !meta.open) return;
        e.preventDefault();
        e.stopPropagation();
        edgeResizing = true;
        ePid = e.pointerId;
        try { edgeGrip.setPointerCapture?.(e.pointerId); } catch (_) {}
        esx = e.clientX;
        startW = panel.getBoundingClientRect().width;
        document.body.classList.add('room-is-resizing');
      });
      const onEM = (e) => {
        if (!edgeResizing) return;
        if (ePid !== null && e.pointerId !== undefined && e.pointerId !== ePid) return;
        const delta = meta.dock === 'left' ? (e.clientX - esx) : (esx - e.clientX);
        meta.dockWidth = clampDockWidth(startW + delta);
        syncDockLayout();
      };
      const onEU = (e) => {
        if (!edgeResizing) return;
        if (ePid !== null && e.pointerId !== undefined && e.pointerId !== ePid) return;
        edgeResizing = false;
        try { if (ePid !== null) edgeGrip.releasePointerCapture?.(ePid); } catch (_) {}
        ePid = null;
        document.body.classList.remove('room-is-resizing');
        if (meta.id === 'desmos') resizeDesmosSafely();
      };
      window.addEventListener('pointermove', onEM);
      window.addEventListener('pointerup', onEU);
      window.addEventListener('pointercancel', onEU);
    }
  }

  window.addEventListener('resize', () => {
    syncDockLayout();
    if (desmosOpen) resizeDesmosSafely();
  });

  // --- Offline Interactive Canvas Graphing + Scientific Calculator Fallback ---
  function mountOfflineCalculator(container, mode) {
    container.innerHTML = '';
    if (mode === 'scientific') {
      const wrap = document.createElement('div');
      wrap.className = 'cb-sci-calc';
      wrap.innerHTML = `
        <div class="cb-sci-screen">
          <div class="cb-sci-hist" id="cb-sci-hist">Ready</div>
          <input type="text" class="cb-sci-input" id="cb-sci-input" placeholder="e.g. sin(pi/6) + sqrt(16)" value="">
          <div class="cb-sci-out" id="cb-sci-out">0</div>
        </div>
        <div class="cb-sci-grid">
          ${['sin(','cos(','tan(','log(','ln(','√(','^','π','e','(',')','C',
             '7','8','9','/','4','5','6','*','1','2','3','-','0','.','⌫','+','Ans','='].map(k =>
              `<button type="button" class="cb-sci-key ${k==='='?'is-eq':''} ${k==='C'?'is-clr':''}" data-k="${k}">${k}</button>`
            ).join('')}
        </div>`;
      container.appendChild(wrap);
      const inp = wrap.querySelector('#cb-sci-input');
      const out = wrap.querySelector('#cb-sci-out');
      const hist = wrap.querySelector('#cb-sci-hist');
      let lastAns = 0;

      function evalExpr(expr) {
        const cleaned = expr
          .replace(/π/g, 'Math.PI')
          .replace(/\bpi\b/gi, 'Math.PI')
          .replace(/\be\b/g, 'Math.E')
          .replace(/\bAns\b/gi, String(lastAns))
          .replace(/√\(/g, 'Math.sqrt(')
          .replace(/\bsqrt\(/gi, 'Math.sqrt(')
          .replace(/\bsin\(/gi, 'Math.sin(')
          .replace(/\bcos\(/gi, 'Math.cos(')
          .replace(/\btan\(/gi, 'Math.tan(')
          .replace(/\blog\(/gi, 'Math.log10(')
          .replace(/\bln\(/gi, 'Math.log(')
          .replace(/\babs\(/gi, 'Math.abs(')
          .replace(/\^/g, '**');
        if (/[^0-9+\-*/().,%\sA-Za-z_]/.test(cleaned)) throw new Error('Invalid chars');
        const val = Function('"use strict"; return (' + cleaned + ')')();
        if (typeof val !== 'number' || !Number.isFinite(val)) throw new Error('NaN');
        return val;
      }

      function compute() {
        if (!inp.value.trim()) return;
        try {
          const val = evalExpr(inp.value);
          lastAns = Math.round(val * 1e10) / 1e10;
          hist.textContent = inp.value + ' =';
          out.textContent = String(lastAns);
        } catch (err) {
          out.textContent = 'Error';
        }
      }
      inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') compute(); });
      wrap.querySelector('.cb-sci-grid').addEventListener('click', (e) => {
        const b = e.target.closest('[data-k]');
        if (!b) return;
        const k = b.dataset.k;
        if (k === '=') compute();
        else if (k === 'C') { inp.value = ''; out.textContent = '0'; hist.textContent = 'Ready'; }
        else if (k === '⌫') inp.value = inp.value.slice(0, -1);
        else if (k === 'Ans') inp.value += String(lastAns);
        else { inp.value += k; inp.focus(); }
      });
      return;
    }

    // Graphing fallback
    const wrap = document.createElement('div');
    wrap.className = 'cb-graph-fallback';
    wrap.innerHTML = `
      <div class="cb-graph-exprs">
        <div class="cb-graph-row"><span class="cb-dot" style="background:#2d70b3"></span><input type="text" class="cb-g-inp" value="x^2 - 3"></div>
        <div class="cb-graph-row"><span class="cb-dot" style="background:#c74440"></span><input type="text" class="cb-g-inp" value="2*sin(x)"></div>
        <div class="cb-graph-row"><span class="cb-dot" style="background:#388c46"></span><input type="text" class="cb-g-inp" placeholder="y = f(x)"></div>
      </div>
      <div class="cb-graph-canvas-wrap">
        <canvas class="cb-graph-canvas" width="440" height="320"></canvas>
        <div class="cb-graph-ctrls">
          <button type="button" data-g="in" title="Zoom In">+</button>
          <button type="button" data-g="out" title="Zoom Out">−</button>
          <button type="button" data-g="reset" title="Reset View">⌂</button>
        </div>
      </div>`;
    container.appendChild(wrap);
    const canvas = wrap.querySelector('canvas');
    const ctx = canvas.getContext('2d');
    let scale = 32; // px per unit
    let cx = canvas.width / 2, cy = canvas.height / 2;
    const colors = ['#2d70b3', '#c74440', '#388c46'];

    function compileFn(raw) {
      let s = raw.trim().replace(/^y\s*=\s*/i, '');
      if (!s) return null;
      s = s
        .replace(/\bpi\b/gi, 'Math.PI')
        .replace(/\be\b/g, 'Math.E')
        .replace(/\b(sin|cos|tan|sqrt|abs|log|exp|pow|floor|ceil)\(/gi, 'Math.$1(')
        .replace(/\bln\(/gi, 'Math.log(')
        .replace(/\^/g, '**');
      try {
        return new Function('x', 'try { return (' + s + '); } catch(_) { return NaN; }');
      } catch (_) {
        return null;
      }
    }

    function draw() {
      const w = canvas.width, h = canvas.height;
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, w, h);
      // Grid
      ctx.strokeStyle = '#e2e8f0';
      ctx.lineWidth = 1;
      for (let x = cx % scale; x < w; x += scale) {
        ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke();
      }
      for (let y = cy % scale; y < h; y += scale) {
        ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke();
      }
      // Axes
      ctx.strokeStyle = '#334155';
      ctx.lineWidth = 1.6;
      ctx.beginPath(); ctx.moveTo(0, cy); ctx.lineTo(w, cy); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(cx, 0); ctx.lineTo(cx, h); ctx.stroke();

      wrap.querySelectorAll('.cb-g-inp').forEach((inp, idx) => {
        const fn = compileFn(inp.value);
        if (!fn) return;
        ctx.strokeStyle = colors[idx % colors.length];
        ctx.lineWidth = 2.2;
        ctx.beginPath();
        let penDown = false;
        for (let px = 0; px < w; px += 1.5) {
          const x = (px - cx) / scale;
          const y = fn(x);
          if (typeof y === 'number' && Number.isFinite(y) && Math.abs(y) < 1e4) {
            const py = cy - y * scale;
            if (!penDown) { ctx.moveTo(px, py); penDown = true; }
            else ctx.lineTo(px, py);
          } else {
            penDown = false;
          }
        }
        ctx.stroke();
      });
    }

    wrap.querySelectorAll('.cb-g-inp').forEach((i) => i.addEventListener('input', draw));
    wrap.addEventListener('click', (e) => {
      const g = e.target.closest('[data-g]')?.dataset.g;
      if (g === 'in') { scale = Math.min(120, scale * 1.3); draw(); }
      else if (g === 'out') { scale = Math.max(8, scale / 1.3); draw(); }
      else if (g === 'reset') { scale = 32; cx = canvas.width / 2; cy = canvas.height / 2; draw(); }
    });
    draw();
  }

  const GRIP_SVG = '<svg class="room-float-grip" viewBox="0 0 10 16" width="10" height="16" aria-hidden="true"><circle cx="2.5" cy="3" r="1.25" fill="currentColor"/><circle cx="7.5" cy="3" r="1.25" fill="currentColor"/><circle cx="2.5" cy="8" r="1.25" fill="currentColor"/><circle cx="7.5" cy="8" r="1.25" fill="currentColor"/><circle cx="2.5" cy="13" r="1.25" fill="currentColor"/><circle cx="7.5" cy="13" r="1.25" fill="currentColor"/></svg>';
  const DOCK_LEFT_SVG = '<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><rect x="1.5" y="2.5" width="13" height="11" rx="2" fill="none" stroke="currentColor" stroke-width="1.5"/><rect x="3" y="4" width="4.5" height="8" rx="1" fill="currentColor"/></svg>';
  const DOCK_RIGHT_SVG = '<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><rect x="1.5" y="2.5" width="13" height="11" rx="2" fill="none" stroke="currentColor" stroke-width="1.5"/><rect x="8.5" y="4" width="4.5" height="8" rx="1" fill="currentColor"/></svg>';

  function toggleSizeForPanel(meta, ov) {
    if (!meta || !ov) return;
    if (meta.dock === 'left' || meta.dock === 'right') {
      const defW = PANEL_DEFAULT_DOCK_W[meta.id] || 440;
      const wideW = PANEL_WIDE_DOCK_W[meta.id] || 580;
      const isCurrentlyWide = meta.dockWidth >= wideW - 20;
      meta.dockWidth = clampDockWidth(isCurrentlyWide ? defW : wideW);
      ov.classList.add('is-morphing');
      syncDockLayout();
      setTimeout(() => {
        ov.classList.remove('is-morphing');
        if (meta.id === 'desmos') resizeDesmosSafely();
      }, 300);
      return;
    }
    const nextWide = !ov.classList.contains('is-wide');
    meta.floatRect = null;
    ov.style.width = '';
    ov.style.height = '';
    ov.classList.toggle('is-wide', nextWide);
    if (meta.id === 'desmos') resizeDesmosSafely();
  }

  function ensureDesmosOverlay() {
    let ov = document.getElementById('room-desmos-overlay');
    if (ov) return ov;
    ov = document.createElement('section');
    ov.id = 'room-desmos-overlay';
    ov.className = 'room-float-panel room-desmos-panel';
    ov.setAttribute('hidden', '');
    ov.innerHTML = `
      <div class="room-float-head">
        <div class="room-float-title">
          ${GRIP_SVG}
          <img src="${roomIconUrl('desmos.svg')}" alt="" width="18" height="18" draggable="false">
          <span>Calculator · Desmos</span>
        </div>
        <div class="room-float-tabs">
          <button type="button" class="room-ftab is-active" data-dmode="graphing">Graphing</button>
          <button type="button" class="room-ftab" data-dmode="scientific">Scientific</button>
        </div>
        <div class="room-float-actions">
          <button type="button" data-dock-cmd="left" aria-pressed="false" title="Dock to Left Side">${DOCK_LEFT_SVG}</button>
          <button type="button" data-dock-cmd="right" aria-pressed="false" title="Dock to Right Side">${DOCK_RIGHT_SVG}</button>
          <button type="button" data-dact="size" title="Expand / Compact">⤢</button>
          <button type="button" data-dact="close" title="Close (D)">✕</button>
        </div>
      </div>
      <div class="room-desmos-host" id="room-desmos-host"></div>
      <div class="room-dock-resizer" aria-hidden="true"></div>
      <div class="room-float-resize-se" aria-hidden="true"></div>`;
    document.body.appendChild(ov);
    const meta = {
      id: 'desmos',
      el: ov,
      open: false,
      dock: 'float',
      floatRect: null,
      dockWidth: PANEL_DEFAULT_DOCK_W.desmos,
      closeTimer: null,
      morphTimer: null,
    };
    makeDraggable(ov, ov.querySelector('.room-float-head'), meta);

    ov.addEventListener('click', (e) => {
      const m = e.target.closest('[data-dmode]');
      if (m) {
        mountCalculatorMode(m.dataset.dmode);
        return;
      }
      const dockBtn = e.target.closest('[data-dock-cmd]');
      if (dockBtn) {
        const targetSide = dockBtn.dataset.dockCmd;
        setPanelDock(meta, meta.dock === targetSide ? 'float' : targetSide, true);
        return;
      }
      const act = e.target.closest('[data-dact]')?.dataset.dact;
      if (act === 'close') window.roomToggleDesmos(false);
      else if (act === 'size') toggleSizeForPanel(meta, ov);
    });
    return ov;
  }

  function mountCalculatorMode(mode) {
    desmosMode = mode;
    const ov = ensureDesmosOverlay();
    ov.querySelectorAll('[data-dmode]').forEach((b) => {
      b.classList.toggle('is-active', b.dataset.dmode === mode);
    });
    const host = ov.querySelector('#room-desmos-host');
    if (desmosInstance && typeof desmosInstance.destroy === 'function') {
      try { desmosInstance.destroy(); } catch (_) {}
      desmosInstance = null;
    }
    host.innerHTML = '';

    // Try live Desmos API first (loaded via Assets/desmos.js), else cleanly mount offline fallback
    try {
      if (window.Desmos) {
        if (mode === 'graphing' && typeof window.Desmos.GraphingCalculator === 'function') {
          desmosInstance = window.Desmos.GraphingCalculator(host, {
            keypad: true,
            expressions: true,
            settingsMenu: false,
            zoomButtons: true,
            border: false,
          });
          resizeDesmosSafely();
          return;
        }
        if (mode === 'scientific' && typeof window.Desmos.ScientificCalculator === 'function') {
          desmosInstance = window.Desmos.ScientificCalculator(host, {
            qwertyKeyboard: true,
            border: false,
          });
          resizeDesmosSafely();
          return;
        }
      }
    } catch (err) {
      console.warn('Desmos API init fallback:', err);
    }
    mountOfflineCalculator(host, mode);
  }

  window.roomToggleDesmos = function (force, opts) {
    const ex = typeof window.getCurrentExam === 'function' ? window.getCurrentExam() : null;
    const next = typeof force === 'boolean' ? force : !desmosOpen;
    const ov = ensureDesmosOverlay();
    const meta = panelRegistry.desmos;
    desmosOpen = next;
    if (next) {
      const preferred = ex && ex.calculator === 'scientific' ? 'scientific' : 'graphing';
      openManagedPanel(meta);
      if (!desmosInstance && !ov.querySelector('.cb-sci-calc, .cb-graph-fallback')) {
        mountCalculatorMode(preferred);
      } else if (preferred !== desmosMode) {
        mountCalculatorMode(preferred);
      } else {
        resizeDesmosSafely();
      }
      document.querySelectorAll('[data-action="room-toggle-desmos"]').forEach((b) => b.classList.add('active'));
    } else {
      closeManagedPanel(meta, Boolean(opts && opts.immediate));
      document.querySelectorAll('[data-action="room-toggle-desmos"]').forEach((b) => b.classList.remove('active'));
    }
  };

  // --- Floating Subject-Aware Reference Sheet ---
  const BUILTIN_REFS = {
    builtin_calc_bc: `
      <div class="cb-ref-builtin">
        <h3>AP Calculus AB & BC Essential Formulas</h3>
        <div class="cb-ref-grid">
          <div class="cb-ref-card">
            <h4>Derivatives & Integrals</h4>
            <p>$$\\frac{d}{dx}[\\ln u] = \\frac{u'}{u}, \\quad \\frac{d}{dx}[a^u] = a^u (\\ln a) u'$$</p>
            <p>$$\\frac{d}{dx}[\\arctan u] = \\frac{u'}{1+u^2}, \\quad \\frac{d}{dx}[\\arcsin u] = \\frac{u'}{\\sqrt{1-u^2}}$$</p>
            <p>$$\\int u\\,dv = uv - \\int v\\,du \\quad \\text{(Integration by Parts)}$$</p>
            <p>$$\\int \\frac{du}{a^2+u^2} = \\frac{1}{a}\\arctan\\left(\\frac{u}{a}\\right) + C$$</p>
          </div>
          <div class="cb-ref-card">
            <h4>BC: Parametric, Polar & Vectors</h4>
            <p>$$\\frac{dy}{dx} = \\frac{dy/dt}{dx/dt}, \\quad \\frac{d^2y}{dx^2} = \\frac{\\frac{d}{dt}(dy/dx)}{dx/dt}$$</p>
            <p>$$L = \\int_a^b \\sqrt{\\left(\\frac{dx}{dt}\\right)^2 + \\left(\\frac{dy}{dt}\\right)^2}\\,dt$$</p>
            <p>$$\\text{Polar Area } A = \\frac{1}{2}\\int_\\alpha^\\beta [r(\\theta)]^2\\,d\\theta$$</p>
            <p>$$L_{\\text{polar}} = \\int_\\alpha^\\beta \\sqrt{r^2 + \\left(\\frac{dr}{d\\theta}\\right)^2}\\,d\\theta$$</p>
          </div>
          <div class="cb-ref-card">
            <h4>BC: Series & Taylor Polynomials</h4>
            <p>$$e^x = \\sum_{n=0}^{\\infty} \\frac{x^n}{n!}, \\quad \\sin x = \\sum_{n=0}^{\\infty} (-1)^n \\frac{x^{2n+1}}{(2n+1)!}$$</p>
            <p>$$\\cos x = \\sum_{n=0}^{\\infty} (-1)^n \\frac{x^{2n}}{(2n)!}, \\quad \\frac{1}{1-x} = \\sum_{n=0}^{\\infty} x^n \\; (|x|<1)$$</p>
            <p>$$|R_n(x)| \\le \\frac{M |x-a|^{n+1}}{(n+1)!} \\quad \\text{(Lagrange Error Bound)}$$</p>
            <p>$$\\text{Logistic DE: } \\frac{dP}{dt} = kP\\left(1 - \\frac{P}{L}\\right) \\implies P_{\\max\\text{ rate}} = \\frac{L}{2}$$</p>
          </div>
        </div>
      </div>`,
    builtin_chem: `
      <div class="cb-ref-builtin">
        <h3>AP Chemistry Equations, Constants & Periodic Reference</h3>
        <div class="cb-ref-grid">
          <div class="cb-ref-card">
            <h4>Atomic Structure & Equilibrium</h4>
            <p>$$E = h\\nu, \\quad c = \\lambda\\nu \\quad (h=6.626\\times 10^{-34}\\text{ J}\\cdot\\text{s},\\; c=2.998\\times 10^8\\text{ m/s})$$</p>
            <p>$$K_p = K_c(RT)^{\\Delta n}, \\quad K_w = [\\text{H}^+][\\text{OH}^-] = 1.0\\times 10^{-14} \\; (25^\\circ\\text{C})$$</p>
            <p>$$\\text{pH} = \\text{p}K_a + \\log\\frac{[\\text{A}^-]}{[\\text{HA}]} \\quad \\text{(Henderson–Hasselbalch)}$$</p>
          </div>
          <div class="cb-ref-card">
            <h4>Kinetics & Gases</h4>
            <p>$$[A]_t - [A]_0 = -kt \\; (0\\text{th}), \\quad \\ln[A]_t - \\ln[A]_0 = -kt \\; (1\\text{st}), \\quad t_{1/2} = \\frac{0.693}{k}$$</p>
            <p>$$\\frac{1}{[A]_t} - \\frac{1}{[A]_0} = kt \\; (2\\text{nd})$$</p>
            <p>$$PV = nRT \\quad (R = 0.08206\\text{ L}\\cdot\\text{atm}\\cdot\\text{mol}^{-1}\\cdot\\text{K}^{-1} = 8.314\\text{ J}\\cdot\\text{mol}^{-1}\\cdot\\text{K}^{-1})$$</p>
          </div>
          <div class="cb-ref-card">
            <h4>Thermodynamics & Electrochemistry</h4>
            <p>$$q = mc\\Delta T, \\quad \\Delta G^\\circ = \\Delta H^\\circ - T\\Delta S^\\circ = -RT\\ln K = -nFE^\\circ$$</p>
            <p>$$I = \\frac{q}{t}, \\quad F = 96{,}485\\text{ C/mol }e^-, \\quad N_A = 6.022\\times 10^{23}\\text{ mol}^{-1}$$</p>
            <p><strong>Key Molar Masses (g/mol):</strong> H 1.008 · C 12.01 · N 14.01 · O 16.00 · Na 22.99 · Cl 35.45 · S 32.06 · Fe 55.85 · Cu 63.55 · Ag 107.87</p>
          </div>
        </div>
      </div>`,
  };

  function ensureRefOverlay() {
    let ov = document.getElementById('room-ref-overlay');
    if (ov) return ov;
    ov = document.createElement('section');
    ov.id = 'room-ref-overlay';
    ov.className = 'room-float-panel room-ref-panel';
    ov.setAttribute('hidden', '');
    ov.innerHTML = `
      <div class="room-float-head">
        <div class="room-float-title">
          ${GRIP_SVG}
          <img src="${roomIconUrl('reference.svg')}" alt="" width="18" height="18" draggable="false">
          <span id="room-ref-title">Reference Sheet</span>
        </div>
        <div class="room-ref-pager" id="room-ref-pager" hidden>
          <button type="button" data-ract="prev">◀</button>
          <span id="room-ref-page-lbl">1 / 1</span>
          <button type="button" data-ract="next">▶</button>
          <button type="button" data-ract="zin">+</button>
          <button type="button" data-ract="zout">−</button>
          <button type="button" data-ract="ext" title="Open Full PDF">↗</button>
        </div>
        <div class="room-float-actions">
          <button type="button" data-dock-cmd="left" aria-pressed="false" title="Dock to Left Side">${DOCK_LEFT_SVG}</button>
          <button type="button" data-dock-cmd="right" aria-pressed="false" title="Dock to Right Side">${DOCK_RIGHT_SVG}</button>
          <button type="button" data-ract="size" title="Expand / Compact">⤢</button>
          <button type="button" data-ract="close" title="Close (R)">✕</button>
        </div>
      </div>
      <div class="room-ref-body" id="room-ref-body"></div>
      <div class="room-dock-resizer" aria-hidden="true"></div>
      <div class="room-float-resize-se" aria-hidden="true"></div>`;
    document.body.appendChild(ov);
    const meta = {
      id: 'ref',
      el: ov,
      open: false,
      dock: 'float',
      floatRect: null,
      dockWidth: PANEL_DEFAULT_DOCK_W.ref,
      closeTimer: null,
      morphTimer: null,
    };
    makeDraggable(ov, ov.querySelector('.room-float-head'), meta);
    ov.addEventListener('click', (e) => {
      const dockBtn = e.target.closest('[data-dock-cmd]');
      if (dockBtn) {
        const targetSide = dockBtn.dataset.dockCmd;
        setPanelDock(meta, meta.dock === targetSide ? 'float' : targetSide, true);
        return;
      }
      const act = e.target.closest('[data-ract]')?.dataset.ract;
      if (!act) return;
      if (act === 'close') window.roomToggleRef(false);
      else if (act === 'size') toggleSizeForPanel(meta, ov);
      else if (act === 'prev' && refPage > 1) { scrollToRefPage(refPage - 1); }
      else if (act === 'next' && refPage < refTotalPages) { scrollToRefPage(refPage + 1); }
      else if (act === 'zin') { refZoom = Math.min(2.2, refZoom + 0.2); applyRefZoom(); }
      else if (act === 'zout') { refZoom = Math.max(0.7, refZoom - 0.2); applyRefZoom(); }
      else if (act === 'ext' && refPath) roomOpenPdfExternal(refPath);
    });
    return ov;
  }

  function applyRefZoom() {
    document.querySelectorAll('#room-ref-body .cb-ref-pdf-slot img').forEach((img) => {
      img.style.width = Math.round(100 * refZoom) + '%';
    });
  }

  function loadRefSlot(slot, path) {
    if (!slot || slot.dataset.loaded === '1') return;
    slot.dataset.loaded = '1';
    const pNum = Number(slot.dataset.refPage) || 1;
    const img = slot.querySelector('img');
    if (!img) return;
    if (!img.dataset.lbWired) {
      img.dataset.lbWired = '1';
      img.addEventListener('click', () => {
        if (img.src && typeof window.openRoomLightbox === 'function') {
          window.openRoomLightbox(img.src, `Reference Sheet — Page ${pNum}`);
        }
      });
    }
    if (typeof window.roomRenderPdfIntoImg === 'function') {
      window.roomRenderPdfIntoImg(img, path, pNum, 2.0);
    } else {
      img.src = roomPdfUrl('pdf-page', { path, page: pNum, scale: '2.0' });
    }
  }

  function scrollToRefPage(pageNum) {
    const body = document.getElementById('room-ref-body');
    const lbl = document.getElementById('room-ref-page-lbl');
    if (!body) return;
    const target = Math.min(refTotalPages, Math.max(1, Number(pageNum) || 1));
    refPage = target;
    if (lbl) lbl.textContent = `${refPage} / ${refTotalPages}`;
    const slot = body.querySelector(`.cb-ref-pdf-slot[data-ref-page="${target}"]`);
    if (slot) {
      loadRefSlot(slot, refPath);
      slot.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }

  function cleanupRefObserver() {
    if (refObserver) {
      refObserver.disconnect();
      refObserver = null;
    }
  }

  async function renderRefContent() {
    const ex = typeof window.getCurrentExam === 'function' ? window.getCurrentExam() : null;
    const ov = ensureRefOverlay();
    const body = ov.querySelector('#room-ref-body');
    const pager = ov.querySelector('#room-ref-pager');
    const titleEl = ov.querySelector('#room-ref-title');

    if (!ex) {
      cleanupRefObserver();
      refRenderedPath = '';
      pager.hidden = true;
      body.innerHTML = BUILTIN_REFS.builtin_calc_bc;
      typesetMath(body);
      return;
    }

    titleEl.textContent = (ex.subject || 'AP') + ' · Reference';
    if (ex.referenceType && BUILTIN_REFS[ex.referenceType]) {
      cleanupRefObserver();
      refRenderedPath = '';
      pager.hidden = true;
      body.innerHTML = BUILTIN_REFS[ex.referenceType];
      typesetMath(body);
      return;
    }

    if (ex.referencePdf) {
      if (refRenderedPath === ex.referencePdf && body.querySelector('.cb-ref-pdf-list')) {
        pager.hidden = false;
        ov.querySelector('#room-ref-page-lbl').textContent = `${refPage} / ${refTotalPages}`;
        return;
      }
      cleanupRefObserver();
      refPath = ex.referencePdf;
      refRenderedPath = refPath;
      refPage = 1;
      refTotalPages = 1;
      try {
        const info = typeof window.roomGetPdfInfo === 'function'
          ? await window.roomGetPdfInfo(refPath)
          : await fetch(roomPdfUrl('pdf-info', { path: refPath })).then((r) => r.json());
        refTotalPages = Math.max(1, Number(info.pages) || 1);
      } catch (_) {}

      pager.hidden = false;
      const lbl = ov.querySelector('#room-ref-page-lbl');
      lbl.textContent = `${refPage} / ${refTotalPages}`;

      const slotsHtml = [];
      for (let p = 1; p <= refTotalPages; p++) {
        slotsHtml.push(`<figure class="cb-ref-pdf-slot" data-ref-page="${p}">
          <img alt="Reference Page ${p}" style="width:${Math.round(100 * refZoom)}%">
          <figcaption class="cb-ref-page-cap">Page ${p} / ${refTotalPages}</figcaption>
        </figure>`);
      }
      body.innerHTML = `<div class="cb-ref-pdf-list">${slotsHtml.join('')}</div>`;
      body.scrollTop = 0;

      const slots = [...body.querySelectorAll('.cb-ref-pdf-slot')];
      // Eagerly render pages 1 and 2 for zero-wait vertical scroll
      slots.slice(0, 2).forEach((s) => loadRefSlot(s, refPath));

      if ('IntersectionObserver' in window) {
        refObserver = new IntersectionObserver((entries) => {
          entries.forEach((entry) => {
            if (entry.isIntersecting) {
              loadRefSlot(entry.target, refPath);
            }
          });
        }, { root: body, rootMargin: '600px 0px', threshold: 0.01 });
        slots.forEach((s) => refObserver.observe(s));
      } else {
        slots.forEach((s) => loadRefSlot(s, refPath));
      }

      if (!body.dataset.scrollWired) {
        body.dataset.scrollWired = '1';
        body.addEventListener('scroll', () => {
          const curSlots = body.querySelectorAll('.cb-ref-pdf-slot');
          if (!curSlots.length) return;
          const marker = body.scrollTop + 48;
          let activePage = 1;
          for (const sl of curSlots) {
            if (sl.offsetTop <= marker) activePage = Number(sl.dataset.refPage) || activePage;
            else break;
          }
          if (activePage !== refPage) {
            refPage = activePage;
            const curLbl = document.getElementById('room-ref-page-lbl');
            if (curLbl) curLbl.textContent = `${refPage} / ${refTotalPages}`;
          }
        }, { passive: true });
      }
      return;
    }

    cleanupRefObserver();
    refRenderedPath = '';
    pager.hidden = true;
    body.innerHTML = '<div style="padding:20px;color:#64748b;">No formula sheet is required for this AP subject.</div>';
  }

  window.roomToggleRef = function (force, opts) {
    const ov = ensureRefOverlay();
    const meta = panelRegistry.ref;
    const next = typeof force === 'boolean' ? force : !refOpen;
    refOpen = next;
    if (next) {
      openManagedPanel(meta);
      renderRefContent();
      document.querySelectorAll('[data-action="room-toggle-ref"]').forEach((b) => b.classList.add('active'));
    } else {
      closeManagedPanel(meta, Boolean(opts && opts.immediate));
      document.querySelectorAll('[data-action="room-toggle-ref"]').forEach((b) => b.classList.remove('active'));
    }
  };

  window.roomCloseFloatingTools = function (opts) {
    const closeOpts = opts || { immediate: true };
    if (desmosOpen || panelRegistry.desmos?.open) window.roomToggleDesmos(false, closeOpts);
    if (refOpen || panelRegistry.ref?.open) window.roomToggleRef(false, closeOpts);
    if (typeof window.closeLightbox === 'function') window.closeLightbox();
    showDockGhost(null);
    document.body.classList.remove('room-is-dragging', 'room-is-resizing', 'room-dock-left', 'room-dock-right');
    document.documentElement.style.setProperty('--room-dock-left-w', '0px');
    document.documentElement.style.setProperty('--room-dock-right-w', '0px');
    document.querySelectorAll('dialog.room-answer-dialog, dialog.room-dialog[data-submit], dialog.highlight-note-dialog').forEach((dlg) => {
      try { if (dlg.open) dlg.close(); } catch (_) {}
      try { dlg.remove(); } catch (_) {}
    });
    document.querySelectorAll('.room-confetti-canvas').forEach((c) => c.remove());
  };

  window.roomSyncFloatingToolsForPhase = function (phase) {
    const inActiveExam = phase === 'mcq_exam' || phase === 'frq_exam';
    if (!inActiveExam) {
      window.roomCloseFloatingTools({ immediate: true });
      const hp = document.querySelector('.highlight-palette');
      if (hp) hp.remove();
      return;
    }
    document.querySelectorAll('[data-action="room-toggle-desmos"]').forEach((b) => b.classList.toggle('active', desmosOpen));
    document.querySelectorAll('[data-action="room-toggle-ref"]').forEach((b) => b.classList.toggle('active', refOpen));
    syncDockLayout();
    if (desmosOpen) resizeDesmosSafely();
  };

  // --- Global Bluebook Keyboard Shortcuts ---
  document.addEventListener('keydown', (e) => {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.key === 'Escape') {
      const lb = document.getElementById('room-lightbox');
      if (lb && !lb.hasAttribute('hidden')) { window.closeLightbox(); return; }
      if (desmosOpen) { window.roomToggleDesmos(false); return; }
      if (refOpen) { window.roomToggleRef(false); return; }
      return;
    }
    const tag = (e.target && e.target.tagName) || '';
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || e.target?.isContentEditable) return;
    if (typeof window.state === 'undefined') return;
    if (state.phase !== 'mcq_exam' && state.phase !== 'frq_exam') return;

    const ex = typeof window.getCurrentExam === 'function' ? window.getCurrentExam() : null;
    const key = e.key.toLowerCase();

    if (key === 'd' && ex && ex.calculator && ex.calculator !== 'none') {
      e.preventDefault();
      window.roomToggleDesmos();
      return;
    }
    if (key === 'r' && ex && (ex.referencePdf || ex.referenceType)) {
      e.preventDefault();
      window.roomToggleRef();
      return;
    }
    if (ex && ex.mode === 'pdf') return; // PdfExam.js has its own bubble navigation

    if (e.key === 'ArrowRight') {
      document.querySelector('[data-action="next"], [data-action="frq-next"]')?.click();
    } else if (e.key === 'ArrowLeft') {
      document.querySelector('[data-action="back"], [data-action="frq-back"]')?.click();
    } else if (key === 'm') {
      document.querySelector('[data-action="toggle-mark"], [data-action="toggle-mark-frq"]')?.click();
    } else if (state.phase === 'mcq_exam') {
      const map = { '1': 'A', '2': 'B', '3': 'C', '4': 'D', '5': 'E', 'a': 'A', 'b': 'B', 'c': 'C', 'd': 'D', 'e': 'E' };
      const letter = map[key];
      if (letter) {
        const opt = document.querySelector(`[data-action="choose"][data-letter="${letter}"]`);
        if (opt) opt.click();
      }
    }
  });
})();
