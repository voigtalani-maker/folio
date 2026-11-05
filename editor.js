// Folio editor: pen input, tools, selection, pages, undo and autosave.
(function () {
  'use strict';
  var Store = Folio.Store, Ink = Folio.Ink, UI = Folio.UI;
  var el = UI.el, icon = UI.icon;
  var PW = Ink.PW, PH = Ink.PH;

  // Black, walnut, dusty blue, sage, mustard, terracotta, dusty rose, plum.
  var COLORS = ['#111111', '#6b4630', '#5b8fb0', '#7f9a76', '#c9a24b', '#c46f4a', '#c0737a', '#8a6a94'];
  var HIGHLIGHT = ['#f2d675', '#a9d08e', '#8fc7e8', '#f0a6b5', '#f4b183', '#bfa3e0'];
  var OLD_DEFAULTS = { '#16202a': COLORS[0], '#47525c': COLORS[0], '#ffe45c': HIGHLIGHT[0] };
  // Smallest and largest size per tool. The slider can land on anything in between.
  var RANGES = {
    pen: [0.5, 40], fountain: [0.5, 40], brush: [0.5, 40], pencil: [0.5, 40], highlighter: [6, 120], eraser: [6, 200], shape: [0.5, 40], text: [12, 120]
  };
  var TOOLS = [
    ['pen', 'Pen'], ['fountain', 'Fountain pen'], ['brush', 'Brush'], ['pencil', 'Pencil'],
    ['highlighter', 'Highlighter'], ['eraser', 'Eraser'],
    ['lasso', 'Lasso select'], ['shape', 'Shapes'], ['text', 'Text']
  ];
  var SETTINGS_KEY = 'folio.settings';
  var DEFAULTS = {
    tool: 'pen', shape: 'rect', eraserMode: 'area', fingerDraw: false, lowLatency: true, dock: null, recent: [],
    shapeFix: false, toolOrder: null, toolHidden: [],
    t: {
      pen: { color: COLORS[0], width: 2.5 }, pencil: { color: COLORS[0], width: 2.5 },
      fountain: { color: COLORS[0], width: 5 }, brush: { color: COLORS[0], width: 7 },
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
  var dirty = new Set(), noteDirty = false, saveTimer = 0, zoomTimer = 0, clearTimer = 0, pullTimer = 0;
  var live = null, liveCtx = null, liveOwner = null, liveLowLatency = false, rafPending = false;
  var INK_TOOLS = ['pen', 'fountain', 'brush', 'pencil', 'highlighter'];
  var dropping = false, clipboard = [], penButtonSeen = false;
  var rec = null, player = null, recTimer = 0;
  var stats = { type: '-', pMin: 1, pMax: 0, events: 0, coalesced: 0, frames: 0, start: 0, end: 0 };
  var dom = {}, unlocked = {};

  function loadSettings() {
    var saved = null;
    try { saved = JSON.parse(localStorage.getItem(SETTINGS_KEY)); } catch (e) { /* defaults apply */ }
    var c = JSON.parse(JSON.stringify(DEFAULTS));
    if (saved) {
      Object.keys(c).forEach(function (k) { if (k !== 't' && saved[k] !== undefined) c[k] = saved[k]; });
      if (saved.t) Object.keys(c.t).forEach(function (k) { Object.assign(c.t[k], saved.t[k]); });
      Object.keys(c.t).forEach(function (k) {
        if (OLD_DEFAULTS[c.t[k].color]) c.t[k].color = OLD_DEFAULTS[c.t[k].color];
      });
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
    var w = cssWidth();
    views.forEach(function (v) {
      v.el.style.width = w + 'px';
      v.el.style.height = Math.round(w * H(v.page) / PW) + 'px';
    });
    dom.pages.style.width = w + 'px';
  }

  function measureBase() {
    var old = baseWidth;
    baseWidth = Math.min(dom.scroller.clientWidth - 24, 1100);
    if (baseWidth < 200) baseWidth = old;
    return baseWidth !== old;
  }

  function H(page) { return page.h || PH; }

  function ratioFor(w, page) {
    var dpr = window.devicePixelRatio || 1, h = w * H(page) / PW;
    return Math.min(dpr, Math.sqrt(16000000 / (w * h)));
  }

  function renderView(v) {
    var w = cssWidth(), r = ratioFor(w, v.page);
    var pxW = Math.round(w * r), pxH = Math.round(pxW * H(v.page) / PW);
    v.canvas.width = pxW;
    v.canvas.height = pxH;
    var ctx = v.canvas.getContext('2d');
    ctx.setTransform(pxW / PW, 0, 0, pxW / PW, 0, 0);
    paintPage(ctx, v.page);
    v.stale = false;
    loadMissingAssets(v.page);
  }

  function paintPage(ctx, page) {
    Ink.drawPage(ctx, page, assets);
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
    var wanted = page.items.filter(function (it) { return it.type === 'image'; });
    if (page.bg) wanted = wanted.concat([page.bg]);
    wanted.forEach(function (it) {
      if (assets[it.asset] !== undefined) return;
      assets[it.asset] = null;
      Store.get('assets', it.asset).then(function (a) {
        return a || (it.type === 'image' ? Folio.Sync.fetchAsset(it.asset) : null);
      }).then(function (a) {
        if (!a) return null;
        return createImageBitmap(a.blob).then(function (bmp) {
          assets[it.asset] = bmp;
          pages.forEach(function (p) {
            if ((p.bg && p.bg.asset === it.asset) || p.items.some(function (x) { return x.asset === it.asset; })) refresh(p);
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

  function prepareLive(v, pointerType) {
    // Low-latency mode can flicker on some screens, so only a real pen gets it.
    var lowLatency = cfg.lowLatency && pointerType === 'pen';
    if (live && liveLowLatency !== lowLatency) { live.remove(); live = null; liveCtx = null; }
    if (!live) {
      live = el('canvas.live');
      liveLowLatency = lowLatency;
      liveCtx = live.getContext('2d', lowLatency ? { desynchronized: true } : {}) || live.getContext('2d');
    }
    clearTimeout(clearTimer);
    if (live.parentNode !== v.el) v.el.appendChild(live);
    var pxW = v.canvas.width, pxH = v.canvas.height;
    if (live.width !== pxW || live.height !== pxH) { live.width = pxW; live.height = pxH; }
    liveCtx.setTransform(pxW / PW, 0, 0, pxW / PW, 0, 0);
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

  // The layer only exists on the page during a stroke, so it can't flicker while idle.
  function parkLive() {
    clearLive();
    if (live) live.remove();
    liveOwner = null;
  }

  // Keeps wet ink up until the page beneath has painted, so it does not blink.
  function clearLiveSoon() {
    requestAnimationFrame(function () {
      requestAnimationFrame(function () {
        if (!act) parkLive();
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
    c.width = 360; c.height = Math.round(360 * H(first) / PW);
    var ctx = c.getContext('2d');
    ctx.setTransform(c.width / PW, 0, 0, c.width / PW, 0, 0);
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
    note.searchText = [note.pdfText || ''].concat(pages.map(function (p) {
      return p.items.filter(function (it) { return it.type === 'text' || it.type === 'attach'; }).map(function (it) { return it.text || it.name || ''; }).join(' ');
    })).join(' ').slice(0, 500000);
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
    return { x: (e.clientX - rect.left) / rect.width * PW, y: (e.clientY - rect.top) / rect.width * PW };
  }

  function pageViewAt(target, x, y) {
    var node = target && target.closest && target.closest('.page');
    if (!node) {
      var hit = document.elementFromPoint(x, y);
      node = hit && hit.closest && hit.closest('.page');
    }
    return node ? views.get(node.dataset.id) : null;
  }

  // The pen's side button (2) or an eraser end (5, 32) erases while held.
  function isEraserButton(e) {
    return e.pointerType === 'pen' && (e.button === 2 || e.button === 5 || (e.buttons & 2) !== 0 || (e.buttons & 32) !== 0);
  }

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
    if (note.shared && !note.shared.canEdit) return;
    var t = e.target;
    commitTextIfOutside(t);

    if (sel && t.closest('.sel-box')) {
      e.preventDefault();
      capture(e);
      startSelectionDrag(e, !!t.closest('.sel-handle'));
      return;
    }
    if (sel && !dropping) clearSelection();

    var v = pageViewAt(t, e.clientX, e.clientY);
    if (!v) return;
    if (v.stale) renderView(v);
    e.preventDefault();
    capture(e);

    var tool = isEraserButton(e) ? 'eraser' : cfg.tool;
    var rect = v.el.getBoundingClientRect();
    var p = pagePoint(e, rect);
    var base = { pointerId: e.pointerId, pointerType: e.pointerType, v: v, rect: rect, before: v.page.items };

    if (dropping) {
      act = Object.assign(base, { kind: 'dropper', point: p });
    } else if (INK_TOOLS.indexOf(tool) >= 0 || (tool === 'shape' && cfg.shape === 'curve')) {
      prepareLive(v, e.pointerType);
      live.classList.toggle('multiply', tool === 'highlighter');
      var opts = cfg.t[tool], autoCurve = tool === 'shape';
      if (autoCurve) tool = 'pen';
      act = Object.assign(base, {
        kind: 'ink', drawn: 1, smoothP: null, autoCurve: autoCurve,
        item: { id: Ink.uid(), type: 'stroke', tool: tool, color: opts.color, width: opts.width, pts: [] }
      });
      resetStats(e);
      addInkPoint(e, rect);
      paintLive();
      act.anchor = p;
      armHold();
    } else if (tool === 'eraser') {
      prepareLive(v, e.pointerType);
      live.classList.remove('multiply');
      act = Object.assign(base, { kind: 'erase', radius: cfg.t.eraser.width / 2, last: p, viaButton: tool !== cfg.tool });
      eraseAt(p);
      drawEraserRing(p);
    } else if (tool === 'lasso') {
      prepareLive(v, e.pointerType);
      live.classList.remove('multiply');
      act = Object.assign(base, { kind: 'lasso', poly: [p.x, p.y] });
    } else if (tool === 'shape') {
      prepareLive(v, e.pointerType);
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
    var it = act.item, x = (e.clientX - rect.left) / rect.width * PW, y = (e.clientY - rect.top) / rect.width * PW;
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

  // Draw a shape and keep the pen still: it turns into a neat shape, the size you drew it.
  var HOLD_MS = 550, holdTimer = 0;

  function armHold() {
    clearTimeout(holdTimer);
    holdTimer = setTimeout(snapToShape, HOLD_MS);
  }

  function snapToShape() {
    if (!act || act.kind !== 'ink' || act.snapped) return;
    var it = act.item, neat = Ink.recognizeShape(it.pts, { curves: true, force: act.autoCurve });
    if (!neat) return;
    if (it.tool === 'highlighter') {
      var track = neat.shape === 'line' ? [neat.x1, neat.y1, neat.x2, neat.y2]
        : neat.shape === 'curve' ? Ink.curvePoints(neat.points)
          : neat.shape === 'poly' ? neat.points.concat(neat.open ? [] : neat.points.slice(0, 2))
            : Ink.curvePoints(Ink.outlineOf(neat)), flat = [];
      for (var f = 0; f < track.length; f += 2) flat.push(track[f], track[f + 1], 0.5);
      act.snapped = Object.assign({}, it, { pts: flat });
      clearLive();
      Ink.drawHighlighter(liveCtx, act.snapped);
    } else {
      act.snapped = Object.assign({ id: it.id, type: 'shape', color: it.color, width: it.width }, neat);
      clearLive();
      Ink.drawShape(liveCtx, act.snapped);
    }
    if (navigator.vibrate) navigator.vibrate(12);
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
    if (e.pointerType === 'pen') {
      lastPen = performance.now();
      if (e.buttons & 34) penButtonSeen = true;
      switchWithButton(e);
    }
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
      var heldAt = list[list.length - 1], heldPoint = pagePoint(heldAt, act.rect);
      var movedOn = Math.hypot(heldPoint.x - act.anchor.x, heldPoint.y - act.anchor.y) > 5;
      if (act.snapped) {
        // It was only a pause: back to the hand-drawn stroke, and keep drawing.
        if (!movedOn) return;
        act.snapped = null;
        clearLive();
        if (act.item.tool === 'highlighter') Ink.drawHighlighter(liveCtx, act.item);
        else Ink.drawInk(liveCtx, act.item, 1);
        act.drawn = act.item.pts.length / 3;
      }
      if (movedOn) {
        act.anchor = heldPoint;
        armHold();
      }
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

  // Pressing or letting go of the side button in the middle of a stroke swaps tools straight away.
  function switchWithButton(e) {
    if (!act || e.pointerId !== act.pointerId || !e.buttons) return;
    var held = isEraserButton(e);
    if (held && act.kind === 'ink') {
      finishAction();
      startAction(e);
      if (act) act.viaButton = true;
    } else if (!held && act.kind === 'erase' && act.viaButton) {
      finishAction();
      startAction(e);
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
    liveCtx.strokeStyle = '#3f7ea6';
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
    clearTimeout(holdTimer);
    var page = a.v.page;
    if (a.kind === 'ink') {
      if (!a.item.pts.length) { clearLiveSoon(); return; }
      var finished = a.snapped || a.item;
      if (a.autoCurve && !a.snapped) {
        var drawnCurve = Ink.recognizeShape(finished.pts, { force: true });
        if (drawnCurve) finished = Object.assign({ id: finished.id, type: 'shape', color: finished.color, width: finished.width }, drawnCurve);
      } else if (!a.snapped && cfg.shapeFix && finished.tool !== 'highlighter') {
        var neat = Ink.recognizeShape(finished.pts);
        if (neat) {
          finished = Object.assign({ id: finished.id, type: 'shape', color: finished.color, width: finished.width }, neat);
        }
      }
      stamp(finished);
      page.items = a.before.concat([finished]);
      var ctx = a.v.canvas.getContext('2d');
      Ink.drawItem(ctx, finished, assets);
      growIfNeeded(a.v, finished);
      clearLiveSoon();
      pushHistory(page, a.before);
      requestPersist();
    } else if (a.kind === 'erase') {
      renderView(a.v);
      parkLive();
      if (page.items !== a.before) pushHistory(page, a.before);
    } else if (a.kind === 'lasso') {
      parkLive();
      if (a.poly.length < 6 || lassoIsTap(a.poly)) tapActions(a.v, { x: a.poly[0], y: a.poly[1] });
      else selectByLasso(a.v, a.poly);
    } else if (a.kind === 'shape') {
      clearLiveSoon();
      var it = a.item;
      if (Math.hypot(it.x2 - it.x1, it.y2 - it.y1) < 4) return;
      stamp(it);
      page.items = a.before.concat([it]);
      Ink.drawItem(a.v.canvas.getContext('2d'), it, assets);
      growIfNeeded(a.v, it);
      pushHistory(page, a.before);
    } else if (a.kind === 'seldrag') {
      if (page.items !== a.before) pushHistory(page, a.before);
    } else if (a.kind === 'texttap') {
      openTextAt(a.v, a.point);
    } else if (a.kind === 'dropper') {
      sampleColor(a.v, a.point);
    }
  }

  // Eyedropper: the next tap on the page picks up the colour under it.
  function sampleColor(v, p) {
    dropping = false;
    var c = v.canvas, d = c.getContext('2d').getImageData(
      Math.min(c.width - 1, Math.floor(p.x / PW * c.width)),
      Math.min(c.height - 1, Math.floor(p.y / PW * c.width)), 1, 1).data;
    var hex = '#' + [d[0], d[1], d[2]].map(function (n) { return ('0' + n.toString(16)).slice(-2); }).join('');
    var opts = cfg.t[cfg.tool];
    if (opts && opts.color) opts.color = hex;
    if (sel) recolorSelection(hex);
    cfg.recent = [hex].concat(cfg.recent.filter(function (x) { return x !== hex; })).slice(0, 8);
    saveSettings();
    buildToolbar();
    UI.toast('Picked up ' + hex + '.');
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
    parkLive();
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
      trackPull(dy);
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

  // Drag up past the end of the last page and hold, and a new page appears.
  var PULL_START = 70, PULL_HOLD = 600;

  function trackPull(dy) {
    var s = dom.scroller, g = gesture;
    if (g.pullDone) return;
    var atEnd = s.scrollTop + s.clientHeight >= s.scrollHeight - 2;
    if (!atEnd) { g.pull = 0; clearPull(); return; }
    g.pull = Math.max(0, (g.pull || 0) - dy);
    if (g.pull < PULL_START) { clearPull(); return; }
    if (pullTimer) return;
    dom.pullHint.hidden = false;
    pullTimer = setTimeout(function () {
      pullTimer = 0;
      dom.pullHint.hidden = true;
      if (!gesture || gesture !== g || !note) return;
      g.pullDone = true;
      g.vx = 0; g.vy = 0;
      addPage();
      UI.toast('New page added.');
    }, PULL_HOLD);
  }

  function clearPull() {
    clearTimeout(pullTimer);
    pullTimer = 0;
    if (dom.pullHint) dom.pullHint.hidden = true;
  }

  function onTouchUp(e) {
    clearPull();
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
    if (dropping) {
      var dv = pageViewAt(document.elementFromPoint(e.clientX, e.clientY), e.clientX, e.clientY);
      if (dv) {
        if (dv.stale) renderView(dv);
        sampleColor(dv, pagePoint(e, dv.el.getBoundingClientRect()));
      }
      return;
    }
    var v = pageViewAt(document.elementFromPoint(e.clientX, e.clientY), e.clientX, e.clientY);
    if (v) {
      if (v.stale) renderView(v);
      if (tapActions(v, pagePoint(e, v.el.getBoundingClientRect()))) return;
    }
    if (cfg.tool !== 'text') {
      if (sel) clearSelection();
      return;
    }
    if (!v) return;
    commitText();
    if (v.stale) renderView(v);
    openTextAt(v, pagePoint(e, v.el.getBoundingClientRect()));
  }

  function endGesture() {
    clearPull();
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
  }

  function selectedItems() {
    if (!sel) return [];
    return sel.v.page.items.filter(function (it) { return sel.ids.has(it.id); });
  }

  function setSelection(v, ids) {
    clearSelection();
    var bar = el('div.sel-bar', null,
      barButton('clip', 'Copy', copySelection),
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
    s.top = (r.y / H(sel.v.page) * 100) + '%';
    s.width = (r.w / PW * 100) + '%';
    s.height = (r.h / H(sel.v.page) * 100) + '%';
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

  function copySelection() {
    clipboard = selectedItems();
    UI.toast('Copied. Paste it from the ⋯ menu, on any page.');
  }

  function pasteClipboard() {
    var v = currentPage();
    if (!v || !clipboard.length) return;
    if (v.stale) renderView(v);
    var page = v.page, before = page.items;
    var copies = clipboard.map(function (it) {
      return Object.assign(Ink.transform(it, 26, 26, 1, 0, 0), { id: Ink.uid() });
    });
    page.items = before.concat(copies);
    refresh(page);
    pushHistory(page, before);
    setTool('lasso');
    setSelection(v, new Set(copies.map(function (c) { return c.id; })));
  }

  function addSticky() {
    var v = currentPage();
    if (!v) return;
    if (v.stale) renderView(v);
    var box = dom.scroller.getBoundingClientRect(), r = v.el.getBoundingClientRect();
    var y = Math.max(60, Math.min(H(v.page) - 400, (box.top + box.height / 2 - r.top) / r.width * PW - 150));
    var item = {
      id: Ink.uid(), type: 'text', text: '', x: 340, y: y, w: 320, minH: 240, size: 28,
      color: COLORS[0], bg: '#f2d675'
    };
    setTool('text');
    startTextEdit(v, item, null);
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
    startTextEdit(v, item, existing);
  }

  function startTextEdit(v, item, existing) {
    var ta = el('div.text-editor', { contenteditable: 'true', role: 'textbox', 'aria-multiline': 'true', 'aria-label': 'Text', spellcheck: 'true' });
    if (item.bg) { ta.style.background = item.bg; ta.style.minHeight = (item.minH || 0) * cssWidth() / PW + 'px'; }
    if (item.html) {
      ta.innerHTML = Ink.cleanHtml(item.html);
    } else {
      ta.textContent = item.text || '';
    }
    var s = ta.style;
    s.left = (item.x / PW * 100) + '%';
    s.top = (item.y / H(v.page) * 100) + '%';
    s.width = (item.w / PW * 100) + '%';
    s.font = (item.size * cssWidth() / PW) + 'px/' + Ink.LINE + ' ' + Ink.FONT;
    s.color = item.color;
    // Pasting always comes in as clean text with its line breaks, never as outside formatting.
    ta.addEventListener('paste', function (e) {
      var plain = e.clipboardData && e.clipboardData.getData('text/plain');
      e.preventDefault();
      e.stopPropagation();
      if (plain) document.execCommand('insertText', false, plain.replace(/\r\n/g, '\n').replace(/[ \t]+$/gm, ''));
    });
    ta.addEventListener('blur', function () { setTimeout(function () { if (textEd && textEd.ta === ta) commitText(); }, 0); });
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
    dom.richBar.hidden = false;
    ta.focus();
    var range = document.createRange();
    range.selectNodeContents(ta);
    range.collapse(false);
    var selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
  }

  function commitTextIfOutside(target) {
    if (textEd && !textEd.ta.contains(target)) commitText();
  }

  function commitText() {
    if (!textEd) return;
    var ed = textEd;
    textEd = null;
    dom.richBar.hidden = true;
    var value = ed.ta.innerText.replace(/\s+$/, '');
    var html = Ink.cleanHtml(ed.ta.innerHTML);
    var rich = /<(b|i|u|strong|em|font|ul|ol|table)\b/i.test(html);
    ed.ta.remove();
    var page = ed.v.page, before = ed.before;
    var result = Object.assign({}, ed.item, { text: value });
    if (rich) result.html = html; else delete result.html;
    if (ed.existing && value === ed.existing.text && (result.html || '') === (ed.existing.html || '')) {
      page.items = before;
      refresh(page);
      return;
    }
    if (!value && !rich && !ed.existing) return;
    if (!ed.existing) stamp(result);
    page.items = value || rich
      ? (ed.existing
        ? before.map(function (x) { return x === ed.existing ? result : x; })
        : before.concat([result]))
      : before.filter(function (x) { return x !== ed.existing; });
    refresh(page);
    pushHistory(page, before);
  }

  function buildRichBar() {
    function cmd(label, title, fn, html) {
      var b = el('button', { type: 'button', title: title, 'aria-label': title, text: html ? null : label, html: html || null });
      // Keeps the cursor in the text while a button is pressed.
      b.addEventListener('pointerdown', function (e) { e.preventDefault(); });
      b.addEventListener('mousedown', function (e) { e.preventDefault(); });
      b.addEventListener('click', function () {
        if (!textEd) return;
        document.execCommand('styleWithCSS', false, false);
        fn();
      });
      return b;
    }
    function exec(name, value) { return function () { document.execCommand(name, false, value); }; }
    var bar = dom.richBar;
    bar.appendChild(cmd('', 'Bold', exec('bold'), '<b>B</b>'));
    bar.appendChild(cmd('', 'Italic', exec('italic'), '<i>I</i>'));
    bar.appendChild(cmd('', 'Underline', exec('underline'), '<u>U</u>'));
    bar.appendChild(cmd('A−', 'Smaller text', exec('fontSize', '2')));
    bar.appendChild(cmd('A', 'Normal text', exec('fontSize', '3')));
    bar.appendChild(cmd('A+', 'Larger text', exec('fontSize', '5')));
    bar.appendChild(cmd('•', 'Bulleted list', exec('insertUnorderedList')));
    bar.appendChild(cmd('1.', 'Numbered list', exec('insertOrderedList')));
    bar.appendChild(cmd('☐', 'Checkbox', exec('insertText', '☐ ')));
    bar.appendChild(cmd('▦', 'Insert table', function () {
      var row = '<tr><td><br></td><td><br></td><td><br></td></tr>';
      document.execCommand('insertHTML', false, '<table><tbody>' + row + row + row + '</tbody></table><div><br></div>');
    }));
    COLORS.forEach(function (c) {
      var b = cmd('', 'Text colour ' + c, exec('foreColor', c));
      b.className = 'swatch';
      b.style.background = c;
      bar.appendChild(b);
    });
  }

  // ---------- Tapping things on the page ----------

  function lassoIsTap(poly) {
    for (var i = 2; i < poly.length; i += 2) {
      if (Math.hypot(poly[i] - poly[0], poly[i + 1] - poly[1]) > 10) return false;
    }
    return true;
  }

  // Handles a tap on a checkbox, an attachment, or (while a recording is open) your writing.
  function tapActions(v, p) {
    var items = v.page.items, ctx = measureCtx();
    for (var i = items.length - 1; i >= 0; i--) {
      var it = items[i];
      if (it.type === 'text' && /[☐☑]/.test(it.text)) {
        var box = Ink.checkboxAt(ctx, it, p.x, p.y);
        if (box >= 0) {
          var before = items;
          var changed = Object.assign({}, it, { text: Ink.toggleBox(it.text, box) });
          if (it.html) changed.html = Ink.toggleBox(it.html, box);
          v.page.items = before.map(function (x) { return x === it ? changed : x; });
          refresh(v.page);
          pushHistory(v.page, before);
          return true;
        }
      }
      if (it.type === 'attach' && Ink.insideBox(it, p.x, p.y)) { openAttachment(it); return true; }
    }
    if (player) {
      for (var j = items.length - 1; j >= 0; j--) {
        var x = items[j];
        if (!x.rec || x.rec.id !== player.id) continue;
        var hit = x.type === 'stroke' ? Ink.hitsStroke(x, p.x, p.y, 14)
          : x.type === 'shape' ? Ink.hitsShape(x, p.x, p.y, 14)
            : Ink.insideBox(Object.assign({}, x, x.type === 'text' ? { w: x.w, h: Ink.bbox(x, ctx).h } : {}), p.x, p.y);
        if (hit) {
          player.audio.currentTime = Math.max(0, x.rec.t - 1);
          player.audio.play().catch(function () {});
          return true;
        }
      }
    }
    return false;
  }

  function growIfNeeded(v, item) {
    if (v.page.layout !== 'long') return;
    var r = Ink.bbox(item, measureCtx());
    if (r.y + r.h < H(v.page) - 300) return;
    v.page.h = H(v.page) + 700;
    layout();
    renderView(v);
    markDirty(v.page);
  }

  function pageSize(page) {
    UI.sheet('Page size', [
      { label: 'Standard portrait', value: 'portrait', checked: !page.layout || page.layout === 'portrait' },
      { label: 'Landscape', value: 'landscape', checked: page.layout === 'landscape' },
      { label: 'Long scrolling page', hint: 'Grows as you write', value: 'long', checked: page.layout === 'long' }
    ]).then(function (choice) {
      if (!choice) return;
      var ctx = measureCtx(), lowest = page.bg ? page.bg.y + page.bg.h : 0;
      page.items.forEach(function (it) {
        var r = Ink.bbox(it, ctx);
        lowest = Math.max(lowest, r.y + r.h);
      });
      var wanted = choice === 'landscape' ? 707 : PH;
      page.layout = choice;
      page.h = Math.max(wanted, Math.ceil(lowest + 20));
      if (page.h > wanted && choice !== 'long') UI.toast('The page was kept taller so nothing on it gets cut off.');
      rebuildPages(page.id);
      markDirty(page);
    });
  }

  // ---------- Attachments ----------

  function placeAttachment(props) {
    var v = currentPage();
    if (!v) return;
    if (v.stale) renderView(v);
    var box = dom.scroller.getBoundingClientRect(), r = v.el.getBoundingClientRect();
    var y = Math.max(40, Math.min(H(v.page) - 120, (box.top + box.height / 2 - r.top) / r.width * PW));
    var before = v.page.items, item = Object.assign({ id: Ink.uid(), type: 'attach', x: 200, y: y, w: 600, h: 76 }, props);
    v.page.items = before.concat([item]);
    refresh(v.page);
    pushHistory(v.page, before);
    setTool('lasso');
    setSelection(v, new Set([item.id]));
  }

  function openAttachment(it) {
    if (it.kind === 'link') {
      window.open(it.url, '_blank', 'noopener');
      return;
    }
    Store.get('assets', it.asset).then(function (a) {
      if (a) Folio.Docs.download(a.blob, it.name);
      else UI.toast('That file could not be found.');
    });
  }

  function addLink() {
    UI.prompt('Paste a web link', '', 'Add link', 'url').then(function (txt) {
      if (!txt) return;
      var url = /^[a-z][a-z0-9+.-]*:/i.test(txt) ? txt : 'https://' + txt, parsed = null;
      try { parsed = new URL(url); } catch (e) { /* reported below */ }
      if (!parsed || (parsed.protocol !== 'http:' && parsed.protocol !== 'https:')) {
        UI.toast('That does not look like a web link.');
        return;
      }
      placeAttachment({ kind: 'link', url: parsed.href, name: parsed.hostname + parsed.pathname.replace(/\/$/, '') });
    });
  }

  function chooseFile(accept, capture, handler) {
    var input = el('input', { type: 'file', accept: accept || null, capture: capture || null, multiple: !capture && accept === 'image/*' });
    input.addEventListener('change', function () {
      Array.from(input.files).reduce(function (chain, f) {
        return chain.then(function () { return handler(f); });
      }, Promise.resolve());
    });
    input.click();
  }

  function addFile(f) {
    var id = Ink.uid();
    return Store.put('assets', { id: id, blob: f }).then(function () {
      placeAttachment({ kind: 'file', asset: id, name: f.name });
      requestPersist();
    }).catch(function () { UI.toast('That file could not be saved.'); });
  }

  // Turns a photo of a page into clean, high-contrast black and white.
  function addScan(f) {
    return createImageBitmap(f).then(function (bmp) {
      var scale = Math.min(1, 2000 / Math.max(bmp.width, bmp.height)), c = document.createElement('canvas');
      c.width = Math.round(bmp.width * scale);
      c.height = Math.round(bmp.height * scale);
      var ctx = c.getContext('2d');
      ctx.drawImage(bmp, 0, 0, c.width, c.height);
      var img = ctx.getImageData(0, 0, c.width, c.height), d = img.data;
      for (var i = 0; i < d.length; i += 4) {
        var g = d[i] * 0.299 + d[i + 1] * 0.587 + d[i + 2] * 0.114;
        g = Math.max(0, Math.min(255, (g - 110) * 1.9 + 110));
        d[i] = d[i + 1] = d[i + 2] = g;
      }
      ctx.putImageData(img, 0, 0);
      return new Promise(function (resolve) { c.toBlob(resolve, 'image/webp', 0.85); });
    }).then(addImageBlob).catch(function () { UI.toast('That scan could not be added.'); });
  }

  function insertMenu() {
    UI.sheet('Insert', [
      { label: 'Image', icon: 'image', value: 'image' },
      { label: 'Take a photo', icon: 'camera', value: 'photo' },
      { label: 'Scan a document', icon: 'camera', value: 'scan' },
      { label: 'PDF pages', icon: 'file', value: 'pdf' },
      { label: 'File', icon: 'file', value: 'file' },
      { label: 'Link', icon: 'link', value: 'link' }
    ]).then(function (v) {
      if (v === 'image') pickImage();
      else if (v === 'photo') chooseFile('image/*', 'environment', addImageBlob);
      else if (v === 'scan') chooseFile('image/*', 'environment', addScan);
      else if (v === 'file') chooseFile(null, null, addFile);
      else if (v === 'link') addLink();
      else if (v === 'pdf') chooseFile('application/pdf,.pdf', null, addPdfPages);
    });
  }

  function addPdfPages(f) {
    return Folio.Docs.pdfToPages(f, note.id, function (n, total) {
      UI.toast('Importing page ' + n + ' of ' + total + '…');
    }).then(function (r) {
      var first = r.pages[0];
      r.pages.forEach(function (p) { pages.push(p); dirty.add(p.id); });
      note.pdfText = ((note.pdfText || '') + ' ' + r.text).slice(0, 500000);
      rebuildPages(first && first.id);
    }).catch(function (err) { UI.toast('Could not import that PDF: ' + err.message); });
  }

  function exportMenu() {
    commitText();
    UI.sheet('Export or share', [
      { label: 'PDF', hint: 'All pages', value: 'pdf' },
      { label: 'Image', hint: 'This page', value: 'png' },
      { label: 'Word', hint: 'Pages as pictures', value: 'docx' },
      { label: 'PowerPoint', hint: 'Pages as pictures', value: 'pptx' },
      { label: 'Text file', hint: 'Typed text only', value: 'txt' }
    ]).then(function (format) {
      if (!format) return;
      UI.toast('Preparing your file…');
      var index = pages.indexOf(currentPage().page);
      flush().then(function () {
        return Folio.Docs.exportNote(note, pages, format, index);
      }).then(function (file) {
        return Folio.Docs.deliver(file, true);
      }).then(function (how) {
        if (how === 'saved') UI.toast('Saved to your downloads.');
      }).catch(function (err) { UI.toast('Export failed: ' + err.message); });
    });
  }

  // ---------- Voice recording ----------

  function stamp(item) {
    if (rec) item.rec = { id: rec.id, t: +((Date.now() - rec.start) / 1000).toFixed(1) };
  }

  function formatTime(s) {
    s = Math.max(0, Math.floor(s));
    var m = Math.floor(s / 60);
    return (m >= 60 ? Math.floor(m / 60) + ':' + ('0' + (m % 60)).slice(-2) : m) + ':' + ('0' + (s % 60)).slice(-2);
  }

  function startRecording() {
    if (!navigator.mediaDevices || !window.MediaRecorder) {
      UI.toast('Recording is not available in this browser.');
      return;
    }
    closePlayer();
    // The browser's own noise reduction is the free stand-in for Audio Eraser.
    navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } }).then(function (stream) {
      var type = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4'].filter(function (t) { return MediaRecorder.isTypeSupported(t); })[0];
      var recorder = new MediaRecorder(stream, Object.assign({ audioBitsPerSecond: 32000 }, type ? { mimeType: type } : {}));
      var entry = { id: Ink.uid(), asset: Ink.uid(), name: 'Recording ' + new Date().toLocaleString(), duration: 0, created: Date.now() };
      var chunks = [], lastSave = Date.now(), owner = note;
      owner.recordings = (owner.recordings || []).concat([entry]);
      markDirty();
      function save() {
        return Store.put('assets', { id: entry.asset, blob: new Blob(chunks, { type: recorder.mimeType || type }) });
      }
      recorder.ondataavailable = function (e) {
        if (e.data && e.data.size) chunks.push(e.data);
        // Saved as it goes, so a crash or dead battery loses seconds rather than the lecture.
        if (Date.now() - lastSave > 20000) { lastSave = Date.now(); save(); }
      };
      recorder.onstop = function () {
        stream.getTracks().forEach(function (t) { t.stop(); });
        save().then(function () { return Store.put('notes', owner); }).then(function () {
          UI.toast('Recording saved.');
        }).catch(function () { UI.toast('The recording could not be saved.'); });
      };
      recorder.start(5000);
      rec = { id: entry.id, entry: entry, recorder: recorder, start: Date.now(), wake: null };
      if (navigator.wakeLock) navigator.wakeLock.request('screen').then(function (w) { if (rec) rec.wake = w; else w.release(); }).catch(function () {});
      showRecordingBar();
      requestPersist();
    }).catch(function () {
      UI.toast('Folio needs permission to use the microphone.');
    });
  }

  function showRecordingBar() {
    var bar = dom.recBar, time = el('span.rec-time', { text: '0:00' });
    bar.innerHTML = '';
    bar.appendChild(el('span.rec-dot'));
    bar.appendChild(time);
    bar.appendChild(el('button.btn', { type: 'button', text: 'Stop', on: { click: stopRecording } }));
    bar.hidden = false;
    clearInterval(recTimer);
    recTimer = setInterval(function () {
      if (rec) time.textContent = formatTime((Date.now() - rec.start) / 1000);
    }, 500);
  }

  function stopRecording() {
    if (!rec) return;
    var r = rec;
    rec = null;
    clearInterval(recTimer);
    dom.recBar.hidden = true;
    r.entry.duration = Math.round((Date.now() - r.start) / 1000);
    if (r.wake) r.wake.release().catch(function () {});
    if (r.recorder.state !== 'inactive') r.recorder.stop();
    markDirty();
  }

  function recordingsMenu() {
    var list = note.recordings || [];
    UI.sheet('Recordings', list.map(function (r) {
      return { label: r.name, hint: formatTime(r.duration), icon: 'mic', value: r.id };
    })).then(function (id) {
      var r = list.find(function (x) { return x.id === id; });
      if (r) openPlayer(r);
    });
  }

  function openPlayer(r) {
    closePlayer();
    Store.get('assets', r.asset).then(function (a) {
      if (!a) { UI.toast('That recording could not be found.'); return; }
      var url = URL.createObjectURL(a.blob), audio = el('audio', { controls: true, src: url });
      player = { id: r.id, audio: audio, url: url };
      var bar = dom.recBar;
      bar.innerHTML = '';
      bar.appendChild(audio);
      bar.appendChild(el('span.rec-hint', { text: 'Tap your writing to jump to that moment' }));
      bar.appendChild(el('button.btn', { type: 'button', text: 'Save file', on: { click: function () {
        Folio.Docs.download(a.blob, r.name.replace(/[\\/:*?"<>|]+/g, '-') + (a.blob.type.indexOf('mp4') >= 0 ? '.m4a' : '.webm'));
      } } }));
      bar.appendChild(el('button.btn', { type: 'button', text: 'Delete', on: { click: function () {
        UI.confirm('Delete this recording?', 'Your notes stay. You can\'t undo this.', 'Delete', true).then(function (ok) {
          if (!ok) return;
          closePlayer();
          note.recordings = note.recordings.filter(function (x) { return x.id !== r.id; });
          Store.del('assets', r.asset);
          markDirty();
        });
      } } }));
      bar.appendChild(el('button.btn', { type: 'button', text: 'Close', on: { click: closePlayer } }));
      bar.hidden = false;
    });
  }

  function closePlayer() {
    if (!player) return;
    player.audio.pause();
    URL.revokeObjectURL(player.url);
    player = null;
    if (dom.recBar) { dom.recBar.hidden = true; dom.recBar.innerHTML = ''; }
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
    orderedTools().forEach(function (t) {
      if (cfg.toolHidden.indexOf(t[0]) >= 0 && cfg.tool !== t[0]) return;
      tools.appendChild(el('button.tool' + (cfg.tool === t[0] ? '.on' : ''), {
        type: 'button', title: t[1], 'aria-label': t[1], 'aria-pressed': String(cfg.tool === t[0]),
        'data-tool': t[0], html: icon(t[0]), on: { click: function () { setTool(t[0]); } }
      }));
    });
    bar.appendChild(tools);

    var tool = cfg.tool;
    if (tool === 'shape') {
      var shapes = el('div.tool-group');
      [['rect', 'Rectangle'], ['ellipse', 'Circle'], ['line', 'Line'], ['curve', 'Curve'], ['arrow', 'Arrow']].forEach(function (s) {
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
      function useColor(c) {
        if (cfg.t[tool]) { opts.color = c; saveSettings(); }
        if (sel) recolorSelection(c);
        buildToolbar();
      }
      palette.forEach(function (c) {
        colors.appendChild(el('button.swatch' + (opts.color === c ? '.on' : ''), {
          type: 'button', 'aria-label': 'Colour ' + c, style: 'background:' + c,
          on: { click: function () { useColor(c); } }
        }));
      });
      var isCustom = palette.indexOf(opts.color) < 0;
      colors.appendChild(el('button.wheel-btn' + (isCustom ? '.on' : ''), {
        type: 'button', title: 'Colour wheel', 'aria-label': 'Colour wheel',
        on: {
          click: function () {
            UI.colorWheel(opts.color || COLORS[0], cfg.recent).then(function (c) {
              if (!c) return;
              cfg.recent = [c].concat(cfg.recent.filter(function (x) { return x !== c; })).slice(0, 8);
              useColor(c);
            });
          }
        }
      }, el('span', { style: isCustom ? 'background:' + opts.color : null })));
      colors.appendChild(el('button.tool.dropper' + (dropping ? '.on' : ''), {
        type: 'button', title: 'Pick up a colour from the page', 'aria-label': 'Pick up a colour from the page', html: icon('dropper'),
        on: {
          click: function () {
            dropping = !dropping;
            buildToolbar();
            if (dropping) UI.toast('Tap the colour you want on the page.');
          }
        }
      }));
      bar.appendChild(colors);
    }

    if (RANGES[tool]) bar.appendChild(sizeControl(tool));
    if (dom.dock) placeDock();
  }

  function orderedTools() {
    var order = cfg.toolOrder || [];
    return TOOLS.slice().sort(function (a, b) {
      var ia = order.indexOf(a[0]), ib = order.indexOf(b[0]);
      if (ia < 0) ia = TOOLS.indexOf(a) + 100;
      if (ib < 0) ib = TOOLS.indexOf(b) + 100;
      return ia - ib;
    });
  }

  function customiseToolbar() {
    UI.showDialog(function (dlg, done) {
      var list = el('div.custom-list');
      function draw() {
        list.innerHTML = '';
        var tools = orderedTools();
        tools.forEach(function (t, i) {
          var shown = cfg.toolHidden.indexOf(t[0]) < 0;
          var box = el('input', { type: 'checkbox', 'aria-label': 'Show ' + t[1] });
          box.checked = shown;
          box.addEventListener('change', function () {
            var visible = tools.filter(function (x) { return cfg.toolHidden.indexOf(x[0]) < 0; }).length;
            if (!box.checked && visible === 1) {
              box.checked = true;
              UI.toast('Keep at least one tool.');
              return;
            }
            cfg.toolHidden = box.checked
              ? cfg.toolHidden.filter(function (x) { return x !== t[0]; })
              : cfg.toolHidden.concat(t[0]);
            saveSettings();
            buildToolbar();
          });
          function move(delta) {
            var names = tools.map(function (x) { return x[0]; });
            names.splice(i + delta, 0, names.splice(i, 1)[0]);
            cfg.toolOrder = names;
            saveSettings();
            buildToolbar();
            draw();
          }
          list.appendChild(el('div.custom-row', null,
            el('label.custom-label', null, box, el('span.sheet-ic', { html: icon(t[0]) }), el('span', { text: t[1] })),
            rowButton('up', 'Move ' + t[1] + ' up', i === 0, function () { move(-1); }),
            rowButton('down', 'Move ' + t[1] + ' down', i === tools.length - 1, function () { move(1); })));
        });
      }
      draw();
      dlg.appendChild(el('div.dlg-body', null,
        el('h2', { text: 'Customise toolbar' }),
        el('p', { text: 'Tick the tools you want, and put them in your own order.' }),
        list,
        el('div.dlg-actions', null, el('button.btn.primary', { type: 'button', text: 'Done', on: { click: function () { done(null); } } }))));
    });
  }

  function formatSize(v) { return String(Math.round(v * 10) / 10); }

  function sizeControl(tool) {
    var range = RANGES[tool], min = range[0], max = range[1], opts = cfg.t[tool];
    // Curved so small pen sizes get most of the slider, where a small change matters most.
    function toSlider(v) { return Math.round(Math.pow((v - min) / (max - min), 1 / 2.2) * 1000); }
    function fromSlider(s) {
      return Math.round((min + (max - min) * Math.pow(s / 1000, 2.2)) * 10) / 10;
    }
    var dot = el('span');
    var preview = el('span.size-preview', { 'aria-hidden': 'true' }, dot);
    var value = el('button.size-value', { type: 'button', title: 'Type an exact size', 'aria-label': 'Type an exact size' });
    var slider = el('input.size-slider', { type: 'range', min: 0, max: 1000, 'aria-label': 'Size' });
    slider.value = String(toSlider(opts.width));

    function show() {
      var d = Math.max(2, Math.min(38, opts.width * cssWidth() / PW * (tool === 'text' ? 0.7 : 1)));
      dot.style.width = dot.style.height = d + 'px';
      dot.style.background = tool === 'eraser' ? 'transparent' : (opts.color || 'currentColor');
      dot.style.boxShadow = tool === 'eraser' || opts.color === '#ffffff' ? 'inset 0 0 0 1.5px currentColor' : '';
      value.textContent = formatSize(opts.width);
    }
    slider.addEventListener('input', function () { opts.width = fromSlider(+slider.value); show(); });
    slider.addEventListener('change', saveSettings);
    value.addEventListener('click', function () {
      UI.prompt('Exact size (' + min + ' to ' + max + ')', formatSize(opts.width), 'Set size').then(function (txt) {
        var n = parseFloat(String(txt).replace(',', '.'));
        if (!isFinite(n)) return;
        opts.width = Math.max(min, Math.min(max, n));
        slider.value = String(toSlider(opts.width));
        saveSettings();
        show();
      });
    });
    show();
    // Fine steps at pen sizes, bigger ones for broad tools.
    function nudge(direction) {
      var step = opts.width < 5 ? 0.5 : opts.width < 20 ? 1 : 2;
      opts.width = Math.max(min, Math.min(max, Math.round((opts.width + direction * step) * 10) / 10));
      slider.value = String(toSlider(opts.width));
      saveSettings();
      show();
    }
    function stepButton(label, title, direction) {
      var hold = 0, repeat = 0;
      function stop() { clearTimeout(hold); clearInterval(repeat); }
      var b = el('button.size-step', { type: 'button', title: title, 'aria-label': title, text: label });
      // A tap moves one step; holding keeps going.
      b.addEventListener('pointerdown', function () {
        nudge(direction);
        hold = setTimeout(function () { repeat = setInterval(function () { nudge(direction); }, 90); }, 400);
      });
      ['pointerup', 'pointerleave', 'pointercancel'].forEach(function (ev) { b.addEventListener(ev, stop); });
      return b;
    }
    return el('div.tool-group.size-group', null, preview, stepButton('−', 'Smaller', -1), slider, stepButton('+', 'Bigger', 1), value);
  }

  // ---------- Movable toolbar ----------

  var DOCK_TOP = 56, DOCK_EDGE = 8, SIDE_ZONE = 72;

  function placeDock() {
    var d = cfg.dock, node = dom.dock, s = node.style;
    node.classList.toggle('vertical', !!(d && d.side));
    if (!d) {
      s.left = '50%'; s.top = (DOCK_TOP + 2) + 'px'; s.right = ''; s.transform = 'translateX(-50%)';
      return;
    }
    var box = dom.editor.getBoundingClientRect(), w = node.offsetWidth, h = node.offsetHeight;
    var y = Math.max(DOCK_TOP, Math.min(box.height - h - DOCK_EDGE, d.y));
    s.transform = 'none';
    s.top = y + 'px';
    if (d.side === 'left') { s.left = DOCK_EDGE + 'px'; s.right = ''; }
    else if (d.side === 'right') { s.left = 'auto'; s.right = DOCK_EDGE + 'px'; }
    else {
      s.right = '';
      s.left = Math.max(DOCK_EDGE, Math.min(box.width - w - DOCK_EDGE, d.x)) + 'px';
    }
  }

  function bindDock() {
    var grip = document.getElementById('dockGrip'), drag = null;
    grip.innerHTML = icon('grip');
    grip.addEventListener('pointerdown', function (e) {
      e.preventDefault();
      var r = dom.dock.getBoundingClientRect();
      drag = { id: e.pointerId, dx: e.clientX - r.left, dy: e.clientY - r.top };
      try { grip.setPointerCapture(e.pointerId); } catch (err) { /* synthetic pointer */ }
      dom.dock.classList.add('dragging');
    });
    grip.addEventListener('pointermove', function (e) {
      if (!drag || e.pointerId !== drag.id) return;
      var box = dom.editor.getBoundingClientRect();
      var px = e.clientX - box.left, side = null;
      if (px < SIDE_ZONE) side = 'left';
      else if (px > box.width - SIDE_ZONE) side = 'right';
      // Changing shape moves the grip, so the hold point resets when it docks or undocks.
      if (side !== (cfg.dock && cfg.dock.side) ) { drag.dx = 22; drag.dy = 22; }
      cfg.dock = { x: px - drag.dx, y: e.clientY - box.top - drag.dy, side: side };
      placeDock();
    });
    function end(e) {
      if (!drag || e.pointerId !== drag.id) return;
      drag = null;
      dom.dock.classList.remove('dragging');
      saveSettings();
    }
    grip.addEventListener('pointerup', end);
    grip.addEventListener('pointercancel', end);
  }

  // ---------- Pages ----------

  function newPage(paper) {
    var last = pages[pages.length - 1], page = { id: Ink.uid(), noteId: note.id, paper: paper, tint: last ? last.tint : undefined, items: [] };
    if (last && last.layout) { page.layout = last.layout; page.h = last.layout === 'landscape' ? 707 : PH; }
    return page;
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
        c.width = 180; c.height = Math.round(180 * H(page) / PW);
        var ctx = c.getContext('2d');
        ctx.setTransform(c.width / PW, 0, 0, c.width / PW, 0, 0);
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

  var TINTS = [
    ['White', '#ffffff'], ['Soft blue', '#e8f3fa'], ['Warm sand', '#f6efe4'], ['Blush', '#faeeee'], ['Sage', '#eef3ea'], ['Soft grey', '#f0f0ee']
  ];

  function paperColour(page) {
    UI.sheet('Paper colour', TINTS.map(function (t) {
      return { label: t[0], value: t[1], checked: (page.tint || '#ffffff') === t[1] };
    }).concat([{ label: 'Use the current colour on every page', value: 'all' }])).then(function (c) {
      if (!c) return;
      var list = c === 'all' ? pages : [page], tint = c === 'all' ? page.tint : c;
      list.forEach(function (p) {
        p.tint = tint;
        refresh(p);
        markDirty(p);
      });
    });
  }

  function moreMenu() {
    var page = currentPage().page;
    UI.sheet('Note options', [
      { label: rec ? 'Stop recording' : 'Record audio', icon: 'mic', value: rec ? 'stoprec' : 'rec' },
      (note.recordings || []).length ? { label: 'Recordings', icon: 'mic', hint: String(note.recordings.length), value: 'recs' } : null,
      { label: 'Insert', icon: 'image', value: 'insert' },
      { label: 'Export or share', icon: 'share', value: 'export' },
      { label: 'Add sticky note', icon: 'notes', value: 'sticky' },
      clipboard.length ? { label: 'Paste', icon: 'clip', value: 'paste' } : null,
      { label: 'Page format', icon: 'pages', value: 'format' },
      { label: 'Page size', icon: 'pages', value: 'size' },
      { label: 'Paper colour', icon: 'shape', value: 'tint' },
      { label: 'Customise toolbar', icon: 'sliders', value: 'custom' },
      { label: 'Reset toolbar position', icon: 'grip', value: 'dock' },
      { heading: 'Pen' },
      { label: 'Shape correction', hint: cfg.shapeFix ? 'On' : 'Off', value: 'shapefix' },
      { label: 'Draw with finger', hint: cfg.fingerDraw ? 'On' : 'Off', value: 'finger' },
      { label: 'Low-latency ink', hint: cfg.lowLatency ? 'On' : 'Off', value: 'latency' },
      { label: 'Pen check', hint: 'After you write a stroke', value: 'check' }
    ].filter(Boolean)).then(function (v) {
      if (!v) return;
      if (v === 'insert') insertMenu();
      else if (v === 'export') exportMenu();
      else if (v === 'rec') startRecording();
      else if (v === 'stoprec') stopRecording();
      else if (v === 'recs') recordingsMenu();
      else if (v === 'size') pageSize(page);
      else if (v === 'sticky') addSticky();
      else if (v === 'paste') pasteClipboard();
      else if (v === 'custom') customiseToolbar();
      else if (v === 'tint') paperColour(page);
      else if (v === 'shapefix') {
        cfg.shapeFix = !cfg.shapeFix;
        saveSettings();
        UI.toast(cfg.shapeFix ? 'Rough lines, rectangles and circles will be tidied.' : 'Shape correction is off.');
      } else if (v === 'format') {
        UI.formatPicker('Page format', page.paper, true).then(function (r) {
          if (r) setPaper(r.all ? 'all' : 'page', r.id);
        });
      } else if (v === 'dock') {
        cfg.dock = null;
        saveSettings();
        placeDock();
      } else if (v === 'finger') {
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
      ['Pen side button', penButtonSeen ? 'Detected' : 'Not detected yet'],
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
    dom.dock = document.getElementById('dock');
    dom.editor = document.getElementById('editor');
    dom.pullHint = document.getElementById('pullHint');
    dom.richBar = document.getElementById('richBar');
    dom.recBar = document.getElementById('recBar');
    buildRichBar();
    bindDock();
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
      placeDock();
    });
    document.addEventListener('visibilitychange', function () {
      if (document.visibilityState === 'hidden' && note) { commitText(); flush(); }
    });
    window.addEventListener('pagehide', function () { if (note) { commitText(); flush(); } });
    document.addEventListener('keydown', function (e) {
      if (!note || e.target.matches('input,textarea,[contenteditable]')) return;
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
      if (r[0].lock && !unlocked[noteId]) {
        return UI.prompt('This note is locked. Enter its password.', '', 'Open', 'password').then(function (pw) {
          if (!pw) return 'locked';
          return Folio.Docs.checkLock(r[0].lock, pw).then(function (ok) {
            if (!ok) { UI.toast('That password is not right.'); return 'locked'; }
            unlocked[noteId] = true;
            return begin(r);
          });
        });
      }
      return begin(r);
    });
  }

  function begin(r) {
    {
      note = r[0];
      var order = note.pageIds || [];
      // A page from another device that isn't in the order yet goes last rather than first.
      function rank(p) { var i = order.indexOf(p.id); return i < 0 ? order.length : i; }
      pages = r[1].slice().sort(function (a, b) { return rank(a) - rank(b); });
      if (!pages.length) {
        pages = [newPage(note.paper || 'lined')];
        dirty.add(pages[0].id);
      }
      hist = []; future = []; sel = null; textEd = null; act = null; zoom = 1;
      touches.clear(); gesture = null;
      dom.title.value = note.title || '';
      var readOnly = !!(note.shared && !note.shared.canEdit);
      dom.editor.classList.toggle('readonly', readOnly);
      dom.title.readOnly = readOnly;
      dom.zoomLabel.hidden = true;
      setStatus('Saved on this device');
      updateUndoButtons();
      buildToolbar();
      dom.scroller.dataset.tool = cfg.tool;
      measureBase();
      buildViews();
      dom.scroller.scrollTop = 0;
      return true;
    }
  }

  function close() {
    if (!note) return Promise.resolve();
    commitText();
    clearSelection();
    cancelMomentum();
    clearPull();
    stopRecording();
    closePlayer();
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
