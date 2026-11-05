// Folio ink: page geometry and drawing. No DOM state or storage in here.
(function () {
  'use strict';
  var PW = 1000, PH = 1414;

  function uid() {
    if (crypto.randomUUID) return crypto.randomUUID();
    return 'id-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
  }

  function pressureWidth(w, p) { return w * (0.45 + p * 1.1); }

  var pageH = PH; // Height of the page being drawn; pages can differ.
  var FORMATS = [
    { id: 'blank', name: 'Blank' }, { id: 'lined', name: 'Lined' }, { id: 'narrow', name: 'Narrow lined' },
    { id: 'wide', name: 'Wide lined' }, { id: 'grid', name: 'Grid' }, { id: 'smallgrid', name: 'Small grid' },
    { id: 'dots', name: 'Dotted' }, { id: 'cornell', name: 'Cornell notes' }, { id: 'twocol', name: 'Two columns' },
    { id: 'lecture', name: 'Lecture' }, { id: 'disease', name: 'Disease' }, { id: 'drug', name: 'Drug' },
    { id: 'anatomy', name: 'Anatomy' }
  ];
  var RULE = '#d9d4cd', RULE_SOFT = '#e7e3dd', HEAD = '#6b4630';
  var lineScale = 1; // Above 1 for small previews, so their lines stay visible.

  function ruled(ctx, x0, x1, y0, y1, gap) {
    ctx.strokeStyle = lineScale > 1 ? '#a9a095' : RULE;
    ctx.lineWidth = lineScale;
    ctx.beginPath();
    for (var y = y0; y < y1; y += gap) { ctx.moveTo(x0, y); ctx.lineTo(x1, y); }
    ctx.stroke();
  }

  function squares(ctx, gap) {
    ctx.strokeStyle = lineScale > 1 ? '#a9a095' : RULE_SOFT;
    ctx.lineWidth = lineScale;
    ctx.beginPath();
    for (var y = gap; y < pageH; y += gap) { ctx.moveTo(0, y); ctx.lineTo(PW, y); }
    for (var x = gap; x < PW; x += gap) { ctx.moveTo(x, 0); ctx.lineTo(x, pageH); }
    ctx.stroke();
  }

  function label(ctx, text, x, y) {
    ctx.fillStyle = HEAD;
    ctx.font = '600 ' + (lineScale > 1 ? 34 : 21) + 'px ' + FONT;
    ctx.textBaseline = 'alphabetic';
    ctx.fillText(text, x, y);
  }

  function divider(ctx, x0, y0, x1, y1) {
    ctx.strokeStyle = '#a98f7c';
    ctx.lineWidth = 1.5 * lineScale;
    ctx.beginPath();
    ctx.moveTo(x0, y0);
    ctx.lineTo(x1, y1);
    ctx.stroke();
  }

  // Stacked sections, each with a printed heading and lines to write on. Weights set their height.
  function sections(ctx, list) {
    var total = list.reduce(function (s, it) { return s + it[1]; }, 0);
    var top = 110, room = pageH - top - 30, y = top;
    ruled(ctx, 50, PW - 50, 86, 87, 44);
    label(ctx, 'Topic', 50, 72);
    list.forEach(function (it) {
      var h = room * it[1] / total;
      label(ctx, it[0], 50, y + 30);
      ruled(ctx, 50, PW - 50, y + 44 + 40, y + h - 6, 40);
      divider(ctx, 50, y + 42, PW - 50, y + 42);
      y += h;
    });
  }

  // Turns a rough freehand stroke into a neat line, rectangle or ellipse, or returns null.
  function recognizeShape(pts) {
    var n = pts.length / 3;
    if (n < 4) return null;
    var length = 0, a = Infinity, b = Infinity, c = -Infinity, d = -Infinity, i;
    for (i = 0; i < n; i++) {
      var x = pts[i * 3], y = pts[i * 3 + 1];
      a = Math.min(a, x); c = Math.max(c, x);
      b = Math.min(b, y); d = Math.max(d, y);
      if (i) length += Math.hypot(x - pts[(i - 1) * 3], y - pts[(i - 1) * 3 + 1]);
    }
    if (length < 60) return null;
    var x0 = pts[0], y0 = pts[1], xn = pts[(n - 1) * 3], yn = pts[(n - 1) * 3 + 1];
    var gap = Math.hypot(xn - x0, yn - y0);
    if (gap / length > 0.94) return { shape: 'line', x1: x0, y1: y0, x2: xn, y2: yn };
    var w = c - a, h = d - b;
    if (gap > length * 0.2 || w < 25 || h < 25) return null;
    var cx = (a + c) / 2, cy = (b + d) / 2, oval = 0, box = 0;
    for (i = 0; i < n; i++) {
      var px = pts[i * 3], py = pts[i * 3 + 1];
      oval += Math.abs(Math.hypot((px - cx) / (w / 2), (py - cy) / (h / 2)) - 1);
      box += Math.min(Math.abs(px - a), Math.abs(px - c), Math.abs(py - b), Math.abs(py - d)) / Math.min(w, h);
    }
    oval /= n; box /= n;
    var bounds = { x1: a, y1: b, x2: c, y2: d };
    if (box < 0.06 && box < oval) return Object.assign({ shape: 'rect' }, bounds);
    if (oval < 0.12) return Object.assign({ shape: 'ellipse' }, bounds);
    return null;
  }

  function drawPaper(ctx, paper, scale, tint, height) {
    lineScale = scale || 1;
    pageH = height || PH;
    ctx.fillStyle = tint || '#ffffff';
    ctx.fillRect(0, 0, PW, pageH);
    ctx.lineWidth = 1;
    var x, y;
    if (paper === 'lined') {
      ruled(ctx, 0, PW, 96, pageH - 30, 44);
    } else if (paper === 'narrow') {
      ruled(ctx, 0, PW, 80, pageH - 20, 32);
    } else if (paper === 'wide') {
      ruled(ctx, 0, PW, 110, pageH - 30, 60);
    } else if (paper === 'grid') {
      squares(ctx, 40);
    } else if (paper === 'smallgrid') {
      squares(ctx, 20);
    } else if (paper === 'dots') {
      ctx.fillStyle = lineScale > 1 ? '#7d746a' : '#b4aca3';
      var dot = 2.4 * lineScale;
      for (y = 40; y < pageH; y += 40) {
        for (x = 40; x < PW; x += 40) { ctx.fillRect(x - dot / 2, y - dot / 2, dot, dot); }
      }
    } else if (paper === 'cornell') {
      ruled(ctx, 300, PW, 140, 1120, 44);
      divider(ctx, 0, 96, PW, 96);
      divider(ctx, 280, 96, 280, 1140);
      divider(ctx, 0, 1140, PW, 1140);
      label(ctx, 'Topic', 30, 66);
      label(ctx, 'Cues and questions', 30, 130);
      label(ctx, 'Notes', 300, 130);
      label(ctx, 'Summary', 30, 1174);
    } else if (paper === 'twocol') {
      ruled(ctx, 0, 482, 96, pageH - 30, 44);
      ruled(ctx, 518, PW, 96, pageH - 30, 44);
      divider(ctx, 500, 40, 500, pageH - 40);
    } else if (paper === 'lecture') {
      label(ctx, 'Slide or diagram', 50, 62);
      ctx.strokeStyle = '#a98f7c';
      ctx.lineWidth = 1.5 * lineScale;
      ctx.strokeRect(50, 80, PW - 100, 500);
      label(ctx, 'Notes', 50, 630);
      ruled(ctx, 50, PW - 50, 672, pageH - 30, 44);
    } else if (paper === 'disease') {
      sections(ctx, [['Definition', 1], ['Causes and risk factors', 1.2], ['Pathophysiology', 1.5], ['Symptoms and signs', 1.4], ['Investigations', 1.2], ['Management', 1.4], ['Complications', 1]]);
    } else if (paper === 'drug') {
      sections(ctx, [['Name and class', .8], ['Mechanism of action', 1.3], ['Indications', 1.1], ['Dose and route', 1], ['Side effects', 1.3], ['Contraindications', 1], ['Interactions', 1]]);
    } else if (paper === 'anatomy') {
      label(ctx, 'Structure', 50, 62);
      ctx.strokeStyle = '#a98f7c';
      ctx.lineWidth = 1.5 * lineScale;
      ctx.strokeRect(50, 80, PW - 100, 720);
      label(ctx, 'Labels', 50, 850);
      ruled(ctx, 50, 480, 892, 1110, 40);
      ruled(ctx, 520, PW - 50, 892, 1110, 40);
      label(ctx, 'Clinical relevance', 50, 1140);
      ruled(ctx, 50, PW - 50, 1182, pageH - 30, 40);
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
      ctx.lineWidth = s.tool === 'fountain'
        // A slanted nib: thick or thin depending on the direction of the stroke.
        ? s.width * (0.3 + 1.05 * Math.abs(Math.sin(Math.atan2(ny - cy, nx - cx) - Math.PI / 4))) * (0.75 + cp * 0.5)
        : s.tool === 'brush'
          // Very pressure-sensitive, from a hairline to a broad sweep.
          ? s.width * (0.12 + cp * cp * 2.4)
          : pressureWidth(s.width, cp) * (pencil ? 0.8 : 1);
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

  // ---------- Formatted text ----------
  // Formatted notes are kept as a small, safe subset of HTML and drawn onto the page by hand.

  var ALLOWED = { B: 1, STRONG: 1, I: 1, EM: 1, U: 1, FONT: 1, DIV: 1, P: 1, BR: 1, UL: 1, OL: 1, LI: 1, TABLE: 1, TBODY: 1, TR: 1, TD: 1 };
  var DROPPED = { SCRIPT: 1, STYLE: 1, IFRAME: 1, OBJECT: 1, EMBED: 1, SVG: 1, MATH: 1, LINK: 1, META: 1 };
  var FONT_SCALE = { 1: 0.7, 2: 0.85, 3: 1, 4: 1.2, 5: 1.5, 6: 2, 7: 2.6 };

  function cleanNode(node, doc, out) {
    Array.prototype.forEach.call(node.childNodes, function (child) {
      if (child.nodeType === 3) { out.appendChild(doc.createTextNode(child.nodeValue)); return; }
      if (child.nodeType !== 1 || DROPPED[child.tagName]) return;
      if (!ALLOWED[child.tagName]) { cleanNode(child, doc, out); return; }
      var copy = doc.createElement(child.tagName);
      if (child.tagName === 'FONT') {
        var color = child.getAttribute('color'), size = child.getAttribute('size');
        if (color && /^#[0-9a-f]{3,8}$/i.test(color)) copy.setAttribute('color', color);
        if (FONT_SCALE[size]) copy.setAttribute('size', size);
      }
      cleanNode(child, doc, copy);
      out.appendChild(copy);
    });
  }

  function cleanHtml(html) {
    var doc = new DOMParser().parseFromString('<body>' + String(html) + '</body>', 'text/html');
    var out = doc.createElement('div');
    cleanNode(doc.body, doc, out);
    return out.innerHTML;
  }

  function collectBlocks(node, st, list, indent, state) {
    Array.prototype.forEach.call(node.childNodes, function (child) {
      if (child.nodeType === 3) {
        if (!child.nodeValue) return;
        if (!state.cur) {
          if (!child.nodeValue.trim()) return;
          state.cur = { runs: [], indent: indent };
          list.push(state.cur);
        }
        state.cur.runs.push(Object.assign({ text: child.nodeValue }, st));
        return;
      }
      if (child.nodeType !== 1) return;
      var tag = child.tagName, next = Object.assign({}, st);
      if (tag === 'B' || tag === 'STRONG') next.b = true;
      else if (tag === 'I' || tag === 'EM') next.i = true;
      else if (tag === 'U') next.u = true;
      else if (tag === 'FONT') {
        if (child.getAttribute('color')) next.color = child.getAttribute('color');
        if (child.getAttribute('size')) next.scale = FONT_SCALE[child.getAttribute('size')] || 1;
      }
      if (tag === 'BR') {
        if (!state.cur) list.push({ runs: [], indent: indent });
        state.cur = null;
      } else if (tag === 'DIV' || tag === 'P') {
        state.cur = null;
        collectBlocks(child, next, list, indent, state);
        state.cur = null;
      } else if (tag === 'UL' || tag === 'OL') {
        state.cur = null;
        var n = 0;
        Array.prototype.forEach.call(child.children, function (li) {
          n++;
          state.cur = { runs: [], indent: indent + 1, prefix: tag === 'OL' ? n + '.' : '•' };
          list.push(state.cur);
          collectBlocks(li, next, list, indent + 1, state);
          state.cur = null;
        });
      } else if (tag === 'TABLE') {
        state.cur = null;
        var rows = Array.prototype.map.call(child.querySelectorAll('tr'), function (tr) {
          return Array.prototype.map.call(tr.children, function (td) {
            var cell = [];
            collectBlocks(td, next, cell, 0, { cur: null });
            return cell;
          });
        });
        list.push({ table: rows });
      } else {
        collectBlocks(child, next, list, indent, state);
      }
    });
  }

  function fontOf(run, size) {
    return (run.i ? 'italic ' : '') + (run.b ? '700 ' : '') + size * (run.scale || 1) + 'px ' + FONT;
  }

  // Lays the blocks out from y, drawing them if asked. Returns the height, and records each line.
  function layoutBlocks(ctx, blocks, s, x, y, w, draw, lines) {
    var top = y;
    blocks.forEach(function (block) {
      if (block.table) {
        var cols = block.table.reduce(function (m, r) { return Math.max(m, r.length); }, 1), cw = w / cols, pad = s.size * 0.3;
        block.table.forEach(function (row) {
          var rowH = s.size * LINE + pad * 2;
          row.forEach(function (cell) {
            rowH = Math.max(rowH, layoutBlocks(ctx, cell, s, 0, 0, cw - pad * 2, false, []) + pad * 2);
          });
          row.forEach(function (cell, c) {
            if (draw) {
              ctx.strokeStyle = '#8f7c6e';
              ctx.lineWidth = 1.2;
              ctx.strokeRect(x + c * cw, y, cw, rowH);
            }
            layoutBlocks(ctx, cell, s, x + c * cw + pad, y + pad, cw - pad * 2, draw, lines);
          });
          y += rowH;
        });
        y += s.size * 0.3;
        return;
      }
      var inset = block.indent * s.size * 1.2, left = x + inset, width = Math.max(s.size, w - inset);
      var line = [], lineW = 0, lineH = s.size * LINE, first = true;
      function flush() {
        if (draw) {
          if (first && block.prefix) {
            ctx.font = s.size + 'px ' + FONT;
            ctx.fillStyle = s.color;
            ctx.fillText(block.prefix, left - s.size * 0.95, y);
          }
          var cx = left;
          line.forEach(function (seg) {
            ctx.font = seg.font;
            ctx.fillStyle = seg.color;
            ctx.fillText(seg.text, cx, y);
            if (seg.u) ctx.fillRect(cx, y + seg.h * 0.82, seg.w, Math.max(1, seg.h * 0.05));
            cx += seg.w;
          });
        }
        lines.push({ x: left, y: y, h: lineH, text: line.map(function (seg) { return seg.text; }).join('') });
        y += lineH;
        line = []; lineW = 0; lineH = s.size * LINE; first = false;
      }
      block.runs.forEach(function (run) {
        var size = s.size * (run.scale || 1), font = fontOf(run, s.size);
        ctx.font = font;
        run.text.split(/(\s+)/).forEach(function (word) {
          if (!word) return;
          var ww = ctx.measureText(word).width;
          if (lineW && lineW + ww > width && word.trim()) { flush(); ctx.font = font; }
          if (!lineW && !word.trim()) return;
          line.push({ text: word, font: font, color: run.color || s.color, u: run.u, w: ww, h: size * LINE });
          lineW += ww;
          lineH = Math.max(lineH, size * LINE);
        });
      });
      flush();
    });
    return y - top;
  }

  function richLayout(ctx, s, draw) {
    var blocks = [], lines = [];
    var doc = new DOMParser().parseFromString('<body>' + cleanHtml(s.html) + '</body>', 'text/html');
    collectBlocks(doc.body, {}, blocks, 0, { cur: null });
    ctx.save();
    ctx.textBaseline = 'top';
    var h = layoutBlocks(ctx, blocks, s, s.x, s.y, s.w, draw, lines);
    ctx.restore();
    return { height: h, lines: lines };
  }

  function textHeight(ctx, s) {
    return s.html ? richLayout(ctx, s, false).height : wrapText(ctx, s).length * s.size * LINE;
  }

  function drawText(ctx, s) {
    ctx.save();
    if (s.bg) {
      // A sticky note: a coloured square behind the words.
      var h = Math.max(s.minH || 0, textHeight(ctx, s));
      ctx.fillStyle = s.bg;
      ctx.fillRect(s.x - 16, s.y - 16, s.w + 32, h + 32);
    }
    if (s.html) {
      richLayout(ctx, s, true);
    } else {
      var lines = wrapText(ctx, s);
      ctx.fillStyle = s.color;
      ctx.textBaseline = 'top';
      lines.forEach(function (line, i) {
        ctx.fillText(line, s.x, s.y + i * s.size * LINE);
      });
    }
    ctx.restore();
  }

  // Which checkbox, counting from the start of this text, sits under a point? -1 if none.
  function checkboxAt(ctx, s, px, py) {
    var lines = s.html ? richLayout(ctx, s, false).lines : wrapText(ctx, s).map(function (text, i) {
      return { x: s.x, y: s.y + i * s.size * LINE, h: s.size * LINE, text: text };
    });
    var count = 0;
    for (var i = 0; i < lines.length; i++) {
      var boxes = lines[i].text.match(/[☐☑]/g);
      if (boxes && py >= lines[i].y && py < lines[i].y + lines[i].h && px >= lines[i].x - 6 && px <= lines[i].x + s.size * 1.6) return count;
      if (boxes) count += boxes.length;
    }
    return -1;
  }

  function toggleBox(str, index) {
    var n = -1;
    return String(str).replace(/[☐☑]/g, function (c) {
      n++;
      return n === index ? (c === '☐' ? '☑' : '☐') : c;
    });
  }

  function drawAttachment(ctx, it) {
    ctx.save();
    ctx.fillStyle = it.kind === 'link' ? '#e6f1f8' : '#f6efe4';
    ctx.strokeStyle = '#8f7c6e';
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.roundRect(it.x, it.y, it.w, it.h, 12);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = '#2e1f17';
    ctx.textBaseline = 'middle';
    ctx.font = '600 22px ' + FONT;
    var label = (it.kind === 'link' ? 'Link: ' : 'File: ') + it.name;
    while (label.length > 8 && ctx.measureText(label).width > it.w - 32) label = label.slice(0, -2);
    ctx.fillText(label, it.x + 16, it.y + it.h / 2);
    ctx.restore();
  }

  // Paper, any imported PDF page, then everything on top.
  function drawPage(ctx, page, assets) {
    drawPaper(ctx, page.paper, 1, page.tint, page.h || PH);
    if (page.bg) {
      var bg = assets && assets[page.bg.asset];
      if (bg) {
        ctx.drawImage(bg, page.bg.x, page.bg.y, page.bg.w, page.bg.h);
      } else {
        // The PDF itself stays on the device it was imported on.
        ctx.fillStyle = '#eef1f3';
        ctx.fillRect(page.bg.x, page.bg.y, page.bg.w, page.bg.h);
        ctx.fillStyle = '#65554a';
        ctx.textBaseline = 'top';
        ctx.font = '24px ' + FONT;
        ctx.fillText('This PDF page is on another device.', page.bg.x + 30, page.bg.y + 30);
      }
    }
    page.items.forEach(function (it) { drawItem(ctx, it, assets); });
  }

  function drawItem(ctx, it, assets) {
    if (it.type === 'stroke') {
      if (it.tool === 'highlighter') drawHighlighter(ctx, it);
      else drawInk(ctx, it, 1);
    } else if (it.type === 'shape') {
      drawShape(ctx, it);
    } else if (it.type === 'text') {
      drawText(ctx, it);
    } else if (it.type === 'attach') {
      drawAttachment(ctx, it);
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
      var a = Infinity, b = Infinity, c = -Infinity, d = -Infinity, pad = it.width * 1.5;
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
      if (it.bg) {
        var noteH = ctx ? textHeight(ctx, it) : String(it.text).split('\n').length * it.size * LINE;
        return { x: it.x - 16, y: it.y - 16, w: it.w + 32, h: Math.max(it.minH || 0, noteH) + 32 };
      }
      if (!ctx) return { x: it.x, y: it.y, w: it.w, h: String(it.text).split('\n').length * it.size * LINE };
      if (it.html) return { x: it.x, y: it.y, w: it.w, h: textHeight(ctx, it) };
      // Measured, so the box hugs the words and a tap beside short text can start a new box.
      var wrapped = wrapText(ctx, it), widest = 0;
      wrapped.forEach(function (line) { widest = Math.max(widest, ctx.measureText(line).width); });
      return { x: it.x, y: it.y, w: Math.min(it.w, Math.max(widest, it.size)), h: wrapped.length * it.size * LINE };
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
    PW: PW, PH: PH, FONT: FONT, LINE: LINE, FORMATS: FORMATS, recognizeShape: recognizeShape, uid: uid,
    drawPage: drawPage, cleanHtml: cleanHtml, checkboxAt: checkboxAt, toggleBox: toggleBox, drawPaper: drawPaper, drawInk: drawInk,
    drawHighlighter: drawHighlighter, drawShape: drawShape, drawItem: drawItem, bbox: bbox,
    unionBox: unionBox, transform: transform, hitsStroke: hitsStroke, hitsShape: hitsShape,
    insideBox: insideBox, splitStroke: splitStroke, insideLasso: insideLasso
  };
})();
