// Folio UI helpers: icons, element builder, dialogs and toasts.
(function () {
  'use strict';
  var I = {
    back: '<path d="M15 5l-7 7 7 7"/>',
    undo: '<path d="M9 7L4 12l5 5"/><path d="M4 12h10a6 6 0 0 1 6 6"/>',
    redo: '<path d="M15 7l5 5-5 5"/><path d="M20 12H10a6 6 0 0 0-6 6"/>',
    pages: '<rect x="8" y="3" width="12" height="15" rx="1.5"/><path d="M4 8v11.5A1.5 1.5 0 0 0 5.500 21H15"/>',
    more: '<circle cx="5" cy="12" r="1.4"/><circle cx="12" cy="12" r="1.4"/><circle cx="19" cy="12" r="1.4"/>',
    pen: '<path d="M4 20l1-5L16.500 3.500a2.100 2.100 0 0 1 3 0l1 1a2.100 2.100 0 0 1 0 3L9 19z"/><path d="M14.500 5.500l4 4"/>',
    pencil: '<path d="M4 20l1.500-5.500L15 5l4 4-9.500 9.500z"/><path d="M5.500 14.500l4 4"/><path d="M13 7l4 4"/>',
    highlighter: '<path d="M9 14l-4 4v2h6l3-3"/><path d="M9 14L18 4l3 3-10 9.500z"/><path d="M4 22h16"/>',
    eraser: '<path d="M8 20l-4.500-4.500a2 2 0 0 1 0-2.800L13 3.200a2 2 0 0 1 2.800 0l5 5a2 2 0 0 1 0 2.800L12 20z"/><path d="M8 8l8 8"/><path d="M8 20h13"/>',
    lasso: '<path d="M5 15C2.500 9 7 4 13 4s9 4 8 8-7 6-11 5"/><circle cx="7.500" cy="17.500" r="2"/><path d="M7.500 19.500c0 1.500 1 2.500 2.500 2.500"/>',
    shape: '<rect x="3.500" y="3.500" width="10" height="10" rx="1"/><circle cx="15.500" cy="15.500" r="5"/>',
    text: '<path d="M5 6V4h14v2"/><path d="M12 4v16"/><path d="M9 20h6"/>',
    image: '<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="8.500" cy="9.500" r="1.500"/><path d="M21 16l-5-5L5 20"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    folder: '<path d="M3 7a2 2 0 0 1 2-2h4l2 2.500h8a2 2 0 0 1 2 2V18a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>',
    notes: '<rect x="5" y="3" width="14" height="18" rx="2"/><path d="M9 8h6M9 12h6M9 16h4"/>',
    star: '<path d="M12 3.500l2.600 5.400 5.900.800-4.300 4.100 1 5.900-5.200-2.800-5.200 2.800 1-5.900-4.300-4.100 5.900-.800z"/>',
    trash: '<path d="M4 7h16"/><path d="M9 7V4h6v3"/><path d="M6.500 7l1 13h9l1-13"/>',
    search: '<circle cx="11" cy="11" r="6.500"/><path d="M16 16l4.500 4.500"/>',
    menu: '<path d="M4 7h16M4 12h16M4 17h16"/>',
    copy: '<rect x="9" y="9" width="11" height="11" rx="1.500"/><path d="M5 15H4V4h11v1"/>',
    up: '<path d="M12 19V5M6 11l6-6 6 6"/>',
    down: '<path d="M12 5v14M6 13l6 6 6-6"/>',
    fountain: '<path d="M12 21v-7"/><path d="M12 14a1.500 1.500 0 1 0 0-3 1.500 1.500 0 0 0 0 3z"/><path d="M7 11l5-8 5 8-2.500 7h-5z"/>',
    brush: '<path d="M20.500 3.500c-4 1.500-8 5-10.500 8.500l2.500 2.500c3.500-2.500 7-6.500 8-11z"/><path d="M10 12c-2.500.500-3.500 2-4 4-.300 1.200-1 2-2.500 2.500 2.500 1.500 8 1.500 9-4z"/>',
    dropper: '<path d="M14 6l4 4"/><path d="M12.500 7.500l4 4L8 20H4v-4z"/><path d="M15 5l1.500-1.500a2.100 2.100 0 0 1 3 0l1 1a2.100 2.100 0 0 1 0 3L19 9"/>',
    clip: '<rect x="6" y="5" width="12" height="16" rx="2"/><path d="M9 5a3 3 0 0 1 6 0"/>',
    sliders: '<path d="M4 7h10M18 7h2M4 17h2M10 17h10"/><circle cx="16" cy="7" r="2"/><circle cx="8" cy="17" r="2"/>',
    pin: '<path d="M12 16v5"/><path d="M8 3h8l-1 7 3 3v3H6v-3l3-3z"/>',
    tag: '<path d="M3 12V4h8l10 10-8 8z"/><circle cx="8" cy="9" r="1.300"/>',
    mic: '<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0"/><path d="M12 18v3"/>',
    lock: '<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>',
    share: '<circle cx="6" cy="12" r="2.500"/><circle cx="18" cy="6" r="2.500"/><circle cx="18" cy="18" r="2.500"/><path d="M8.300 11l7.400-3.800M8.300 13l7.400 3.800"/>',
    camera: '<path d="M4 8h3l2-3h6l2 3h3v11H4z"/><circle cx="12" cy="13" r="3.500"/>',
    file: '<path d="M7 3h7l5 5v13H7z"/><path d="M14 3v5h5"/>',
    link: '<path d="M10 14a4 4 0 0 0 6 .500l3-3a4 4 0 0 0-6-6l-1 1"/><path d="M14 10a4 4 0 0 0-6-.500l-3 3a4 4 0 0 0 6 6l1-1"/>',
    crop: '<path d="M7 2v15h15"/><path d="M2 7h15v15"/>',
    grip: '<circle cx="9" cy="6" r="1.2"/><circle cx="15" cy="6" r="1.2"/><circle cx="9" cy="12" r="1.2"/><circle cx="15" cy="12" r="1.2"/><circle cx="9" cy="18" r="1.2"/><circle cx="15" cy="18" r="1.2"/>',
    rect: '<rect x="4" y="6" width="16" height="12" rx="1"/>',
    ellipse: '<ellipse cx="12" cy="12" rx="9" ry="6.500"/>',
    line: '<path d="M5 19L19 5"/>',
    curve: '<path d="M4 18C8 4 16 20 20 6"/>',
    arrow: '<path d="M5 19L19 5"/><path d="M10 5h9v9"/>'
  };

  function icon(name) {
    return '<svg class="ic" viewBox="0 0 24 24" aria-hidden="true">' + (I[name] || '') + '</svg>';
  }

  // el('div.cls', {attrs}, child, child...). Strings become text, so user text is never parsed as HTML.
  function el(spec, attrs) {
    var parts = spec.split('.');
    var node = document.createElement(parts[0] || 'div');
    if (parts.length > 1) node.className = parts.slice(1).join(' ');
    var a = attrs || {};
    Object.keys(a).forEach(function (k) {
      if (k === 'on') {
        Object.keys(a.on).forEach(function (ev) { node.addEventListener(ev, a.on[ev]); });
      } else if (k === 'html') {
        node.innerHTML = a.html; // Only ever used with the fixed icon strings above.
      } else if (k === 'text') {
        node.textContent = a.text;
      } else if (a[k] !== undefined && a[k] !== null && a[k] !== false) {
        node.setAttribute(k, a[k] === true ? '' : a[k]);
      }
    });
    for (var i = 2; i < arguments.length; i++) {
      var c = arguments[i];
      if (c === null || c === undefined || c === false) continue;
      node.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
    }
    return node;
  }

  function showDialog(build) {
    return new Promise(function (resolve) {
      var dlg = el('dialog.dlg');
      var finished = false;
      function done(value) {
        if (finished) return;
        finished = true;
        dlg.close();
        dlg.remove();
        resolve(value);
      }
      build(dlg, done);
      dlg.addEventListener('cancel', function (e) { e.preventDefault(); done(null); });
      dlg.addEventListener('click', function (e) { if (e.target === dlg) done(null); });
      document.body.appendChild(dlg);
      dlg.showModal();
    });
  }

  function prompt(title, value, okLabel, inputType) {
    return showDialog(function (dlg, done) {
      var isUrl = inputType === 'url';
      var input = el('input.field', { type: isUrl ? 'text' : inputType || 'text', inputmode: isUrl ? 'url' : null, autocapitalize: isUrl ? 'off' : null, maxlength: isUrl ? 2000 : 120, 'aria-label': title });
      input.value = value || '';
      dlg.appendChild(el('form.dlg-body', {
        method: 'dialog',
        on: { submit: function (e) { e.preventDefault(); done(input.value.trim() || null); } }
      },
        el('h2', { text: title }),
        input,
        el('div.dlg-actions', null,
          el('button.btn', { type: 'button', text: 'Cancel', on: { click: function () { done(null); } } }),
          el('button.btn.primary', { type: 'submit', text: okLabel || 'Save' }))
      ));
      setTimeout(function () { input.focus(); input.select(); }, 30);
    });
  }

  function confirm(title, message, okLabel, danger) {
    return showDialog(function (dlg, done) {
      dlg.appendChild(el('div.dlg-body', null,
        el('h2', { text: title }),
        message ? el('p', { text: message }) : null,
        el('div.dlg-actions', null,
          el('button.btn', { type: 'button', text: 'Cancel', on: { click: function () { done(false); } } }),
          el('button.btn' + (danger ? '.danger' : '.primary'), {
            type: 'button', text: okLabel || 'OK', on: { click: function () { done(true); } }
          }))
      ));
    }).then(Boolean);
  }

  // A list of choices. Each option: {label, icon, value, danger, hint, depth, checked}
  function sheet(title, options) {
    return showDialog(function (dlg, done) {
      var list = el('div.sheet-list');
      options.forEach(function (o) {
        if (o.heading) { list.appendChild(el('div.sheet-heading', { text: o.heading })); return; }
        var btn = el('button.sheet-item' + (o.danger ? '.danger' : '') + (o.checked ? '.checked' : ''), {
          type: 'button',
          style: o.depth ? 'padding-left:' + (14 + o.depth * 18) + 'px' : null,
          on: { click: function () { done(o.value); } }
        });
        if (o.icon) btn.appendChild(el('span.sheet-ic', { html: icon(o.icon) }));
        btn.appendChild(el('span.sheet-label', { text: o.label }));
        if (o.hint) btn.appendChild(el('span.sheet-hint', { text: o.hint }));
        list.appendChild(btn);
      });
      dlg.appendChild(el('div.dlg-body.sheet', null, title ? el('h2', { text: title }) : null, list));
    });
  }

  // Visual page-format menu. With `scoped`, it also asks whether to use it on every page.
  // Resolves to a format id, or to {id, all} when scoped.
  function formatPicker(title, current, scoped) {
    var Ink = Folio.Ink;
    return showDialog(function (dlg, done) {
      var all = false;
      var grid = el('div.format-grid');
      Ink.FORMATS.forEach(function (f) {
        var c = el('canvas');
        c.width = 200;
        c.height = Math.round(200 * Ink.PH / Ink.PW);
        var ctx = c.getContext('2d');
        ctx.setTransform(c.width / Ink.PW, 0, 0, c.height / Ink.PH, 0, 0);
        Ink.drawPaper(ctx, f.id, 4);
        grid.appendChild(el('button.format' + (f.id === current ? '.on' : ''), {
          type: 'button', 'aria-pressed': String(f.id === current),
          on: { click: function () { done(scoped ? { id: f.id, all: all } : f.id); } }
        }, c, el('span', { text: f.name })));
      });
      var body = el('div.dlg-body.format-panel', null, el('h2', { text: title }), grid);
      if (scoped) {
        var box = el('input', { type: 'checkbox' });
        box.addEventListener('change', function () { all = box.checked; });
        body.appendChild(el('label.format-all', null, box, el('span', { text: 'Use on every page in this note' })));
      }
      body.appendChild(el('div.dlg-actions', null,
        el('button.btn', { type: 'button', text: 'Cancel', on: { click: function () { done(null); } } })));
      dlg.classList.add('wide');
      dlg.appendChild(body);
    });
  }

  function hsvToHex(h, s, v) {
    function f(n) {
      var k = (n + h / 60) % 6;
      var c = v - v * s * Math.max(0, Math.min(k, 4 - k, 1));
      return ('0' + Math.round(c * 255).toString(16)).slice(-2);
    }
    return '#' + f(5) + f(3) + f(1);
  }

  function hexToHsv(hex) {
    var n = parseInt(hex.slice(1), 16);
    var r = (n >> 16 & 255) / 255, g = (n >> 8 & 255) / 255, b = (n & 255) / 255;
    var max = Math.max(r, g, b), d = max - Math.min(r, g, b), h = 0;
    if (d) {
      if (max === r) h = ((g - b) / d + 6) % 6;
      else if (max === g) h = (b - r) / d + 2;
      else h = (r - g) / d + 4;
    }
    return { h: h * 60, s: max ? d / max : 0, v: max };
  }

  // Resolves to a #rrggbb colour, or null if cancelled.
  function colorWheel(initial, recent) {
    return showDialog(function (dlg, done) {
      var hsv = hexToHsv(/^#[0-9a-f]{6}$/i.test(initial) ? initial : '#6b4630');
      var thumb = el('div.wheel-thumb');
      var shade = el('div.wheel-shade');
      var wheel = el('div.wheel', { role: 'application', 'aria-label': 'Colour wheel' }, shade, thumb);
      var bright = el('input.bright', { type: 'range', min: 0, max: 100, 'aria-label': 'Brightness' });
      var preview = el('div.wheel-preview');
      var hex = el('input.field.hex', { type: 'text', maxlength: 7, 'aria-label': 'Colour code', spellcheck: 'false' });

      function current() { return hsvToHex(hsv.h, hsv.s, hsv.v); }
      function paint(skipHex) {
        var c = current(), a = (hsv.h - 90) * Math.PI / 180;
        thumb.style.left = (50 + Math.cos(a) * hsv.s * 50) + '%';
        thumb.style.top = (50 + Math.sin(a) * hsv.s * 50) + '%';
        thumb.style.background = c;
        shade.style.opacity = String(1 - hsv.v);
        bright.value = String(Math.round(hsv.v * 100));
        bright.style.setProperty('--full', hsvToHex(hsv.h, hsv.s, 1));
        preview.style.background = c;
        if (!skipHex) hex.value = c;
      }
      function pick(e) {
        var r = wheel.getBoundingClientRect();
        var dx = e.clientX - (r.left + r.width / 2), dy = e.clientY - (r.top + r.height / 2);
        hsv.h = (Math.atan2(dy, dx) * 180 / Math.PI + 90 + 360) % 360;
        hsv.s = Math.min(1, Math.hypot(dx, dy) / (r.width / 2));
        if (hsv.v < 0.05) hsv.v = 1; // A wheel tap on black should visibly do something.
        paint();
      }
      var dragging = false;
      wheel.addEventListener('pointerdown', function (e) {
        dragging = true;
        try { wheel.setPointerCapture(e.pointerId); } catch (err) { /* synthetic pointer */ }
        pick(e);
      });
      wheel.addEventListener('pointermove', function (e) { if (dragging) pick(e); });
      wheel.addEventListener('pointerup', function () { dragging = false; });
      wheel.addEventListener('pointercancel', function () { dragging = false; });
      bright.addEventListener('input', function () { hsv.v = bright.value / 100; paint(); });
      hex.addEventListener('input', function () {
        var v = hex.value.trim();
        if (v && v[0] !== '#') v = '#' + v;
        if (/^#[0-9a-f]{6}$/i.test(v)) { hsv = hexToHsv(v.toLowerCase()); paint(true); }
      });

      var row = el('div.recent');
      (recent || []).forEach(function (c) {
        row.appendChild(el('button.swatch', {
          type: 'button', 'aria-label': 'Recent colour ' + c, style: 'background:' + c,
          on: { click: function () { hsv = hexToHsv(c); paint(); } }
        }));
      });

      dlg.appendChild(el('div.dlg-body.wheel-panel', null,
        el('h2', { text: 'Choose a colour' }),
        wheel,
        el('label.bright-row', null, el('span', { text: 'Brightness' }), bright),
        el('div.wheel-row', null, preview, hex),
        recent && recent.length ? row : null,
        el('div.dlg-actions', null,
          el('button.btn', { type: 'button', text: 'Cancel', on: { click: function () { done(null); } } }),
          el('button.btn.primary', { type: 'button', text: 'Use colour', on: { click: function () { done(current()); } } }))));
      paint();
    });
  }

  var toastTimer;
  function toast(message) {
    var t = document.getElementById('toast');
    t.textContent = message;
    t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.hidden = true; }, 3200);
  }

  function timeAgo(ts) {
    var s = (Date.now() - ts) / 1000;
    if (s < 60) return 'Just now';
    if (s < 3600) return Math.floor(s / 60) + ' min ago';
    if (s < 86400) return Math.floor(s / 3600) + ' h ago';
    if (s < 604800) return Math.floor(s / 86400) + ' d ago';
    return new Date(ts).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
  }

  window.Folio = window.Folio || {};
  window.Folio.UI = {
    icon: icon, el: el, showDialog: showDialog, prompt: prompt, confirm: confirm, sheet: sheet,
    formatPicker: formatPicker, colorWheel: colorWheel,
    toast: toast, timeAgo: timeAgo
  };
})();
