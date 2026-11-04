// Folio ink: page geometry and drawing. No DOM state or storage in here.
(function () {
  'use strict';
  var PW = 1000, PH = 1414;

  function uid() {
    if (crypto.randomUUID) return crypto.randomUUID();
    return 'id-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
  }

  function pressureWidth(w, p) { return w * (0.45 + p * 1.1); }

  function drawPaper(ctx, paper) {
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, PW, PH);
    ctx.lineWidth = 1;
    var x, y;
    if (paper === 'lined') {
      ctx.strokeStyle = '#d7dde3';
      ctx.beginPath();
      for (y = 96; y < PH - 30; y += 44) { ctx.moveTo(0, y); ctx.lineTo(PW, y); }
      ctx.stroke();
    } else if (paper === 'grid') {
      ctx.strokeStyle = '#e1e6ea';
      ctx.beginPath();
      for (y = 40; y < PH; y += 40) { ctx.moveTo(0, y); ctx.lineTo(PW, y); }
      for (x = 40; x < PW; x += 40) { ctx.moveTo(x, 0); ctx.lineTo(x, PH); }
      ctx.stroke();
    } else if (paper === 'dots') {
      ctx.fillStyle = '#bcc5cd';
      for (y = 40; y < PH; y += 40) {
        for (x = 40; x < PW; x += 40) { ctx.fillRect(x - 1, y - 1, 2.4, 2.4); }
      }
    }
  }

  // Draws freehand segments from index `from` onward, so live ink can add to itself.
  function drawInk(ctx, s, from) {
    var pts = s.pts, n = pts.length / 3;
    if (!n) return;
    var pencil = s.tool === 'pencil';
    ctx.save();
    ctx.strokeStyle = ctx.fillStyle = s.color;
    ctx.lineJoin = 'round';
    ctx.lineCap = pencil ? 'butt' : 'round';
    if (pencil) ctx.globalAlpha = 0.74;
    if (n === 1) {
      ctx.beginPath();
      ctx.arc(pts[0], pts[1], pressureWidth(s.width, pts[2]) / 2, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
      return;
    }
    for (var k = Math.max(1, from || 1); k < n; k++) {
      var cx = pts[(k - 1) * 3], cy = pts[(k - 1) * 3 + 1], cp = pts[(k - 1) * 3 + 2];
      var nx = pts[k * 3], ny = pts[k * 3 + 1];
      var ax = cx, ay = cy;
      if (k > 1) { ax = (pts[(k - 2) * 3] + cx) / 2; ay = (pts[(k - 2) * 3 + 1] + cy) / 2; }
      var bx = (cx + nx) / 2, by = (cy + ny) / 2;
      ctx.lineWidth = pressureWidth(s.width, cp) * (pencil ? 0.8 : 1);
      ctx.beginPath();
      ctx.moveTo(ax, ay);
      ctx.quadraticCurveTo(cx, cy, bx, by);
      if (k === n - 1) ctx.lineTo(nx, ny);
      ctx.stroke();
      if (pencil) {
        // Fixed, index-based grain so a redraw never changes how the pencil looks.
        var h = Math.sin(k * 12.9898) * 43758.5453;
        h -= Math.floor(h);
        var off = (h - 0.5) * ctx.lineWidth * 1.3;
        ctx.globalAlpha = 0.28;
        ctx.fillRect(bx + off, by - off, 0.9, 0.9);
        ctx.globalAlpha = 0.74;
      }
    }
    ctx.restore();
  }

  function drawHighlighter(ctx, s) {
    var pts = s.pts, n = pts.length / 3;
    if (!n) return;
    ctx.save();
    ctx.globalCompositeOperation = 'multiply';
    ctx.globalAlpha = 0.42;
    ctx.strokeStyle = s.color;
    ctx.lineWidth = s.width;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(pts[0], pts[1]);
    if (n === 1) ctx.lineTo(pts[0] + 0.1, pts[1]);
    for (var k = 1; k < n; k++) {
      var cx = pts[(k - 1) * 3], cy = pts[(k - 1) * 3 + 1];
      ctx.quadraticCurveTo(cx, cy, (cx + pts[k * 3]) / 2, (cy + pts[k * 3 + 1]) / 2);
    }
    if (n > 1) ctx.lineTo(pts[(n - 1) * 3], pts[(n - 1) * 3 + 1]);
    ctx.stroke();
    ctx.restore();
  }

  function drawShape(ctx, s) {
    ctx.save();
    ctx.strokeStyle = s.color;
    ctx.lineWidth = s.width;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    var x = Math.min(s.x1, s.x2), y = Math.min(s.y1, s.y2);
    var w = Math.abs(s.x2 - s.x1), h = Math.abs(s.y2 - s.y1);
    if (s.shape === 'rect') {
      ctx.rect(x, y, w, h);
    } else if (s.shape === 'ellipse') {
      ctx.ellipse(x + w / 2, y + h / 2, w / 2, h / 2, 0, 0, Math.PI * 2);
    } else {
      ctx.moveTo(s.x1, s.y1);
      ctx.lineTo(s.x2, s.y2);
      if (s.shape === 'arrow') {
        var a = Math.atan2(s.y2 - s.y1, s.x2 - s.x1), len = 12 + s.width * 3;
        ctx.moveTo(s.x2, s.y2);
        ctx.lineTo(s.x2 - len * Math.cos(a - 0.45), s.y2 - len * Math.sin(a - 0.45));
        ctx.moveTo(s.x2, s.y2);
        ctx.lineTo(s.x2 - len * Math.cos(a + 0.45), s.y2 - len * Math.sin(a + 0.45));
      }
    }
    ctx.stroke();
    ctx.restore();
  }

  var FONT = 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
  var LINE = 1.35;

  function wrapText(ctx, s) {
    ctx.font = s.size + 'px ' + FONT;
    var lines = [];
    String(s.text).split('\n').forEach(function (para) {
      var line = '';
      para.split(' ').forEach(function (word) {
        var attempt = line ? line + ' ' + word : word;
        if (line && ctx.measureText(attempt).width > s.w) { lines.push(line); line = word; }
        else line = attempt;
      });
      lines.push(line);
    });
    return lines;
  }

  function drawText(ctx, s) {
    ctx.save();
    ctx.fillStyle = s.color;
    ctx.textBaseline = 'top';
    wrapText(ctx, s).forEach(function (line, i) {
      ctx.fillText(line, s.x, s.y + i * s.size * LINE);
    });
    ctx.restore();
  }

  function drawItem(ctx, it, assets) {
    if (it.type === 'stroke') {
      if (it.tool === 'highlighter') drawHighlighter(ctx, it);
      else drawInk(ctx, it, 1);
    } else if (it.type === 'shape') {
      drawShape(ctx, it);
    } else if (it.type === 'text') {
      drawText(ctx, it);
    } else if (it.type === 'image') {
      var img = assets && assets[it.asset];
      if (img) {
        ctx.drawImage(img, it.x, it.y, it.w, it.h);
      } else {
        ctx.save();
        ctx.fillStyle = '#eef1f3';
        ctx.fillRect(it.x, it.y, it.w, it.h);
        ctx.restore();
      }
    }
  }

  function bbox(it, ctx) {
    if (it.type === 'stroke') {
      var a = Infinity, b = Infinity, c = -Infinity, d = -Infinity, pad = it.width;
      for (var i = 0; i < it.pts.length; i += 3) {
        a = Math.min(a, it.pts[i]); c = Math.max(c, it.pts[i]);
        b = Math.min(b, it.pts[i + 1]); d = Math.max(d, it.pts[i + 1]);
      }
      return { x: a - pad, y: b - pad, w: c - a + pad * 2, h: d - b + pad * 2 };
    }
    if (it.type === 'shape') {
      var p = it.width + (it.shape === 'arrow' ? 14 : 0);
      return {
        x: Math.min(it.x1, it.x2) - p, y: Math.min(it.y1, it.y2) - p,
        w: Math.abs(it.x2 - it.x1) + p * 2, h: Math.abs(it.y2 - it.y1) + p * 2
      };
    }
    if (it.type === 'text') {
      var lines = ctx ? wrapText(ctx, it).length : String(it.text).split('\n').length;
      return { x: it.x, y: it.y, w: it.w, h: lines * it.size * LINE };
    }
    return { x: it.x, y: it.y, w: it.w, h: it.h };
  }

  function unionBox(items, ctx) {
    if (!items.length) return null;
    var a = Infinity, b = Infinity, c = -Infinity, d = -Infinity;
    items.forEach(function (it) {
      var r = bbox(it, ctx);
      a = Math.min(a, r.x); b = Math.min(b, r.y);
      c = Math.max(c, r.x + r.w); d = Math.max(d, r.y + r.h);
    });
    return { x: a, y: b, w: c - a, h: d - b };
  }

  // Returns a new item moved by (dx, dy), scaled by s about (ox, oy). Items are never mutated.
  function transform(it, dx, dy, s, ox, oy) {
    function X(v) { return ox + (v - ox) * s + dx; }
    function Y(v) { return oy + (v - oy) * s + dy; }
    var c = Object.assign({}, it);
    if (it.type === 'stroke') {
      c.pts = it.pts.slice();
      for (var i = 0; i < c.pts.length; i += 3) { c.pts[i] = X(c.pts[i]); c.pts[i + 1] = Y(c.pts[i + 1]); }
      c.width = it.width * s;
    } else if (it.type === 'shape') {
      c.x1 = X(it.x1); c.y1 = Y(it.y1); c.x2 = X(it.x2); c.y2 = Y(it.y2); c.width = it.width * s;
    } else if (it.type === 'text') {
      c.x = X(it.x); c.y = Y(it.y); c.w = it.w * s; c.size = it.size * s;
    } else {
      c.x = X(it.x); c.y = Y(it.y); c.w = it.w * s; c.h = it.h * s;
    }
    return c;
  }

  function distToSegment(px, py, ax, ay, bx, by) {
    var dx = bx - ax, dy = by - ay, len = dx * dx + dy * dy;
    var t = len ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len)) : 0;
    var qx = ax + t * dx - px, qy = ay + t * dy - py;
    return Math.sqrt(qx * qx + qy * qy);
  }

  function hitsStroke(it, x, y, r) {
    var pts = it.pts, reach = r + it.width / 2, n = pts.length / 3;
    if (n === 1) return Math.hypot(pts[0] - x, pts[1] - y) <= reach;
    for (var k = 1; k < n; k++) {
      if (distToSegment(x, y, pts[(k - 1) * 3], pts[(k - 1) * 3 + 1], pts[k * 3], pts[k * 3 + 1]) <= reach) return true;
    }
    return false;
  }

  function hitsShape(it, x, y, r) {
    var reach = r + it.width;
    if (it.shape === 'line' || it.shape === 'arrow') return distToSegment(x, y, it.x1, it.y1, it.x2, it.y2) <= reach;
    var a = Math.min(it.x1, it.x2), b = Math.min(it.y1, it.y2), c = Math.max(it.x1, it.x2), d = Math.max(it.y1, it.y2);
    if (it.shape === 'ellipse') {
      var rx = (c - a) / 2 || 1, ry = (d - b) / 2 || 1;
      var v = Math.hypot((x - a - rx) / rx, (y - b - ry) / ry);
      return Math.abs(v - 1) * Math.min(rx, ry) <= reach;
    }
    return distToSegment(x, y, a, b, c, b) <= reach || distToSegment(x, y, c, b, c, d) <= reach ||
      distToSegment(x, y, c, d, a, d) <= reach || distToSegment(x, y, a, d, a, b) <= reach;
  }

  function insideBox(it, x, y) {
    var r = bbox(it);
    return x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h;
  }

  // Cuts the part of a stroke under the eraser and returns the pieces that remain.
  function splitStroke(it, x, y, r) {
    var pts = it.pts, n = pts.length / 3, runs = [], cur = [];
    var reach = r + it.width / 2;
    for (var k = 0; k < n; k++) {
      var px = pts[k * 3], py = pts[k * 3 + 1], keep = Math.hypot(px - x, py - y) > reach;
      if (keep && cur.length && k > 0 &&
          distToSegment(x, y, pts[(k - 1) * 3], pts[(k - 1) * 3 + 1], px, py) <= reach) {
        runs.push(cur); cur = [];
      }
      if (keep) cur.push(px, py, pts[k * 3 + 2]);
      else if (cur.length) { runs.push(cur); cur = []; }
    }
    if (cur.length) runs.push(cur);
    return runs.map(function (run) {
      return Object.assign({}, it, { id: uid(), pts: run });
    });
  }

  function pointInPolygon(x, y, poly) {
    var inside = false;
    for (var i = 0, j = poly.length - 2; i < poly.length; j = i, i += 2) {
      var xi = poly[i], yi = poly[i + 1], xj = poly[j], yj = poly[j + 1];
      if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) inside = !inside;
    }
    return inside;
  }

  function insideLasso(it, poly) {
    if (it.type === 'stroke') {
      var hit = 0, total = 0;
      for (var i = 0; i < it.pts.length; i += 3) {
        total++;
        if (pointInPolygon(it.pts[i], it.pts[i + 1], poly)) hit++;
      }
      return total > 0 && hit / total >= 0.5;
    }
    var r = bbox(it);
    return pointInPolygon(r.x + r.w / 2, r.y + r.h / 2, poly);
  }

  window.Folio = window.Folio || {};
  window.Folio.Ink = {
    PW: PW, PH: PH, FONT: FONT, LINE: LINE, uid: uid, drawPaper: drawPaper, drawInk: drawInk,
    drawHighlighter: drawHighlighter, drawShape: drawShape, drawItem: drawItem, bbox: bbox,
    unionBox: unionBox, transform: transform, hitsStroke: hitsStroke, hitsShape: hitsShape,
    insideBox: insideBox, splitStroke: splitStroke, insideLasso: insideLasso
  };
})();
