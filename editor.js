// Folio editor: pen input, tools, selection, pages, undo and autosave.
(function () {
  'use strict';
  var Store = Folio.Store, Ink = Folio.Ink, UI = Folio.UI;
  var el = UI.el, icon = UI.icon;
  var PW = Ink.PW, PH = Ink.PH;

  var COLORS = ['#16202a', '#1f5fd0', '#d3302f', '#16833f', '#e8771a', '#7a3fc4', '#f4cf28', '#ec5c9a'];
  var HIGHLIGHT = ['#ffe45c', '#8fe36f', '#6fd3f5', '#ff9ccb', '#ffb35c', '#c7a6ff'];
  var SIZES = {
    pen: [1.5, 2.5, 4, 7], pencil: [1.5, 2.5, 4, 7], highlighter: [14, 22, 32, 44],
    eraser: [10, 22, 40, 70], shape: [1.5, 2.5, 4, 7], text: [20, 28, 40, 56]
  };
  var TOOLS = [
    ['pen', 'Pen'], ['pencil', 'Pencil'], ['highlighter', 'Highlighter'], ['eraser', 'Eraser'],
    ['lasso', 'Lasso select'], ['shape', 'Shapes'], ['text', 'Text']
  ];
  var SETTINGS_KEY = 'folio.settings';
  var DEFAULTS = {
    tool: 'pen', shape: 'rect', eraserMode: 'area', fingerDraw: false, lowLatency: true,
    t: {
      pen: { color: COLORS[0], width: 2.5 }, pencil: { color: '#47525c', width: 2.5 },
      highlighter: { color: HIGHLIGHT[0], width: 22 }, eraser: { width: 22 },
      shape: { color: COLORS[0], width: 2.5 }, text: { color: COLORS[0], width: 28 }
    }
  };

  var cfg = loadSettings();
  var note = null, pages = [], views = new Map();
  var hist = [], future = [];
  var zoom = 1, baseWidth = 800;
  var act = null, touches = new Map(), gesture = null, momentum = 0;
  var lastPen = 0, seenRaw = false;
  var sel = null, textEd = null;
  var assets = {}, io = null;
  var dirty = new Set(), noteDirty = false, saveTimer = 0, zoomTimer = 0, clearTimer = 0;
  var live = null, liveCtx = null, liveOwner = null, rafPending = false;
  var stats = { type: '-', pMin: 1, pMax: 0, events: 0, coalesced: 0, frames: 0, start: 0, end: 0 };
  var dom = {};

  function loadSettings() {
    var saved = null;
    try { saved = JSON.parse(localStorage.getItem(SETTINGS_KEY)); } catch (e) { /* defaults apply */ }
    var c = JSON.parse(JSON.stringify(DEFAULTS));
    if (saved) {
      Object.keys(c).forEach(function (k) { if (k !== 't' && saved[k] !== undefined) c[k] = saved[k]; });
      if (saved.t) Object.keys(c.t).forEach(function (k) { Object.assign(c.t[k], saved.t[k]); });
    }
    return c;
  }
  function saveSettings() {
    try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(cfg)); } catch (e) { /* not essential */ }
  }

  function pageById(id) { return pages.find(function (p) { return p.id === id; }); }
  function measureCtx() {
    if (!measureCtx.c) measureCtx.c = document.createElement('canvas').getContext('2d');
    return measureCtx.c;
  }

  // ---------- Layout and rendering ----------

  function cssWidth() { return Math.round(baseWidth * zoom); }

  function layout() {
    var w = cssWidth(), h = Math.round(w * PH / PW);
    views.forEach(function (v) {
      v.el.style.width = w + 'px';
      v.el.style.height = h + 'px';
    });
    dom.pages.style.width = w + 'px';
  }

  function measureBase() {
    var old = baseWidth;
    baseWidth = Math.min(dom.scroller.clientWidth - 24, 1100);
    if (baseWidth < 200) baseWidth = old;
    return baseWidth !== old;
  }

  function ratioFor(w) {
    var dpr = window.devicePixelRatio || 1, h = w * PH / PW;
    return Math.min(dpr, Math.sqrt(16000000 / (w * h)));
  }

  function renderView(v) {
    var w = cssWidth(), r = ratioFor(w);
    var pxW = Math.round(w * r), pxH = Math.round(pxW * PH / PW);
    v.canvas.width = pxW;
    v.canvas.height = pxH;
    var ctx = v.canvas.getContext('2d');
    ctx.setTransform(pxW / PW, 0, 0, pxH / PH, 0, 0);
    paintPage(ctx, v.page);
    v.stale = false;
    loadMissingAssets(v.page);
  }

  function paintPage(ctx, page) {
    Ink.drawPaper(ctx, page.paper);
    page.items.forEach(function (it) { Ink.drawItem(ctx, it, assets); });
  }

  function refresh(page) {
    var v = views.get(page.id);
    if (!v) return;
    if (v.visible) renderView(v);
    else v.stale = true;
  }

  function renderVisible() {
    views.forEach(function (v) {
      if (v.visible && v.stale) renderView(v);
    });
  }

  function markAllStale() {
    views.forEach(function (v) { v.stale = true; });
    renderVisible();
  }

  function loadMissingAssets(page) {
    page.items.forEach(function (it) {
      if (it.type !== 'image' || assets[it.asset] !== undefined) return;
      assets[it.asset] = null;
      Store.get('assets', it.asset).then(function (a) {
        if (!a) return null;
        return createImageBitmap(a.blob).then(function (bmp) {
          assets[it.asset] = bmp;
          pages.forEach(function (p) {
            if (p.items.some(function (x) { return x.asset === it.asset; })) refresh(p);
          });
        });
      }).catch(function () { UI.toast('An image in this note could not be loaded.'); });
    });
  }

  function buildViews() {
    dom.pages.innerHTML = '';
    views.clear();
    if (io) io.disconnect();
    io = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) {
        var v = views.get(en.target.dataset.id);
        if (!v) return;
        v.visible = en.isIntersecting;
        if (v.visible && v.stale) renderView(v);
        else if (!v.visible && liveOwner !== v) {
          // Far-away pages give their memory back and redraw when scrolled to.
          v.canvas.width = 1; v.canvas.height = 1; v.stale = true;
        }
      });
    }, { root: dom.scroller, rootMargin: '700px 0px' });
    pages.forEach(function (page) {
      var canvas = el('canvas.base');
      var node = el('div.page', { 'data-id': page.id }, canvas);
      views.set(page.id, { page: page, el: node, canvas: canvas, visible: false, stale: true });
      dom.pages.appendChild(node);
      io.observe(node);
    });
    live = null; liveCtx = null; liveOwner = null;
    layout();
  }

  // ---------- Live ink layer ----------

  function prepareLive(v) {
    if (!live) {
      live = el('canvas.live');
      var opts = cfg.lowLatency ? { desynchronized: true } : {};
      liveCtx = live.getContext('2d', opts) || live.getContext('2d');
    }
    clearTimeout(clearTimer);
    if (live.parentNode !== v.el) v.el.appendChild(live);
    var pxW = v.canvas.width, pxH = v.canvas.height;
    if (live.width !== pxW || live.height !== pxH) { live.width = pxW; live.height = pxH; }
    liveCtx.setTransform(pxW / PW, 0, 0, pxH / PH, 0, 0);
    clearLive();
    liveOwner = v;
  }

  function clearLive() {
    if (!live || !liveCtx) return;
    liveCtx.save();
    liveCtx.setTransform(1, 0, 0, 1, 0, 0);
    liveCtx.clearRect(0, 0, live.width, live.height);
    liveCtx.restore();
  }

  // Keeps wet ink up until the page beneath has painted, so it does not blink.
  function clearLiveSoon() {
    requestAnimationFrame(function () {
      requestAnimationFrame(function () {
        if (!act) { clearLive(); liveOwner = null; }
      });
    });
  }

  function onFrame(fn) {
    if (rafPending) return;
    rafPending = true;
    requestAnimationFrame(function () { rafPending = false; fn(); });
  }

  // ---------- History and saving ----------

  function pushHistory(page, before) {
    hist.push({ pageId: page.id, before: before, after: page.items });
    if (hist.length > 200) hist.shift();
    future = [];
    updateUndoButtons();
    markDirty(page);
  }

  function restoreFrom(from, to, key, other) {
    var h = from.pop();
    if (!h) return;
    var page = pageById(h.pageId);
    to.push(h);
    if (!page) { restoreFrom(from, to, key, other); return; }
    clearSelection();
    page.items = h[key];
    refresh(page);
    markDirty(page);
    updateUndoButtons();
  }
  function undo() { commitText(); restoreFrom(hist, future, 'before', 'after'); }
  function redo() { commitText(); restoreFrom(future, hist, 'after', 'before'); }

  function updateUndoButtons() {
    dom.undo.disabled = !hist.length;
    dom.redo.disabled = !future.length;
  }

  function markDirty(page) {
    if (page) dirty.add(page.id);
    noteDirty = true;
    setStatus('Saving…');
    clearTimeout(saveTimer);
    saveTimer = setTimeout(flush, 500);
  }

  function setStatus(s) { dom.status.textContent = s; }

  function makeThumb() {
    var first = pages[0];
    if (!first) return null;
    var c = document.createElement('canvas');
    c.width = 360; c.height = Math.round(360 * PH / PW);
    var ctx = c.getContext('2d');
    ctx.setTransform(c.width / PW, 0, 0, c.height / PH, 0, 0);
    paintPage(ctx, first);
    return c.toDataURL('image/webp', 0.7);
  }

  function flush() {
    clearTimeout(saveTimer);
    if (!note || (!noteDirty && !dirty.size)) return Promise.resolve();
    noteDirty = false;
    var ids = Array.from(dirty);
    dirty.clear();
    var list = ids.map(pageById).filter(Boolean);
    note.updated = Date.now();
    note.pageIds = pages.map(function (p) { return p.id; });
    note.thumb = makeThumb();
    var current = note;
    return Store.putMany('pages', list).then(function () {
      return Store.put('notes', current);
    }).then(function () {
      if (note === current && !dirty.size) setStatus('Saved on this device');
    }).catch(function (err) {
      ids.forEach(function (id) { dirty.add(id); });
      noteDirty = true;
      setStatus('Not saved');
      UI.toast('Could not save: ' + (err && err.message || 'storage error'));
    });
  }

  // ---------- Pointer input ----------

  function pagePoint(e, rect) {
    return { x: (e.clientX - rect.left) / rect.width * PW, y: (e.clientY - rect.top) / rect.height * PH };
  }

  function pageViewAt(target, x, y) {
    var node = target && target.closest && target.closest('.page');
    if (!node) {
      var hit = document.elementFromPoint(x, y);
      node = hit && hit.closest && hit.closest('.page');
    }
    return node ? views.get(node.dataset.id) : null;
  }

  function isEraserButton(e) { return e.pointerType === 'pen' && (e.button === 5 || (e.buttons & 32)); }

  function onPointerDown(e) {
    var t = e.target;
    if (t.closest('.sel-bar') || t.closest('.text-editor') || t.closest('#addPage')) return;
    cancelMomentum();

    if (e.pointerType === 'touch') { onTouchDown(e); return; }

    if (e.pointerType === 'pen') {
      lastPen = performance.now();
      endGesture();
    } else if (e.button !== 0) {
      return;
    }
    startAction(e);
  }

  function startAction(e) {
    var t = e.target;
    commitTextIfOutside(t);

    if (sel && t.closest('.sel-box')) {
      e.preventDefault();
      capture(e);
      startSelectionDrag(e, !!t.closest('.sel-handle'));
      return;
    }
    if (sel) clearSelection();

    var v = pageViewAt(t, e.clientX, e.clientY);
    if (!v) return;
    if (v.stale) renderView(v);
    e.preventDefault();
    capture(e);

    var tool = isEraserButton(e) ? 'eraser' : cfg.tool;
    var rect = v.el.getBoundingClientRect();
    var p = pagePoint(e, rect);
    var base = { pointerId: e.pointerId, pointerType: e.pointerType, v: v, rect: rect, before: v.page.items };

    if (tool === 'pen' || tool === 'pencil' || tool === 'highlighter') {
      prepareLive(v);
      live.classList.toggle('multiply', tool === 'highlighter');
      var opts = cfg.t[tool];
      act = Object.assign(base, {
        kind: 'ink', drawn: 1, smoothP: null,
        item: { id: Ink.uid(), type: 'stroke', tool: tool, color: opts.color, width: opts.width, pts: [] }
      });
      resetStats(e);
      addInkPoint(e, rect);
      paintLive();
    } else if (tool === 'eraser') {
      prepareLive(v);
      live.classList.remove('multiply');
      act = Object.assign(base, { kind: 'erase', radius: cfg.t.eraser.width / 2, last: p });
      eraseAt(p);
      drawEraserRing(p);
    } else if (tool === 'lasso') {
      prepareLive(v);
      live.classList.remove('multiply');
      act = Object.assign(base, { kind: 'lasso', poly: [p.x, p.y] });
    } else if (tool === 'shape') {
      prepareLive(v);
      live.classList.remove('multiply');
      var so = cfg.t.shape;
      act = Object.assign(base, {
        kind: 'shape',
        item: { id: Ink.uid(), type: 'shape', shape: cfg.shape, color: so.color, width: so.width, x1: p.x, y1: p.y, x2: p.x, y2: p.y }
      });
    } else if (tool === 'text') {
      // Opens on lift: Android only shows the keyboard from a completed tap.
      act = Object.assign(base, { kind: 'texttap', point: p });
    }
  }

  function capture(e) {
    try { dom.scroller.setPointerCapture(e.pointerId); } catch (err) { /* synthetic or ended pointer */ }
  }

  function resetStats(e) {
    stats = {
      type: e.pointerType, pMin: e.pressure, pMax: e.pressure, events: 1, coalesced: 1,
      start: performance.now(), end: performance.now(), frames: 0
    };
  }

  function addInkPoint(e, rect) {
    var it = act.item, x = (e.clientX - rect.left) / rect.width * PW, y = (e.clientY - rect.top) / rect.height * PH;
    var n = it.pts.length;
    if (n && Math.hypot(it.pts[n - 3] - x, it.pts[n - 2] - y) < 0.35) return;
    var raw = e.pointerType === 'pen' ? e.pressure : 0.5;
    if (e.pointerType === 'pen') {
      stats.pMin = Math.min(stats.pMin, e.pressure);
      stats.pMax = Math.max(stats.pMax, e.pressure);
    }
    act.smoothP = act.smoothP === null ? raw : act.smoothP * 0.55 + raw * 0.45;
    it.pts.push(+x.toFixed(2), +y.toFixed(2), +act.smoothP.toFixed(3));
  }

  function paintLive() {
    var it = act.item;
    if (it.tool === 'highlighter') {
      onFrame(function () {
        if (!act || act.item !== it) return;
        clearLive();
        Ink.drawHighlighter(liveCtx, it);
      });
    } else {
      var n = it.pts.length / 3;
      if (n === 1) { Ink.drawInk(liveCtx, it, 1); }
      else if (n > act.drawn) { Ink.drawInk(liveCtx, it, act.drawn); act.drawn = n; }
    }
  }

  function onPointerMove(e) {
    if (e.pointerType === 'pen') lastPen = performance.now();
    if (e.type === 'pointerrawupdate') seenRaw = true;
    else if (seenRaw && act && act.kind === 'ink') return;

    if (e.pointerType === 'touch' && touches.has(e.pointerId) && !(act && act.pointerId === e.pointerId)) {
      if (e.type === 'pointermove') onTouchMove(e);
      return;
    }
    if (!act || e.pointerId !== act.pointerId) return;

    var list = e.getCoalescedEvents ? e.getCoalescedEvents() : [];
    if (!list.length) list = [e];

    if (act.kind === 'ink') {
      stats.events++;
      stats.coalesced += list.length;
      stats.end = performance.now();
      for (var i = 0; i < list.length; i++) addInkPoint(list[i], act.rect);
      paintLive();
    } else if (act.kind === 'erase') {
      list.forEach(function (ev) {
        var p = pagePoint(ev, act.rect);
        var steps = Math.max(1, Math.ceil(Math.hypot(p.x - act.last.x, p.y - act.last.y) / (act.radius / 2)));
        for (var s = 1; s <= steps; s++) {
          eraseAt({ x: act.last.x + (p.x - act.last.x) * s / steps, y: act.last.y + (p.y - act.last.y) * s / steps });
        }
        act.last = p;
      });
      var ring = act.last;
      onFrame(function () {
        if (!act || act.kind !== 'erase') return;
        renderView(act.v);
        drawEraserRing(ring);
      });
    } else if (act.kind === 'lasso') {
      var q = pagePoint(e, act.rect);
      act.poly.push(q.x, q.y);
      onFrame(drawLassoLive);
    } else if (act.kind === 'shape') {
      var r = pagePoint(e, act.rect);
      act.item.x2 = r.x; act.item.y2 = r.y;
      onFrame(function () {
        if (!act || act.kind !== 'shape') return;
        clearLive();
        Ink.drawShape(liveCtx, act.item);
      });
    } else if (act.kind === 'seldrag') {
      moveSelectionDrag(e);
    }
  }

  function drawEraserRing(p) {
    clearLive();
    liveCtx.save();
    liveCtx.strokeStyle = 'rgba(40,50,60,.55)';
    liveCtx.lineWidth = 1.5;
    liveCtx.beginPath();
    liveCtx.arc(p.x, p.y, act.radius, 0, Math.PI * 2);
    liveCtx.stroke();
    liveCtx.restore();
  }

  function drawLassoLive() {
    if (!act || act.kind !== 'lasso') return;
    clearLive();
    liveCtx.save();
    liveCtx.strokeStyle = '#1f5c4d';
    liveCtx.lineWidth = 2;
    liveCtx.setLineDash([8, 7]);
    liveCtx.beginPath();
    liveCtx.moveTo(act.poly[0], act.poly[1]);
    for (var i = 2; i < act.poly.length; i += 2) liveCtx.lineTo(act.poly[i], act.poly[i + 1]);
    liveCtx.closePath();
    liveCtx.stroke();
    liveCtx.restore();
  }

  function eraseAt(p) {
    var page = act.v.page, r = act.radius, area = cfg.eraserMode === 'area', changed = false, out = [];
    page.items.forEach(function (it) {
      if (it.type === 'stroke') {
        if (!Ink.hitsStroke(it, p.x, p.y, r)) { out.push(it); return; }
        changed = true;
        if (area) Array.prototype.push.apply(out, Ink.splitStroke(it, p.x, p.y, r));
      } else if (it.type === 'shape') {
        if (Ink.hitsShape(it, p.x, p.y, r)) changed = true; else out.push(it);
      } else if (!area && Ink.insideBox(it, p.x, p.y)) {
        changed = true; // Text and images only go with the whole-item eraser, never by accident.
      } else {
        out.push(it);
      }
    });
    if (changed) page.items = out;
  }

  function onPointerUp(e) {
    if (e.pointerType === 'touch' && touches.has(e.pointerId) && !(act && act.pointerId === e.pointerId)) {
      onTouchUp(e);
      return;
    }
    if (e.pointerType === 'touch') touches.delete(e.pointerId);
    if (!act || e.pointerId !== act.pointerId) return;
    finishAction();
  }

  function finishAction() {
    var a = act;
    act = null;
    var page = a.v.page;
    if (a.kind === 'ink') {
      if (!a.item.pts.length) { clearLiveSoon(); return; }
      page.items = a.before.concat([a.item]);
      var ctx = a.v.canvas.getContext('2d');
      Ink.drawItem(ctx, a.item, assets);
      clearLiveSoon();
      pushHistory(page, a.before);
      requestPersist();
    } else if (a.kind === 'erase') {
      renderView(a.v);
      clearLive();
      if (page.items !== a.before) pushHistory(page, a.before);
    } else if (a.kind === 'lasso') {
      clearLive();
      selectByLasso(a.v, a.poly);
    } else if (a.kind === 'shape') {
      clearLiveSoon();
      var it = a.item;
      if (Math.hypot(it.x2 - it.x1, it.y2 - it.y1) < 4) return;
      page.items = a.before.concat([it]);
      Ink.drawItem(a.v.canvas.getContext('2d'), it, assets);
      pushHistory(page, a.before);
    } else if (a.kind === 'seldrag') {
      if (page.items !== a.before) pushHistory(page, a.before);
    } else if (a.kind === 'texttap') {
      openTextAt(a.v, a.point);
    }
  }

  function requestPersist() {
    if (requestPersist.done) return;
    requestPersist.done = true;
    if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(function () {});
  }

  // ---------- Fingers: pan, pinch, palm rejection ----------

  function onTouchDown(e) {
    if (performance.now() - lastPen < 500 || (act && act.pointerType === 'pen')) return; // Resting palm.
    e.preventDefault(); // Stops the follow-up mouse events, which would close an open text box.
    touches.set(e.pointerId, { x: e.clientX, y: e.clientY, t0: performance.now(), x0: e.clientX, y0: e.clientY, target: e.target });
    capture(e);

    if (touches.size === 2) {
      if (act && act.pointerType === 'touch') abortAction();
      startPinch();
      return;
    }
    if (touches.size !== 1) return;

    if (sel && e.target.closest('.sel-box')) { startAction(e); return; }
    if (cfg.fingerDraw && cfg.tool !== 'text') { startAction(e); return; }
    gesture = { kind: 'pan', vx: 0, vy: 0, lastT: performance.now() };
  }

  function abortAction() {
    if (act.kind === 'erase' || act.kind === 'seldrag') {
      act.v.page.items = act.before;
      refresh(act.v.page);
    }
    clearLive();
    touches.delete(act.pointerId);
    act = null;
  }

  function startPinch() {
    var pts = Array.from(touches.values());
    gesture = {
      kind: 'pinch', startZoom: zoom,
      d0: Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y) || 1,
      mx: (pts[0].x + pts[1].x) / 2, my: (pts[0].y + pts[1].y) / 2
    };
  }

  function onTouchMove(e) {
    var tp = touches.get(e.pointerId);
    if (!gesture) { tp.x = e.clientX; tp.y = e.clientY; return; }
    var dx = e.clientX - tp.x, dy = e.clientY - tp.y;
    tp.x = e.clientX; tp.y = e.clientY;
    if (gesture.kind === 'pan') {
      dom.scroller.scrollLeft -= dx;
      dom.scroller.scrollTop -= dy;
      var now = performance.now(), dt = Math.max(1, now - gesture.lastT);
      gesture.vx = gesture.vx * 0.7 + (dx / dt) * 0.3;
      gesture.vy = gesture.vy * 0.7 + (dy / dt) * 0.3;
      gesture.lastT = now;
    } else if (gesture.kind === 'pinch' && touches.size >= 2) {
      var pts = Array.from(touches.values());
      var d = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
      var mx = (pts[0].x + pts[1].x) / 2, my = (pts[0].y + pts[1].y) / 2;
      setZoom(gesture.startZoom * d / gesture.d0, mx, my);
      dom.scroller.scrollLeft -= mx - gesture.mx;
      dom.scroller.scrollTop -= my - gesture.my;
      gesture.mx = mx; gesture.my = my;
    }
  }

  function onTouchUp(e) {
    var tp = touches.get(e.pointerId);
    touches.delete(e.pointerId);
    var was = gesture;
    if (e.type === 'pointerup' && was && was.kind === 'pan' && touches.size === 0 && tp) {
      var moved = Math.hypot(tp.x - tp.x0, tp.y - tp.y0);
      if (moved < 10 && performance.now() - tp.t0 < 350) {
        onTap(e);
      } else if (performance.now() - was.lastT < 60) {
        startMomentum(was.vx, was.vy);
      }
    }
    if (touches.size === 1 && was && was.kind === 'pinch') {
      gesture = { kind: 'pan', vx: 0, vy: 0, lastT: performance.now() };
    } else if (touches.size === 0) {
      gesture = null;
    }
  }

  function onTap(e) {
    if (cfg.tool !== 'text') {
      if (sel) clearSelection();
      return;
    }
    var v = pageViewAt(document.elementFromPoint(e.clientX, e.clientY), e.clientX, e.clientY);
    if (!v) return;
    commitText();
    if (v.stale) renderView(v);
    openTextAt(v, pagePoint(e, v.el.getBoundingClientRect()));
  }

  function endGesture() {
    touches.clear();
    gesture = null;
  }

  function startMomentum(vx, vy) {
    cancelMomentum();
    var last = performance.now();
    function step(now) {
      var dt = now - last; last = now;
      dom.scroller.scrollLeft -= vx * dt;
      dom.scroller.scrollTop -= vy * dt;
      var decay = Math.pow(0.996, dt);
      vx *= decay; vy *= decay;
      if (Math.abs(vx) + Math.abs(vy) > 0.02) momentum = requestAnimationFrame(step);
    }
    momentum = requestAnimationFrame(step);
  }
  function cancelMomentum() { cancelAnimationFrame(momentum); }

  function setZoom(z, fx, fy) {
    commitText();
    z = Math.max(0.5, Math.min(4, z));
    if (z === zoom) return;
    var box = dom.scroller.getBoundingClientRect();
    var mx = (fx === undefined ? box.width / 2 : fx - box.left);
    var my = (fy === undefined ? box.height / 2 : fy - box.top);
    var ratio = z / zoom;
    var sl = dom.scroller.scrollLeft, st = dom.scroller.scrollTop;
    zoom = z;
    layout();
    dom.scroller.scrollLeft = (sl + mx) * ratio - mx;
    dom.scroller.scrollTop = (st + my) * ratio - my;
    dom.zoomLabel.textContent = Math.round(zoom * 100) + '%';
    dom.zoomLabel.hidden = Math.abs(zoom - 1) < 0.02;
    clearTimeout(zoomTimer);
    zoomTimer = setTimeout(markAllStale, 140);
  }

  // ---------- Lasso selection ----------

  function selectByLasso(v, poly) {
    if (poly.length < 6) return;
    var ids = new Set();
    v.page.items.forEach(function (it) { if (Ink.insideLasso(it, poly)) ids.add(it.id); });
    if (ids.size) setSelection(v, ids);
    clearLive();
  }

  function selectedItems() {
    if (!sel) return [];
    return sel.v.page.items.filter(function (it) { return sel.ids.has(it.id); });
  }

  function setSelection(v, ids) {
    clearSelection();
    var bar = el('div.sel-bar', null,
      barButton('copy', 'Duplicate', duplicateSelection),
      barButton('trash', 'Delete', deleteSelection));
    var handle = el('div.sel-handle', { title: 'Drag to resize' });
    var box = el('div.sel-box', null, bar, handle);
    v.el.appendChild(box);
    sel = { v: v, ids: ids, box: box };
    positionSelection();
  }

  function barButton(ic, label, fn) {
    return el('button', { type: 'button', title: label, 'aria-label': label, html: icon(ic), on: { click: fn } });
  }

  function positionSelection() {
    if (!sel) return;
    var r = Ink.unionBox(selectedItems(), measureCtx());
    if (!r) { clearSelection(); return; }
    var s = sel.box.style;
    s.left = (r.x / PW * 100) + '%';
    s.top = (r.y / PH * 100) + '%';
    s.width = (r.w / PW * 100) + '%';
    s.height = (r.h / PH * 100) + '%';
    sel.box.classList.toggle('bar-below', r.y < 70);
    sel.rect = r;
  }

  function clearSelection() {
    if (!sel) return;
    sel.box.remove();
    sel = null;
  }

  function startSelectionDrag(e, resizing) {
    var v = sel.v, rect = v.el.getBoundingClientRect();
    act = {
      kind: 'seldrag', pointerId: e.pointerId, pointerType: e.pointerType, v: v, rect: rect,
      before: v.page.items, start: pagePoint(e, rect), resizing: resizing, box: sel.rect
    };
  }

  function moveSelectionDrag(e) {
    var p = pagePoint(e, act.rect), a = act, dx = 0, dy = 0, s = 1;
    if (a.resizing) {
      s = Math.max(0.1, Math.max((p.x - a.box.x) / a.box.w, (p.y - a.box.y) / a.box.h));
    } else {
      dx = p.x - a.start.x; dy = p.y - a.start.y;
    }
    a.v.page.items = a.before.map(function (it) {
      return sel.ids.has(it.id) ? Ink.transform(it, dx, dy, s, a.box.x, a.box.y) : it;
    });
    onFrame(function () {
      if (!sel) return;
      refresh(a.v.page);
      positionSelection();
    });
  }

  function deleteSelection() {
    if (!sel) return;
    var page = sel.v.page, before = page.items, ids = sel.ids;
    page.items = before.filter(function (it) { return !ids.has(it.id); });
    clearSelection();
    refresh(page);
    pushHistory(page, before);
  }

  function duplicateSelection() {
    if (!sel) return;
    var v = sel.v, page = v.page, before = page.items;
    var copies = selectedItems().map(function (it) {
      return Object.assign(Ink.transform(it, 26, 26, 1, 0, 0), { id: Ink.uid() });
    });
    page.items = before.concat(copies);
    refresh(page);
    pushHistory(page, before);
    setSelection(v, new Set(copies.map(function (c) { return c.id; })));
  }

  function recolorSelection(color) {
    var page = sel.v.page, before = page.items;
    page.items = before.map(function (it) {
      return sel.ids.has(it.id) && it.type !== 'image' ? Object.assign({}, it, { color: color }) : it;
    });
    refresh(page);
    pushHistory(page, before);
  }

  // ---------- Text ----------

  function openTextAt(v, p) {
    var existing = null;
    for (var i = v.page.items.length - 1; i >= 0; i--) {
      var it = v.page.items[i];
      if (it.type === 'text') {
        var r = Ink.bbox(it, measureCtx());
        if (p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h) { existing = it; break; }
      }
    }
    var opts = cfg.t.text;
    var item = existing || {
      id: Ink.uid(), type: 'text', text: '', x: p.x, y: p.y - opts.width * 0.7,
      w: Math.min(620, PW - p.x - 24), size: opts.width, color: opts.color
    };
    if (item.w < 120) { item = Object.assign({}, item, { x: PW - 144, w: 120 }); }
    var ta = el('textarea.text-editor', { 'aria-label': 'Text', spellcheck: 'true' });
    ta.value = item.text;
    var s = ta.style;
    s.left = (item.x / PW * 100) + '%';
    s.top = (item.y / PH * 100) + '%';
    s.width = (item.w / PW * 100) + '%';
    s.font = (item.size * cssWidth() / PW) + 'px/' + Ink.LINE + ' ' + Ink.FONT;
    s.color = item.color;
    function grow() {
      ta.style.height = 'auto';
      ta.style.height = (ta.scrollHeight + 2) + 'px';
    }
    ta.addEventListener('input', grow);
    ta.addEventListener('blur', function () { setTimeout(commitText, 0); });
    v.el.appendChild(ta);
    textEd = { v: v, ta: ta, item: item, existing: existing };
    if (existing) {
      // Hide the original while it is edited in the box.
      var hidden = v.page.items;
      v.page.items = hidden.filter(function (x) { return x !== existing; });
      textEd.before = hidden;
      refresh(v.page);
    } else {
      textEd.before = v.page.items;
    }
    grow();
    ta.focus();
  }

  function commitTextIfOutside(target) {
    if (textEd && target !== textEd.ta) commitText();
  }

  function commitText() {
    if (!textEd) return;
    var ed = textEd;
    textEd = null;
    var value = ed.ta.value.replace(/\s+$/, '');
    ed.ta.remove();
    var page = ed.v.page, before = ed.before;
    if (ed.existing && value === ed.existing.text) {
      page.items = before;
      refresh(page);
      return;
    }
    if (!value && !ed.existing) return;
    page.items = value
      ? (ed.existing
        ? before.map(function (x) { return x === ed.existing ? Object.assign({}, ed.item, { text: value }) : x; })
        : before.concat([Object.assign({}, ed.item, { text: value })]))
      : before.filter(function (x) { return x !== ed.existing; });
    refresh(page);
    pushHistory(page, before);
  }

  // ---------- Images ----------

  function currentPage() {
    var mid = dom.scroller.getBoundingClientRect();
    var c = mid.top + mid.height / 2, best = null, dist = Infinity;
    views.forEach(function (v) {
      var r = v.el.getBoundingClientRect();
      var d = Math.abs((r.top + r.bottom) / 2 - c);
      if (d < dist) { dist = d; best = v; }
    });
    return best;
  }

  function addImageBlob(blob) {
    return createImageBitmap(blob).then(function (bmp) {
      var scale = Math.min(1, 1600 / Math.max(bmp.width, bmp.height));
      var c = document.createElement('canvas');
      c.width = Math.round(bmp.width * scale);
      c.height = Math.round(bmp.height * scale);
      c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
      return new Promise(function (resolve) { c.toBlob(resolve, 'image/webp', 0.85); }).then(function (small) {
        var id = Ink.uid();
        return Store.put('assets', { id: id, blob: small || blob }).then(function () {
          assets[id] = c;
          var v = currentPage();
          if (!v) return;
          var w = Math.min(600, c.width), h = w * c.height / c.width;
          if (h > 800) { w = w * 800 / h; h = 800; }
          var before = v.page.items;
          var item = { id: Ink.uid(), type: 'image', asset: id, x: (PW - w) / 2, y: 120, w: w, h: h };
          v.page.items = before.concat([item]);
          if (v.stale) renderView(v); else refresh(v.page);
          pushHistory(v.page, before);
          setTool('lasso');
          setSelection(v, new Set([item.id]));
          requestPersist();
        });
      });
    }).catch(function () { UI.toast('That image could not be added.'); });
  }

  function pickImage() {
    var input = el('input', { type: 'file', accept: 'image/*', multiple: true });
    input.addEventListener('change', function () {
      Array.from(input.files).reduce(function (chain, f) {
        return chain.then(function () { return addImageBlob(f); });
      }, Promise.resolve());
    });
    input.click();
  }

  function onPaste(e) {
    if (!note || textEd) return;
    var items = e.clipboardData ? Array.from(e.clipboardData.items) : [];
    var img = items.find(function (i) { return i.type.indexOf('image/') === 0; });
    if (img) {
      e.preventDefault();
      addImageBlob(img.getAsFile());
    }
  }

  function onDrop(e) {
    if (!note) return;
    e.preventDefault();
    var files = e.dataTransfer ? Array.from(e.dataTransfer.files) : [];
    var image = files.find(function (f) { return f.type.indexOf('image/') === 0; });
    if (image) { addImageBlob(image); return; }
    var url = e.dataTransfer && e.dataTransfer.getData('text/uri-list');
    if (url) {
      fetch(url).then(function (r) { return r.blob(); }).then(addImageBlob).catch(function () {
        UI.toast('That site blocked the image. Save it first, then use Insert image.');
      });
    }
  }

  // ---------- Toolbar ----------

  function setTool(name) {
    commitText();
    if (name !== 'lasso') clearSelection();
    cfg.tool = name;
    saveSettings();
    buildToolbar();
    dom.scroller.dataset.tool = name;
  }

  function buildToolbar() {
    var bar = dom.tools;
    bar.innerHTML = '';
    var tools = el('div.tool-group');
    TOOLS.forEach(function (t) {
      tools.appendChild(el('button.tool' + (cfg.tool === t[0] ? '.on' : ''), {
        type: 'button', title: t[1], 'aria-label': t[1], 'aria-pressed': String(cfg.tool === t[0]),
        'data-tool': t[0], html: icon(t[0]), on: { click: function () { setTool(t[0]); } }
      }));
    });
    bar.appendChild(tools);

    var tool = cfg.tool;
    if (tool === 'shape') {
      var shapes = el('div.tool-group');
      [['rect', 'Rectangle'], ['ellipse', 'Circle'], ['line', 'Line'], ['arrow', 'Arrow']].forEach(function (s) {
        shapes.appendChild(el('button.tool' + (cfg.shape === s[0] ? '.on' : ''), {
          type: 'button', title: s[1], 'aria-label': s[1], html: icon(s[0]),
          on: { click: function () { cfg.shape = s[0]; saveSettings(); buildToolbar(); } }
        }));
      });
      bar.appendChild(shapes);
    }
    if (tool === 'eraser') {
      var modes = el('div.tool-group');
      [['area', 'Erase area'], ['item', 'Erase whole item']].forEach(function (m) {
        modes.appendChild(el('button.mode' + (cfg.eraserMode === m[0] ? '.on' : ''), {
          type: 'button', text: m[1],
          on: { click: function () { cfg.eraserMode = m[0]; saveSettings(); buildToolbar(); } }
        }));
      });
      bar.appendChild(modes);
    }

    if (tool !== 'eraser') {
      var opts = cfg.t[tool] || { color: COLORS[0] };
      var palette = tool === 'highlighter' ? HIGHLIGHT : COLORS;
      var colors = el('div.tool-group.colors');
      palette.forEach(function (c) {
        colors.appendChild(el('button.swatch' + (opts.color === c ? '.on' : ''), {
          type: 'button', 'aria-label': 'Colour ' + c, style: 'background:' + c,
          on: {
            click: function () {
              if (cfg.t[tool]) { opts.color = c; saveSettings(); }
              if (sel) recolorSelection(c);
              buildToolbar();
            }
          }
        }));
      });
      var custom = el('input.custom-color', { type: 'color', 'aria-label': 'Custom colour', title: 'Custom colour', value: opts.color || COLORS[0] });
      custom.addEventListener('change', function () {
        if (cfg.t[tool]) { opts.color = custom.value; saveSettings(); }
        if (sel) recolorSelection(custom.value);
        buildToolbar();
      });
      colors.appendChild(custom);
      bar.appendChild(colors);
    }

    if (SIZES[tool]) {
      var sizes = el('div.tool-group');
      SIZES[tool].forEach(function (s, i) {
        var dot = 4 + i * 4;
        sizes.appendChild(el('button.size' + (cfg.t[tool].width === s ? '.on' : ''), {
          type: 'button', 'aria-label': 'Size ' + (i + 1),
          on: { click: function () { cfg.t[tool].width = s; saveSettings(); buildToolbar(); } }
        }, el('span', { style: 'width:' + dot + 'px;height:' + dot + 'px' })));
      });
      bar.appendChild(sizes);
    }
  }

  // ---------- Pages ----------

  function newPage(paper) {
    return { id: Ink.uid(), noteId: note.id, paper: paper, items: [] };
  }

  function rebuildPages(scrollToId) {
    commitText();
    clearSelection();
    buildViews();
    if (scrollToId) {
      var v = views.get(scrollToId);
      if (v) dom.scroller.scrollTop = v.el.offsetTop - 72;
    }
    markDirty();
  }

  function addPage(afterIndex) {
    var ref = pages[pages.length - 1];
    var page = newPage(ref ? ref.paper : 'lined');
    var at = afterIndex === undefined ? pages.length : afterIndex + 1;
    pages.splice(at, 0, page);
    dirty.add(page.id);
    rebuildPages(page.id);
  }

  function duplicatePage(i) {
    var src = pages[i];
    var page = newPage(src.paper);
    page.items = src.items.map(function (it) { return Object.assign({}, it, { id: Ink.uid() }); });
    pages.splice(i + 1, 0, page);
    dirty.add(page.id);
    rebuildPages(page.id);
  }

  function deletePage(i) {
    if (pages.length === 1) { UI.toast('A note needs at least one page.'); return Promise.resolve(); }
    return UI.confirm('Delete page ' + (i + 1) + '?', 'You can\'t undo this.', 'Delete page', true).then(function (ok) {
      if (!ok) return;
      var gone = pages.splice(i, 1)[0];
      hist = hist.filter(function (h) { return h.pageId !== gone.id; });
      future = future.filter(function (h) { return h.pageId !== gone.id; });
      updateUndoButtons();
      dirty.delete(gone.id);
      return Store.del('pages', gone.id).then(function () { rebuildPages(); });
    });
  }

  function movePage(i, delta) {
    var j = i + delta;
    if (j < 0 || j >= pages.length) return;
    var p = pages.splice(i, 1)[0];
    pages.splice(j, 0, p);
    rebuildPages();
  }

  function pagePanel() {
    return UI.showDialog(function (dlg, done) {
      var list = el('div.page-list');
      function thumb(page) {
        var c = el('canvas');
        c.width = 180; c.height = Math.round(180 * PH / PW);
        var ctx = c.getContext('2d');
        ctx.setTransform(c.width / PW, 0, 0, c.height / PH, 0, 0);
        paintPage(ctx, page);
        return c;
      }
      function draw() {
        list.innerHTML = '';
        pages.forEach(function (page, i) {
          list.appendChild(el('div.page-row', null,
            el('button.page-thumb', {
              type: 'button', 'aria-label': 'Go to page ' + (i + 1),
              on: {
                click: function () {
                  var v = views.get(page.id);
                  dom.scroller.scrollTop = v.el.offsetTop - 72;
                  done(null);
                }
              }
            }, thumb(page)),
            el('div.page-meta', null,
              el('strong', { text: 'Page ' + (i + 1) }),
              el('div.page-actions', null,
                rowButton('up', 'Move up', i === 0, function () { movePage(i, -1); draw(); }),
                rowButton('down', 'Move down', i === pages.length - 1, function () { movePage(i, 1); draw(); }),
                rowButton('copy', 'Duplicate', false, function () { duplicatePage(i); draw(); }),
                rowButton('trash', 'Delete', pages.length === 1, function () {
                  dlg.close();
                  deletePage(i).then(function () { dlg.showModal(); draw(); });
                })))
          ));
        });
      }
      draw();
      dlg.appendChild(el('div.dlg-body.page-panel', null,
        el('div.dlg-head', null,
          el('h2', { text: 'Pages' }),
          el('button.btn.primary', { type: 'button', text: 'Add page', on: { click: function () { addPage(); draw(); } } }),
          el('button.btn', { type: 'button', text: 'Done', on: { click: function () { done(null); } } })),
        list));
    });
  }

  function rowButton(ic, label, disabled, fn) {
    return el('button.icon-btn', {
      type: 'button', title: label, 'aria-label': label, disabled: disabled, html: icon(ic), on: { click: fn }
    });
  }

  function setPaper(scope, paper) {
    var v = currentPage();
    (scope === 'all' ? pages : [v.page]).forEach(function (p) {
      p.paper = paper;
      refresh(p);
      markDirty(p);
    });
    if (scope === 'all') { note.paper = paper; }
  }

  function moreMenu() {
    var page = currentPage().page;
    UI.sheet('Note options', [
      { label: 'Insert image', icon: 'image', value: 'image' },
      { heading: 'Paper for this page' },
      { label: 'Lined', value: 'p:lined', checked: page.paper === 'lined' },
      { label: 'Grid', value: 'p:grid', checked: page.paper === 'grid' },
      { label: 'Dotted', value: 'p:dots', checked: page.paper === 'dots' },
      { label: 'Blank', value: 'p:blank', checked: page.paper === 'blank' },
      { label: 'Use this paper on every page', value: 'all' },
      { heading: 'Pen' },
      { label: 'Draw with finger', hint: cfg.fingerDraw ? 'On' : 'Off', value: 'finger' },
      { label: 'Low-latency ink', hint: cfg.lowLatency ? 'On' : 'Off', value: 'latency' },
      { label: 'Pen check', hint: 'After you write a stroke', value: 'check' }
    ]).then(function (v) {
      if (!v) return;
      if (v === 'image') pickImage();
      else if (v.indexOf('p:') === 0) setPaper('page', v.slice(2));
      else if (v === 'all') setPaper('all', page.paper);
      else if (v === 'finger') {
        cfg.fingerDraw = !cfg.fingerDraw;
        saveSettings();
        UI.toast(cfg.fingerDraw ? 'One finger draws. Use two fingers to move the page.' : 'Fingers move the page. Only the pen draws.');
      } else if (v === 'latency') {
        cfg.lowLatency = !cfg.lowLatency;
        saveSettings();
        if (live) { live.remove(); live = null; liveCtx = null; }
        UI.toast('Low-latency ink is ' + (cfg.lowLatency ? 'on' : 'off') + '.');
      } else if (v === 'check') penCheck();
    });
  }

  function penCheck() {
    var secs = Math.max(0.001, (stats.end - stats.start) / 1000);
    var hasStroke = stats.type !== '-';
    var low = false;
    if (liveCtx && liveCtx.getContextAttributes) {
      var at = liveCtx.getContextAttributes();
      low = !!(at && at.desynchronized);
    }
    var rows = [
      ['Input from last stroke', hasStroke ? stats.type : 'No stroke yet'],
      ['Pressure range', stats.type === 'pen' ? stats.pMin.toFixed(2) + ' to ' + stats.pMax.toFixed(2) : 'Not a pen stroke'],
      ['Pen samples per second', hasStroke ? String(Math.round(stats.coalesced / secs)) : '-'],
      ['Screen updates per second', hasStroke ? String(Math.round(stats.events / secs)) : '-'],
      ['Low-latency canvas', low ? 'Active' : 'Not active'],
      ['Fast input events', 'onpointerrawupdate' in window ? 'Available' : 'Not available']
    ];
    UI.showDialog(function (dlg, done) {
      var table = el('div.check');
      rows.forEach(function (r) {
        table.appendChild(el('div.check-row', null, el('span', { text: r[0] }), el('strong', { text: r[1] })));
      });
      dlg.appendChild(el('div.dlg-body', null,
        el('h2', { text: 'Pen check' }),
        el('p', { text: 'Write a long, quick stroke on the page, then open this. A pressure range that changes as you press harder means pressure is working.' }),
        table,
        el('div.dlg-actions', null, el('button.btn.primary', { type: 'button', text: 'Close', on: { click: function () { done(null); } } }))));
    });
  }

  // ---------- Open and close ----------

  function bindOnce() {
    if (dom.bound) return;
    dom.bound = true;
    dom.scroller = document.getElementById('scroller');
    dom.pages = document.getElementById('pages');
    dom.tools = document.getElementById('tools');
    dom.undo = document.getElementById('undo');
    dom.redo = document.getElementById('redo');
    dom.status = document.getElementById('status');
    dom.title = document.getElementById('noteTitle');
    dom.zoomLabel = document.getElementById('zoomLabel');

    document.getElementById('back').innerHTML = icon('back');
    dom.undo.innerHTML = icon('undo');
    dom.redo.innerHTML = icon('redo');
    document.getElementById('pagesBtn').innerHTML = icon('pages');
    document.getElementById('moreBtn').innerHTML = icon('more');
    document.getElementById('addPage').innerHTML = icon('plus') + '<span>Add page</span>';

    document.getElementById('back').addEventListener('click', function () { location.hash = note && note.folderId ? '#/f/' + note.folderId : '#/'; });
    dom.undo.addEventListener('click', undo);
    dom.redo.addEventListener('click', redo);
    document.getElementById('pagesBtn').addEventListener('click', pagePanel);
    document.getElementById('moreBtn').addEventListener('click', moreMenu);
    document.getElementById('addPage').addEventListener('click', function () { addPage(); });
    dom.zoomLabel.addEventListener('click', function () { setZoom(1); });
    dom.title.addEventListener('input', function () {
      if (!note) return;
      note.title = dom.title.value;
      markDirty();
    });

    var s = dom.scroller;
    s.addEventListener('pointerdown', onPointerDown);
    s.addEventListener('pointermove', onPointerMove);
    if ('onpointerrawupdate' in window) s.addEventListener('pointerrawupdate', onPointerMove);
    s.addEventListener('pointerup', onPointerUp);
    s.addEventListener('pointercancel', onPointerUp);
    s.addEventListener('contextmenu', function (e) { e.preventDefault(); });
    s.addEventListener('wheel', function (e) {
      if (!e.ctrlKey) return;
      e.preventDefault();
      setZoom(zoom * (e.deltaY < 0 ? 1.1 : 0.9), e.clientX, e.clientY);
    }, { passive: false });
    s.addEventListener('dragover', function (e) { e.preventDefault(); });
    s.addEventListener('drop', onDrop);
    document.addEventListener('paste', onPaste);
    window.addEventListener('resize', function () {
      if (!note) return;
      if (measureBase()) { layout(); markAllStale(); }
    });
    document.addEventListener('visibilitychange', function () {
      if (document.visibilityState === 'hidden' && note) { commitText(); flush(); }
    });
    window.addEventListener('pagehide', function () { if (note) { commitText(); flush(); } });
    document.addEventListener('keydown', function (e) {
      if (!note || e.target.matches('input,textarea')) return;
      var mod = e.ctrlKey || e.metaKey, k = e.key.toLowerCase();
      if (mod && k === 'z' && !e.shiftKey) { e.preventDefault(); undo(); }
      else if (mod && (k === 'y' || (k === 'z' && e.shiftKey))) { e.preventDefault(); redo(); }
      else if ((k === 'delete' || k === 'backspace') && sel) { e.preventDefault(); deleteSelection(); }
    });
  }

  function open(noteId) {
    bindOnce();
    return Promise.all([Store.get('notes', noteId), Store.pagesOf(noteId)]).then(function (r) {
      if (!r[0]) return false;
      note = r[0];
      var order = note.pageIds || [];
      pages = r[1].slice().sort(function (a, b) { return order.indexOf(a.id) - order.indexOf(b.id); });
      if (!pages.length) {
        pages = [newPage(note.paper || 'lined')];
        dirty.add(pages[0].id);
      }
      hist = []; future = []; sel = null; textEd = null; act = null; zoom = 1;
      touches.clear(); gesture = null;
      dom.title.value = note.title || '';
      dom.zoomLabel.hidden = true;
      setStatus('Saved on this device');
      updateUndoButtons();
      buildToolbar();
      dom.scroller.dataset.tool = cfg.tool;
      measureBase();
      buildViews();
      dom.scroller.scrollTop = 0;
      return true;
    });
  }

  function close() {
    if (!note) return Promise.resolve();
    commitText();
    clearSelection();
    cancelMomentum();
    var done = flush();
    note = null;
    pages = [];
    views.clear();
    if (io) io.disconnect();
    if (dom.pages) dom.pages.innerHTML = '';
    return done;
  }

  window.Folio = window.Folio || {};
  window.Folio.Editor = { open: open, close: close };
})();
