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

  var VIEW_KEY = 'folio.view';
  var view = { sort: 'updated', since: 0 };
  try { Object.assign(view, JSON.parse(localStorage.getItem(VIEW_KEY))); } catch (e) { /* defaults apply */ }

  function sinceTime() {
    var now = new Date();
    if (view.since === 'today') return new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    if (view.since === 'week') return Date.now() - 7 * 86400000;
    if (view.since === 'month') return Date.now() - 30 * 86400000;
    return 0;
  }

  function visibleNotes() {
    var q = query.trim().toLowerCase().replace(/^#/, ''), since = sinceTime();
    var list = notes.filter(function (n) {
      if (scope.kind === 'trash') return !!n.deletedAt;
      if (n.deletedAt) return false;
      if ((n.updated || 0) < since) return false;
      if (q) {
        return (n.title || 'Untitled note').toLowerCase().indexOf(q) >= 0 ||
          (n.tags || []).some(function (t) { return t.toLowerCase().indexOf(q) >= 0; }) ||
          (!n.lock && String(n.searchText || '').toLowerCase().indexOf(q) >= 0);
      }
      if (scope.kind === 'favourites') return !!n.favourite;
      if (scope.kind === 'folder') return n.folderId === scope.id;
      if (scope.kind === 'tag') return (n.tags || []).indexOf(scope.tag) >= 0;
      return true;
    });
    return list.sort(function (a, b) {
      if (!!b.pinned !== !!a.pinned) return b.pinned ? 1 : -1;
      if (view.sort === 'title') {
        return (a.title || 'Untitled note').localeCompare(b.title || 'Untitled note', undefined, { numeric: true });
      }
      if (view.sort === 'created') return (b.created || 0) - (a.created || 0);
      return (b.updated || 0) - (a.updated || 0);
    });
  }

  function sortAndFilter() {
    UI.sheet('Sort and filter', [
      { heading: 'Sort by' },
      { label: 'Last edited', value: 's:updated', checked: view.sort === 'updated' },
      { label: 'Date created', value: 's:created', checked: view.sort === 'created' },
      { label: 'Title', value: 's:title', checked: view.sort === 'title' },
      { heading: 'Edited' },
      { label: 'Any time', value: 'f:0', checked: !view.since },
      { label: 'Today', value: 'f:today', checked: view.since === 'today' },
      { label: 'Last 7 days', value: 'f:week', checked: view.since === 'week' },
      { label: 'Last 30 days', value: 'f:month', checked: view.since === 'month' }
    ]).then(function (v) {
      if (!v) return;
      if (v[0] === 's') view.sort = v.slice(2);
      else view.since = v === 'f:0' ? 0 : v.slice(2);
      try { localStorage.setItem(VIEW_KEY, JSON.stringify(view)); } catch (e) { /* not essential */ }
      renderGrid();
    });
  }

  function editTags(n) {
    UI.prompt('Tags, separated by commas', (n.tags || []).join(', '), 'Save tags').then(function (txt) {
      if (txt === null && !(n.tags || []).length) return;
      var seen = {};
      n.tags = String(txt || '').split(',').map(function (t) { return t.trim().replace(/^#/, ''); }).filter(function (t) {
        if (!t || seen[t.toLowerCase()]) return false;
        seen[t.toLowerCase()] = true;
        return true;
      });
      Store.put('notes', n).then(refresh);
    });
  }

  function allTags() {
    var seen = {};
    notes.forEach(function (n) {
      if (!n.deletedAt) (n.tags || []).forEach(function (t) { seen[t] = (seen[t] || 0) + 1; });
    });
    return Object.keys(seen).sort().map(function (t) { return [t, seen[t]]; });
  }

  // ---------- Actions ----------

  var FORMAT_KEY = 'folio.lastFormat';

  function newNote() {
    var last = 'lined';
    try { last = localStorage.getItem(FORMAT_KEY) || last; } catch (e) { /* lined is fine */ }
    UI.formatPicker('Choose a format', last).then(function (format) {
      if (!format) return;
      try { localStorage.setItem(FORMAT_KEY, format); } catch (e) { /* not essential */ }
      createNote(format);
    });
  }

  function createNote(format) {
    var now = Date.now();
    var note = {
      id: Ink.uid(), title: '', folderId: scope.kind === 'folder' ? scope.id : null,
      paper: format, favourite: false, created: now, updated: now, pageIds: []
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
      { label: 'Colour', icon: 'shape', value: 'colour' },
      { label: 'Delete folder', icon: 'trash', value: 'delete', danger: true }
    ]).then(function (v) {
      if (v === 'sub') addFolder(f.id);
      else if (v === 'colour') {
        UI.colorWheel(f.color || spineColor(f.id), SPINES).then(function (c) {
          if (!c) return;
          f.color = c;
          Store.put('folders', f).then(refresh);
        });
      } else if (v === 'rename') {
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
      { label: n.pinned ? 'Unpin' : 'Pin to top', icon: 'pin', value: 'pin' },
      { label: 'Tags', icon: 'tag', value: 'tags' },
      n.shared ? null : { label: 'Share', icon: 'share', value: 'share' },
      { label: n.lock ? 'Remove password' : 'Lock with password', icon: 'lock', value: 'lock' },
      { label: 'Rename', icon: 'pen', value: 'rename' },
      { label: 'Move to folder', icon: 'folder', value: 'move' },
      { label: 'Move to recycle bin', icon: 'trash', value: 'delete', danger: true }
    ].filter(Boolean)).then(function (v) {
      if (v === 'share') shareNote(n);
      else if (v === 'fav') { n.favourite = !n.favourite; Store.put('notes', n).then(refresh); }
      else if (v === 'pin') { n.pinned = !n.pinned; Store.put('notes', n).then(refresh); }
      else if (v === 'tags') editTags(n);
      else if (v === 'lock') lockNote(n);
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

  function lockNote(n) {
    if (n.lock) {
      UI.prompt('Enter the password to remove it', '', 'Remove', 'password').then(function (pw) {
        if (!pw) return;
        Folio.Docs.checkLock(n.lock, pw).then(function (ok) {
          if (!ok) { UI.toast('That password is not right.'); return; }
          delete n.lock;
          Store.put('notes', n).then(refresh);
        });
      });
      return;
    }
    UI.prompt('Choose a password for this note', '', 'Next', 'password').then(function (pw) {
      if (!pw) return;
      UI.prompt('Type it again', '', 'Lock note', 'password').then(function (again) {
        if (again === null) return;
        if (again !== pw) { UI.toast('The passwords did not match.'); return; }
        UI.confirm('Lock this note?', 'If you forget this password, Folio can\'t get the note back through the app. The lock hides the note in Folio, but it does not encrypt it, and backups can still contain it.', 'Lock note').then(function (ok) {
          if (!ok) return;
          Folio.Docs.makeLock(pw).then(function (lock) {
            n.lock = lock;
            return Store.put('notes', n);
          }).then(refresh);
        });
      });
    });
  }

  function chooseFiles() {
    var input = el('input', { type: 'file', multiple: true });
    input.addEventListener('change', function () {
      if (input.files.length) Folio.openFiles(Array.from(input.files));
    });
    input.click();
  }

  // ---------- Account and sharing ----------

  function syncText() {
    var s = Folio.Sync.state();
    if (s.error) return 'Sync problem. It will retry.';
    if (s.busy) return 'Syncing…';
    if (s.pending) return s.pending + ' change' + (s.pending === 1 ? '' : 's') + ' waiting to sync';
    return s.lastSync ? 'Synced ' + UI.timeAgo(s.lastSync).toLowerCase() : 'Ready to sync';
  }

  function accountPanel() {
    var user = Folio.Sync.user();
    if (!user) {
      return el('div', null,
        el('p.side-hint', { text: 'Your notes are saved only on this device. Sign in to sync them.' }),
        el('div.side-actions', null, el('button.btn.small', { type: 'button', text: 'Sign in to sync', on: { click: signInDialog } })));
    }
    var status = el('span', { id: 'syncStatus', text: syncText() });
    return el('div', null,
      el('div.account', null, el('strong', { text: user.email }), status),
      el('div.side-actions', null, el('button.btn.small', {
        type: 'button', text: 'Sign out', on: { click: function () {
          UI.confirm('Sign out?', 'Your notes stay on this device, but stop syncing until you sign back in.', 'Sign out').then(function (ok) {
            if (ok) { Folio.Sync.signOut(); render(); }
          });
        } }
      })));
  }

  function signInDialog() {
    UI.showDialog(function (dlg, done) {
      var email = el('input.field', { type: 'email', autocomplete: 'email', 'aria-label': 'Email', placeholder: 'Email' });
      var password = el('input.field', { type: 'password', autocomplete: 'current-password', 'aria-label': 'Password', placeholder: 'Password', minlength: 8 });
      var message = el('p', { role: 'status' });
      function attempt(create) {
        if (!email.value.trim() || !password.value) { message.textContent = 'Enter your email and a password.'; return; }
        message.textContent = create ? 'Creating your account…' : 'Signing in…';
        var action = create ? Folio.Sync.signUp(email.value.trim(), password.value) : Folio.Sync.signIn(email.value.trim(), password.value).then(function () { return true; });
        action.then(function (ready) {
          if (ready) { done(true); render(); return; }
          message.textContent = 'Check your email for a confirmation link, then come back and sign in.';
        }).catch(function (err) { message.textContent = err.message; });
      }
      dlg.appendChild(el('form.dlg-body', { on: { submit: function (e) { e.preventDefault(); attempt(false); } } },
        el('h2', { text: 'Sync your notes' }),
        el('p', { text: 'Use the same account on your tablet, laptop and phone. Pick a new password just for Folio.' }),
        email, password, message,
        el('div.dlg-actions', null,
          el('button.btn', { type: 'button', text: 'Cancel', on: { click: function () { done(null); } } }),
          el('button.btn', { type: 'button', text: 'Create account', on: { click: function () { attempt(true); } } }),
          el('button.btn.primary', { type: 'submit', text: 'Sign in' }))));
      setTimeout(function () { email.focus(); }, 30);
    });
  }

  function showLink(link, canEdit) {
    UI.showDialog(function (dlg, done) {
      var field = el('input.field.link-field', { type: 'text', readonly: true, 'aria-label': 'Share link' });
      field.value = link;
      dlg.appendChild(el('div.dlg-body', null,
        el('h2', { text: 'Your share link' }),
        el('p', { text: (canEdit ? 'Anyone with this link can read and edit this note.' : 'Anyone with this link can read this note.') + ' They don\'t need an account. Images, PDFs and recordings aren\'t included.' }),
        field,
        el('div.dlg-actions', null,
          el('button.btn', { type: 'button', text: 'Close', on: { click: function () { done(null); } } }),
          el('button.btn.primary', { type: 'button', text: 'Copy link', on: { click: function () {
            navigator.clipboard.writeText(link).then(function () { UI.toast('Link copied.'); }, function () { field.select(); UI.toast('Press and hold the link to copy it.'); });
          } } }))));
    });
  }

  function shareNote(n) {
    if (!Folio.Sync.user()) { UI.toast('Sign in to share notes.'); signInDialog(); return; }
    if (n.lock) { UI.toast('Remove the note\'s password before sharing it.'); return; }
    Folio.Sync.sharesOf(n.id).then(function (shares) {
      var options = [
        { label: 'Anyone with the link can read', value: 'view' },
        { label: 'Anyone with the link can edit', value: 'edit' }
      ];
      if (shares.length) options.push({ label: 'Stop sharing', hint: shares.length + ' active link' + (shares.length === 1 ? '' : 's'), value: 'stop', danger: true });
      return UI.sheet('Share this note', options).then(function (v) {
        if (v === 'stop') return Folio.Sync.stopSharing(n.id).then(function () { UI.toast('Those links no longer work.'); });
        if (!v) return null;
        return Folio.Sync.createShare(n.id, v === 'edit').then(function (link) { showLink(link, v === 'edit'); });
      });
    }).catch(function () { UI.toast('Sharing needs an internet connection.'); });
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
          el('span.nav-ic', { html: icon('folder'), style: f.color ? 'color:' + f.color : null }),
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
  var SPINES = ['#6b4630', '#5b9bc4', '#96643f', '#3f7ea6', '#b58a64', '#86b9d6', '#4c3326', '#2f6a8f'];
  function spineColor(folderId) {
    if (!folderId) return '#b9a999';
    var folder = folders.find(function (f) { return f.id === folderId; });
    if (folder && folder.color) return folder.color;
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
        n.lock ? el('div.card-thumb.locked', { html: icon('lock') })
          : n.thumb ? el('img.card-thumb', { src: n.thumb, alt: '' }) : el('div.card-thumb.empty')),
      el('div.card-info', null,
        el('div.card-text', null,
          el('h3', { text: n.title || 'Untitled note' }),
          el('p', { text: n.folderId && (query || scope.kind !== 'folder') ? folderPath(n.folderId) || meta : meta }),
          (n.tags || []).length ? el.apply(null, ['div.card-tags', null].concat(n.tags.slice(0, 3).map(function (t) {
            return el('span.tag-chip', { text: '#' + t });
          }))) : null),
        n.pinned ? el('span.card-pin', { html: icon('pin'), title: 'Pinned' }) : null,
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
    if (scope.kind === 'tag') return '#' + scope.tag;
    if (scope.kind === 'folder') return folderPath(scope.id) || 'Folder';
    return 'All notes';
  }

  function emptyState() {
    if (query.trim()) return el('div.empty', null, el('h3', { text: 'No matching notes' }), el('p', { text: 'Search covers titles, tags, typed text and PDF text, but not handwriting.' }));
    if (view.since) return el('div.empty', null, el('h3', { text: 'No notes in this date range' }), el('p', { text: 'Change it under Sort and filter.' }));
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
    var tags = allTags();
    if (tags.length) {
      tree.appendChild(el('div.side-heading', null, el('span', { text: 'Tags' })));
      tags.forEach(function (t) {
        tree.appendChild(navItem('#' + t[0], 'tag', '#/t/' + encodeURIComponent(t[0]), scope.kind === 'tag' && scope.tag === t[0], t[1]));
      });
    }
    nav.appendChild(tree);
    nav.appendChild(el('div.side-foot', null,
      navItem('Recycle bin', 'trash', '#/trash', scope.kind === 'trash', notes.length - live.length),
      accountPanel(),
      el('div.side-actions', null,
        el('button.btn.small', { type: 'button', text: 'Back up', on: { click: backup } }),
        el('button.btn.small', { type: 'button', text: 'Restore', on: { click: restore } }))));

    var search = el('input.field.search', { type: 'search', placeholder: 'Search your notes', 'aria-label': 'Search your notes' });
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
        el('button.icon-btn', {
          type: 'button', title: 'Sort and filter', 'aria-label': 'Sort and filter', html: icon('sliders'), on: { click: sortAndFilter }
        }),
        scope.kind === 'trash' ? null : el('button.btn', { type: 'button', text: 'Open file', on: { click: chooseFiles } }),
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
  window.addEventListener('folio:synced', function () {
    var lib = document.getElementById('library');
    var typing = document.activeElement && document.activeElement.matches('.search');
    if (lib && !lib.hidden && !typing && !document.querySelector('dialog[open]')) refresh();
  });
  Folio.Sync.subscribe(function () {
    var s = document.getElementById('syncStatus');
    if (s) s.textContent = syncText();
  });

  window.Folio.Library = { show: show, newNote: newNote };
})();
