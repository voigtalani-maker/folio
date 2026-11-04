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
    rect: '<rect x="4" y="6" width="16" height="12" rx="1"/>',
    ellipse: '<ellipse cx="12" cy="12" rx="9" ry="6.500"/>',
    line: '<path d="M5 19L19 5"/>',
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

  function prompt(title, value, okLabel) {
    return showDialog(function (dlg, done) {
      var input = el('input.field', { type: 'text', maxlength: 120, 'aria-label': title });
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
    toast: toast, timeAgo: timeAgo
  };
})();
