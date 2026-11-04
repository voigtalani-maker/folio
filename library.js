// Folio library: folders (Year > Module > Topic), note cards, favourites, recycle bin, backup.
(function () {
  'use strict';
  var Store = Folio.Store, Ink = Folio.Ink, UI = Folio.UI;
  var el = UI.el, icon = UI.icon;
  var folders = [], notes = [], scope = { kind: 'all' }, query = '';
  var root;

  function childrenOf(parentId) {
    return folders.filter(function (f) { return (f.parentId || null) === (parentId || null); })
      .sort(function (a, b) { return a.name.localeCompare(b.name, undefined, { numeric: true }); });
  }

  function descendants(id) {
    var out = [id];
    childrenOf(id).forEach(function (c) { out = out.concat(descendants(c.id)); });
    return out;
  }

  function folderPath(id) {
    var names = [], f = folders.find(function (x) { return x.id === id; });
    while (f) {
      names.unshift(f.name);
      var parent = f.parentId;
      f = parent ? folders.find(function (x) { return x.id === parent; }) : null;
    }
    return names.join(' / ');
  }

  function load() {
    return Promise.all([Store.all('folders'), Store.all('notes')]).then(function (r) {
      folders = r[0];
      notes = r[1];
    });
  }

  function visibleNotes() {
    var q = query.trim().toLowerCase();
    var list = notes.filter(function (n) {
      if (scope.kind === 'trash') return !!n.deletedAt;
      if (n.deletedAt) return false;
      if (q) return (n.title || 'Untitled note').toLowerCase().indexOf(q) >= 0;
      if (scope.kind === 'favourites') return !!n.favourite;
      if (scope.kind === 'folder') return n.folderId === scope.id;
      return true;
    });
    return list.sort(function (a, b) { return (b.updated || 0) - (a.updated || 0); });
  }

  // ---------- Actions ----------

  function newNote() {
    var now = Date.now();
    var note = {
      id: Ink.uid(), title: '', folderId: scope.kind === 'folder' ? scope.id : null,
      paper: 'lined', favourite: false, created: now, updated: now, pageIds: []
    };
    var page = { id: Ink.uid(), noteId: note.id, paper: note.paper, items: [] };
    note.pageIds = [page.id];
    Store.put('pages', page).then(function () { return Store.put('notes', note); }).then(function () {
      location.hash = '#/n/' + note.id;
    }).catch(function (err) { UI.toast('Could not create the note: ' + err.message); });
  }

  function addFolder(parentId) {
    var label = parentId ? 'New folder inside ' + folderPath(parentId) : 'New folder';
    UI.prompt(label, '', 'Create').then(function (name) {
      if (!name) return;
      Store.put('folders', { id: Ink.uid(), name: name, parentId: parentId || null, created: Date.now() }).then(refresh);
    });
  }

  function folderMenu(f) {
    UI.sheet(f.name, [
      { label: 'New folder inside', icon: 'plus', value: 'sub' },
      { label: 'Rename', icon: 'pen', value: 'rename' },
      { label: 'Delete folder', icon: 'trash', value: 'delete', danger: true }
    ]).then(function (v) {
      if (v === 'sub') addFolder(f.id);
      else if (v === 'rename') {
        UI.prompt('Rename folder', f.name).then(function (name) {
          if (!name) return;
          f.name = name;
          Store.put('folders', f).then(refresh);
        });
      } else if (v === 'delete') {
        UI.confirm('Delete "' + f.name + '"?', 'Its notes and subfolders move up one level. Nothing inside is deleted.', 'Delete folder', true).then(function (ok) {
          if (!ok) return;
          var parent = f.parentId || null;
          var kids = childrenOf(f.id).map(function (c) { c.parentId = parent; return c; });
          var moved = notes.filter(function (n) { return n.folderId === f.id; }).map(function (n) { n.folderId = parent; return n; });
          Promise.all([Store.putMany('folders', kids), Store.putMany('notes', moved), Store.del('folders', f.id)]).then(function () {
            if (scope.kind === 'folder' && scope.id === f.id) location.hash = parent ? '#/f/' + parent : '#/';
            else refresh();
          });
        });
      }
    });
  }

  function noteMenu(n) {
    if (n.deletedAt) {
      UI.sheet(n.title || 'Untitled note', [
        { label: 'Restore', icon: 'undo', value: 'restore' },
        { label: 'Delete forever', icon: 'trash', value: 'purge', danger: true }
      ]).then(function (v) {
        if (v === 'restore') { delete n.deletedAt; Store.put('notes', n).then(refresh); }
        else if (v === 'purge') purge(n);
      });
      return;
    }
    UI.sheet(n.title || 'Untitled note', [
      { label: n.favourite ? 'Remove from favourites' : 'Add to favourites', icon: 'star', value: 'fav' },
      { label: 'Rename', icon: 'pen', value: 'rename' },
      { label: 'Move to folder', icon: 'folder', value: 'move' },
      { label: 'Move to recycle bin', icon: 'trash', value: 'delete', danger: true }
    ]).then(function (v) {
      if (v === 'fav') { n.favourite = !n.favourite; Store.put('notes', n).then(refresh); }
      else if (v === 'rename') {
        UI.prompt('Rename note', n.title || '').then(function (name) {
          if (!name) return;
          n.title = name;
          Store.put('notes', n).then(refresh);
        });
      } else if (v === 'move') moveNote(n);
      else if (v === 'delete') {
        n.deletedAt = Date.now();
        Store.put('notes', n).then(function () { UI.toast('Moved to the recycle bin.'); refresh(); });
      }
    });
  }

  function moveNote(n) {
    var options = [{ label: 'No folder', value: '__none', checked: !n.folderId }];
    (function walk(parent, depth) {
      childrenOf(parent).forEach(function (f) {
        options.push({ label: f.name, icon: 'folder', value: f.id, depth: depth, checked: n.folderId === f.id });
        walk(f.id, depth + 1);
      });
    })(null, 0);
    UI.sheet('Move to', options).then(function (v) {
      if (!v) return;
      n.folderId = v === '__none' ? null : v;
      Store.put('notes', n).then(refresh);
    });
  }

  function purge(n) {
    UI.confirm('Delete forever?', '"' + (n.title || 'Untitled note') + '" can\'t be recovered after this.', 'Delete forever', true).then(function (ok) {
      if (ok) Store.purgeNote(n).then(refresh);
    });
  }

  function backup() {
    UI.toast('Preparing your backup…');
    Store.exportAll().then(function (data) {
      var blob = new Blob([JSON.stringify(data)], { type: 'application/json' });
      var url = URL.createObjectURL(blob);
      var day = new Date().toISOString().slice(0, 10);
      var a = el('a', { href: url, download: 'folio-backup-' + day + '.json' });
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(function () { URL.revokeObjectURL(url); }, 10000);
      UI.toast('Backup saved to your downloads.');
    }).catch(function (err) { UI.toast('Backup failed: ' + err.message); });
  }

  function restore() {
    var input = el('input', { type: 'file', accept: '.json,application/json' });
    input.addEventListener('change', function () {
      var f = input.files[0];
      if (!f) return;
      UI.confirm('Restore this backup?', 'Its notes are added to your library. Any note that is also in the backup is replaced by the backup copy.', 'Restore').then(function (ok) {
        if (!ok) return;
        f.text().then(function (txt) { return Store.importAll(JSON.parse(txt)); }).then(function () {
          UI.toast('Backup restored.');
          refresh();
        }).catch(function (err) { UI.toast('Restore failed: ' + err.message); });
      });
    });
    input.click();
  }

  // ---------- Rendering ----------

  function navItem(label, ic, hash, active, count) {
    return el('a.nav-item' + (active ? '.on' : ''), { href: hash },
      el('span.nav-ic', { html: icon(ic) }),
      el('span.nav-label', { text: label }),
      count ? el('span.nav-count', { text: String(count) }) : null);
  }

  function renderTree(parent, depth, out) {
    childrenOf(parent).forEach(function (f) {
      var count = notes.filter(function (n) { return !n.deletedAt && n.folderId === f.id; }).length;
      out.appendChild(el('div.tree-row' + (scope.kind === 'folder' && scope.id === f.id ? '.on' : ''), {
        style: 'padding-left:' + (6 + depth * 14) + 'px'
      },
        el('a.tree-link', { href: '#/f/' + f.id },
          el('span.nav-ic', { html: icon('folder') }),
          el('span.nav-label', { text: f.name }),
          count ? el('span.nav-count', { text: String(count) }) : null),
        el('button.tree-more', {
          type: 'button', 'aria-label': 'Options for ' + f.name, html: icon('more'),
          on: { click: function () { folderMenu(f); } }
        })));
      renderTree(f.id, depth + 1, out);
    });
  }

  // Every module gets its own notebook colour, worked out from its folder so it never changes.
  var SPINES = ['#2f6f5e', '#b4563b', '#3c6696', '#83639f', '#b0822f', '#55794a', '#a44c6d', '#3f7f8c'];
  function spineColor(folderId) {
    if (!folderId) return '#9ba59b';
    var h = 0;
    for (var i = 0; i < folderId.length; i++) h = (h * 31 + folderId.charCodeAt(i)) >>> 0;
    return SPINES[h % SPINES.length];
  }

  function card(n) {
    var meta = UI.timeAgo(n.updated || n.created);
    var count = (n.pageIds || []).length;
    if (count > 1) meta += ' · ' + count + ' pages';
    var open = n.deletedAt ? function () { noteMenu(n); } : function () { location.hash = '#/n/' + n.id; };
    return el('article.card', null,
      el('button.card-open', { type: 'button', style: '--spine:' + spineColor(n.folderId), 'aria-label': 'Open ' + (n.title || 'Untitled note'), on: { click: open } },
        n.thumb ? el('img.card-thumb', { src: n.thumb, alt: '' }) : el('div.card-thumb.empty')),
      el('div.card-info', null,
        el('div.card-text', null,
          el('h3', { text: n.title || 'Untitled note' }),
          el('p', { text: n.folderId && (query || scope.kind !== 'folder') ? folderPath(n.folderId) || meta : meta })),
        n.favourite ? el('span.card-star', { html: icon('star'), title: 'Favourite' }) : null,
        el('button.icon-btn', {
          type: 'button', 'aria-label': 'Options for ' + (n.title || 'Untitled note'), html: icon('more'),
          on: { click: function () { noteMenu(n); } }
        })));
  }

  function heading() {
    if (query.trim()) return 'Search results';
    if (scope.kind === 'favourites') return 'Favourites';
    if (scope.kind === 'trash') return 'Recycle bin';
    if (scope.kind === 'folder') return folderPath(scope.id) || 'Folder';
    return 'All notes';
  }

  function emptyState() {
    if (query.trim()) return el('div.empty', null, el('h3', { text: 'No matching notes' }), el('p', { text: 'Search looks at note titles for now.' }));
    if (scope.kind === 'trash') return el('div.empty', null, el('h3', { text: 'The recycle bin is empty' }));
    if (scope.kind === 'favourites') return el('div.empty', null, el('h3', { text: 'No favourites yet' }), el('p', { text: 'Open a note\'s options to add it here.' }));
    return el('div.empty', null,
      el('h3', { text: 'Nothing here yet' }),
      el('p', { text: 'Start a note, then write on it with your S Pen.' }),
      el('button.btn.primary', { type: 'button', text: 'New note', on: { click: newNote } }));
  }

  function renderGrid() {
    var grid = root.querySelector('#grid');
    grid.innerHTML = '';
    root.querySelector('#libTitle').textContent = heading();
    var list = visibleNotes();
    root.querySelector('#libSub').textContent = list.length === 1 ? '1 note' : list.length + ' notes';
    if (!list.length) { grid.appendChild(emptyState()); return; }
    list.forEach(function (n) { grid.appendChild(card(n)); });
  }

  function render() {
    root = document.getElementById('library');
    root.innerHTML = '';
    var live = notes.filter(function (n) { return !n.deletedAt; });
    var nav = el('nav.side', { 'aria-label': 'Library' },
      el('div.brand', { text: 'Folio' }),
      navItem('All notes', 'notes', '#/', scope.kind === 'all', live.length),
      navItem('Favourites', 'star', '#/favourites', scope.kind === 'favourites', live.filter(function (n) { return n.favourite; }).length),
      el('div.side-heading', null,
        el('span', { text: 'Folders' }),
        el('button.icon-btn', { type: 'button', 'aria-label': 'New folder', title: 'New folder', html: icon('plus'), on: { click: function () { addFolder(null); } } })));
    var tree = el('div.tree');
    renderTree(null, 0, tree);
    if (!folders.length) tree.appendChild(el('p.side-hint', { text: 'Add a year, then modules and topics inside it.' }));
    nav.appendChild(tree);
    nav.appendChild(el('div.side-foot', null,
      navItem('Recycle bin', 'trash', '#/trash', scope.kind === 'trash', notes.length - live.length),
      el('p.side-hint', { text: 'Your notes are saved only on this device. Back up regularly.' }),
      el('div.side-actions', null,
        el('button.btn.small', { type: 'button', text: 'Back up', on: { click: backup } }),
        el('button.btn.small', { type: 'button', text: 'Restore', on: { click: restore } }))));

    var search = el('input.field.search', { type: 'search', placeholder: 'Search note titles', 'aria-label': 'Search note titles' });
    search.value = query;
    search.addEventListener('input', function () { query = search.value; renderGrid(); });

    var main = el('main.lib-main', null,
      el('header.lib-head', null,
        el('button.icon-btn.menu-btn', {
          type: 'button', 'aria-label': 'Show folders', html: icon('menu'),
          on: { click: function () { root.classList.toggle('nav-open'); } }
        }),
        el('div.lib-titles', null, el('h1', { id: 'libTitle' }), el('p.lib-sub', { id: 'libSub' })),
        el('div.lib-search', null, el('span.search-ic', { html: icon('search') }), search),
        scope.kind === 'trash' ? null : el('button.btn.primary.new-note', {
          type: 'button', html: icon('plus') + '<span>New note</span>', on: { click: newNote }
        })),
      el('div.grid', { id: 'grid' }));

    root.appendChild(nav);
    root.appendChild(main);
    renderGrid();
  }

  function refresh() { return load().then(render); }

  function show(newScope) {
    scope = newScope;
    return refresh();
  }

  window.Folio = window.Folio || {};
  window.Folio.Library = { show: show };
})();
