// Folio sync: sign-in, two-way sync through Supabase, and shared notes.
// The device copy stays the working copy. Changes wait in an outbox until they can be sent.
// Stays on the device: PDF pages, recordings and attached files. Images in notes do sync.
(function () {
  'use strict';
  var Store = Folio.Store, Ink = Folio.Ink;
  var URL_BASE = 'https://hontxqtggrvxybamqrnh.supabase.co';
  var KEY = 'sb_publishable__gdf9hPZ-q7LUOkpcwkyLg_6wUW0N3y';
  var SESSION_KEY = 'folio.session', OUTBOX_KEY = 'folio.outbox', CURSOR_KEY = 'folio.cursors', UPLOADED_KEY = 'folio.uploaded';
  var BUCKET = 'fol-assets';

  function load(key, fallback) {
    try { return JSON.parse(localStorage.getItem(key)) || fallback; } catch (e) { return fallback; }
  }
  function save(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch (e) { /* retried at the next change */ }
  }

  var session = load(SESSION_KEY, null);
  var outbox = load(OUTBOX_KEY, {});
  var state = { busy: false, lastSync: 0, error: '' };
  var timer = 0, listeners = [];

  function notify() { listeners.forEach(function (fn) { fn(); }); }

  // Every saved folder, note and page lands in the outbox with the time it changed.
  Store.onWrite(function (store, id) {
    outbox[store + ':' + id] = Date.now();
    save(OUTBOX_KEY, outbox);
    schedule();
  });

  function schedule(delay) {
    clearTimeout(timer);
    timer = setTimeout(run, delay === undefined ? 4000 : delay);
  }

  // ---------- Requests ----------

  function authRequest(path, body) {
    return fetch(URL_BASE + '/auth/v1/' + path, {
      method: 'POST',
      headers: { apikey: KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    }).then(function (res) {
      return res.json().catch(function () { return {}; }).then(function (data) {
        if (!res.ok) throw new Error(data.msg || data.error_description || data.message || 'Sign-in failed.');
        return data;
      });
    });
  }

  function keepSession(data) {
    session = {
      access_token: data.access_token, refresh_token: data.refresh_token,
      expires_at: Date.now() + (data.expires_in || 3600) * 1000,
      user: { id: data.user.id, email: data.user.email }
    };
    save(SESSION_KEY, session);
  }

  function token() {
    if (!session) return Promise.resolve(KEY);
    if (session.expires_at - Date.now() > 60000) return Promise.resolve(session.access_token);
    return authRequest('token?grant_type=refresh_token', { refresh_token: session.refresh_token }).then(function (data) {
      keepSession(data);
      return session.access_token;
    });
  }

  function api(path, options) {
    var o = options || {};
    return token().then(function (t) {
      return fetch(URL_BASE + path, {
        method: o.method || 'GET',
        headers: Object.assign({ apikey: KEY, Authorization: 'Bearer ' + t }, o.body && !o.raw ? { 'Content-Type': 'application/json' } : {}, o.headers || {}),
        body: o.raw ? o.body : o.body ? JSON.stringify(o.body) : undefined
      });
    }).then(function (res) {
      if (!res.ok) {
        return res.text().then(function (text) { throw new Error(res.status + ' ' + text.slice(0, 160)); });
      }
      return res;
    });
  }

  function json(res) { return res.text().then(function (t) { return t ? JSON.parse(t) : null; }); }

  function upsert(table, rows) {
    return api('/rest/v1/' + table + '?on_conflict=owner,id', {
      method: 'POST', body: rows, headers: { Prefer: 'resolution=merge-duplicates,return=minimal' }
    });
  }

  // ---------- Packing pages ----------

  function pack(obj) {
    var text = JSON.stringify(obj);
    if (!window.CompressionStream) return Promise.resolve('js:' + text);
    var stream = new Blob([text]).stream().pipeThrough(new CompressionStream('gzip'));
    return new Response(stream).arrayBuffer().then(function (buf) {
      var bytes = new Uint8Array(buf), out = '';
      for (var i = 0; i < bytes.length; i += 32768) out += String.fromCharCode.apply(null, bytes.subarray(i, i + 32768));
      return 'gz:' + btoa(out);
    });
  }

  function unpack(blob) {
    if (blob.slice(0, 3) === 'js:') return Promise.resolve(JSON.parse(blob.slice(3)));
    var bin = atob(blob.slice(3)), bytes = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    var stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
    return new Response(stream).text().then(JSON.parse);
  }

  function plainText(page) {
    return page.items.filter(function (it) { return it.type === 'text' || it.type === 'attach'; })
      .sort(function (a, b) { return a.y - b.y; })
      .map(function (it) { return it.text || it.url || it.name || ''; }).join('\n').slice(0, 900000);
  }

  function noteData(n) {
    var d = Object.assign({}, n);
    delete d.pdfText; // Kept on the device with its PDF.
    if (d.searchText) d.searchText = d.searchText.slice(0, 50000);
    return d;
  }

  // ---------- Images ----------

  function uploadImages(page) {
    var uploaded = load(UPLOADED_KEY, {});
    var ids = page.items.filter(function (it) { return it.type === 'image' && !uploaded[it.asset]; }).map(function (it) { return it.asset; });
    return ids.reduce(function (chain, id) {
      return chain.then(function () { return Store.get('assets', id); }).then(function (a) {
        if (!a || a.blob.size > 10000000) return null;
        return api('/storage/v1/object/' + BUCKET + '/' + session.user.id + '/' + id, {
          method: 'POST', raw: true, body: a.blob, headers: { 'Content-Type': a.blob.type || 'image/webp', 'x-upsert': 'true' }
        }).then(function () {
          uploaded[id] = 1;
          save(UPLOADED_KEY, uploaded);
        });
      });
    }, Promise.resolve());
  }

  // Fetches an image that was added on another device. Resolves to its record, or null.
  function fetchAsset(id) {
    if (!session) return Promise.resolve(null);
    return api('/storage/v1/object/' + BUCKET + '/' + session.user.id + '/' + id).then(function (res) {
      return res.blob();
    }).then(function (blob) {
      var rec = { id: id, blob: blob };
      return Store.raw.put('assets', rec).then(function () { return rec; });
    }).catch(function () { return null; });
  }

  // ---------- Pushing ----------

  var sent = {};

  function clearSent(key, stamp) {
    sent[key] = stamp;
    if (outbox[key] === stamp) {
      delete outbox[key];
      save(OUTBOX_KEY, outbox);
    }
  }

  function pushOwn(key, stamp) {
    var parts = key.split(':'), store = parts[0], id = parts.slice(1).join(':'), uid = session.user.id;
    return Store.get(store, id).then(function (rec) {
      if (store === 'folders') {
        return upsert('fol_folders', [{ owner: uid, id: id, data: rec || {}, deleted: !rec, client_rev: stamp }]);
      }
      if (store === 'notes') {
        return upsert('fol_notes', [{ owner: uid, id: id, data: rec ? noteData(rec) : {}, deleted: !rec, client_rev: stamp }]);
      }
      if (!rec) return upsert('fol_pages', [{ owner: uid, id: id, note_id: '', blob: '', plain: '', preview: '', deleted: true, client_rev: stamp }]);
      return Store.get('notes', rec.noteId).then(function (note) {
        var locked = !!(note && note.lock);
        return uploadImages(rec).then(function () {
          // Locked notes never send readable text or a picture of the page.
          return Promise.all([pack(rec), locked ? '' : Folio.Docs.pagePreview(rec)]);
        }).then(function (r) {
          return upsert('fol_pages', [{
            owner: uid, id: id, note_id: rec.noteId, blob: r[0], plain: locked ? '' : plainText(rec), preview: r[1], deleted: false, client_rev: stamp
          }]);
        });
      });
    });
  }

  function rpc(name, args) {
    return api('/rest/v1/rpc/' + name, { method: 'POST', body: args });
  }

  // A shared note goes back to its owner through its share link.
  function pushShared(key, stamp) {
    var parts = key.split(':'), store = parts[0];
    if (store === 'notes') {
      var noteToken = parts[1].slice(3);
      return Store.get('notes', parts[1]).then(function (n) {
        if (!n || !n.shared || !n.shared.canEdit) return null;
        var prefix = 'sh:' + noteToken + ':';
        return rpc('fol_shared_save', {
          p_token: noteToken, p_page_id: null, p_blob: null, p_plain: null, p_preview: null, p_rev: stamp,
          p_page_ids: (n.pageIds || []).map(function (x) { return x.slice(0, prefix.length) === prefix ? x.slice(prefix.length) : x; })
        });
      });
    }
    var shareToken = parts[2], id = parts.slice(3).join(':');
    return Store.get('pages', parts.slice(1).join(':')).then(function (page) {
      if (!page) return null;
      return Store.get('notes', page.noteId).then(function (n) {
        if (!n || !n.shared || !n.shared.canEdit) return null;
        var copy = Object.assign({}, page, { id: id, noteId: n.shared.ownerNote });
        return Promise.all([pack(copy), Folio.Docs.pagePreview(page)]).then(function (r) {
          return rpc('fol_shared_save', {
            p_token: shareToken, p_page_id: id, p_blob: r[0], p_plain: plainText(page), p_preview: r[1], p_rev: stamp, p_page_ids: null
          });
        });
      });
    });
  }

  function isSharedKey(key) {
    return key.indexOf('notes:sh-') === 0 || key.indexOf('pages:sh:') === 0;
  }

  var ORDER = { folders: 0, notes: 1, pages: 2 };

  function push() {
    var keys = Object.keys(outbox).sort(function (a, b) {
      return ORDER[a.split(':')[0]] - ORDER[b.split(':')[0]] || outbox[a] - outbox[b];
    });
    return keys.reduce(function (chain, key) {
      return chain.then(function () {
        var stamp = outbox[key], shared = isSharedKey(key);
        if (!shared && !session) return null;
        return (shared ? pushShared(key, stamp) : pushOwn(key, stamp)).then(function () { clearSent(key, stamp); });
      });
    }, Promise.resolve());
  }

  // ---------- Pulling ----------

  function pullTable(table, store, select, apply) {
    var cursors = load(CURSOR_KEY, {}), changed = 0;
    function page() {
      var since = cursors[table] ? '&server_updated=gt.' + encodeURIComponent(cursors[table]) : '';
      return api('/rest/v1/' + table + '?select=' + select + since + '&order=server_updated.asc&limit=100').then(json).then(function (rows) {
        return rows.reduce(function (chain, row) {
          return chain.then(function () {
            var key = store + ':' + row.id;
            // This device's own save coming back changes nothing.
            if (sent[key] === row.client_rev) return null;
            // A newer change waiting on this device wins; an older one gives way.
            if (outbox[key] && outbox[key] >= row.client_rev) return null;
            delete outbox[key];
            changed++;
            if (row.deleted) return Store.raw.del(store, row.id);
            return apply(row);
          }).then(function () {
            cursors[table] = row.server_updated;
            save(CURSOR_KEY, cursors);
            save(OUTBOX_KEY, outbox);
          });
        }, Promise.resolve()).then(function () { return rows.length === 100 ? page() : changed; });
      });
    }
    return page();
  }

  function mergeNote(row) {
    // Keeps the device's PDF search text, which is never uploaded.
    return Store.get('notes', row.id).then(function (local) {
      var data = row.data;
      if (local && local.pdfText) data.pdfText = local.pdfText;
      return Store.raw.put('notes', data);
    });
  }

  function pull() {
    return pullTable('fol_folders', 'folders', 'id,data,deleted,client_rev,server_updated', function (row) {
      return Store.raw.put('folders', row.data);
    }).then(function (a) {
      return pullTable('fol_notes', 'notes', 'id,data,deleted,client_rev,server_updated', mergeNote).then(function (b) {
        return pullTable('fol_pages', 'pages', 'id,note_id,blob,deleted,client_rev,server_updated', function (row) {
          return unpack(row.blob).then(function (page) { return Store.raw.put('pages', page); });
        }).then(function (c) { return a + b + c; });
      });
    });
  }

  // ---------- Running ----------

  function run() {
    if (state.busy) { schedule(); return Promise.resolve(); }
    if (!navigator.onLine) return Promise.resolve();
    if (!session && !Object.keys(outbox).some(isSharedKey)) return Promise.resolve();
    state.busy = true;
    state.error = '';
    notify();
    // Pull first, so an older copy here can never overwrite a newer one from another device.
    var changed = 0;
    return (session ? pull() : Promise.resolve(0)).then(function (n) {
      changed = n;
      return push();
    }).then(function () {
      state.lastSync = Date.now();
      if (changed) window.dispatchEvent(new Event('folio:synced'));
    }).catch(function (err) {
      state.error = (err && err.message) || 'Sync failed.';
      schedule(30000);
    }).then(function () {
      state.busy = false;
      notify();
    });
  }

  function seedOutbox() {
    return Promise.all([Store.all('folders'), Store.all('notes'), Store.all('pages')]).then(function (r) {
      var stamp = 1; // Oldest possible, so copies already in the cloud win.
      r[0].forEach(function (x) { if (!outbox['folders:' + x.id]) outbox['folders:' + x.id] = stamp; });
      r[1].forEach(function (x) { if (x.id.indexOf('sh-') !== 0 && !outbox['notes:' + x.id]) outbox['notes:' + x.id] = x.updated || stamp; });
      r[2].forEach(function (x) { if (x.id.indexOf('sh:') !== 0 && !outbox['pages:' + x.id]) outbox['pages:' + x.id] = stamp + 1; });
      save(OUTBOX_KEY, outbox);
    });
  }

  function signIn(email, password) {
    return authRequest('token?grant_type=password', { email: email, password: password }).then(function (data) {
      keepSession(data);
      return seedOutbox();
    }).then(function () {
      notify();
      schedule(0);
    });
  }

  // Resolves true when signed in, or false when the address must be confirmed first.
  function signUp(email, password) {
    return authRequest('signup', { email: email, password: password }).then(function (data) {
      if (!data.access_token) return false;
      keepSession(data);
      return seedOutbox().then(function () {
        notify();
        schedule(0);
        return true;
      });
    });
  }

  function signOut() {
    var old = session;
    session = null;
    localStorage.removeItem(SESSION_KEY);
    localStorage.removeItem(CURSOR_KEY);
    localStorage.removeItem(UPLOADED_KEY);
    notify();
    if (old) {
      fetch(URL_BASE + '/auth/v1/logout', { method: 'POST', headers: { apikey: KEY, Authorization: 'Bearer ' + old.access_token } }).catch(function () {});
    }
  }

  // ---------- Sharing ----------

  function shareLink(tokenValue) {
    return location.origin + location.pathname + '#/s/' + tokenValue;
  }

  function sharesOf(noteId) {
    return api('/rest/v1/fol_shares?select=token,can_edit&note_id=eq.' + encodeURIComponent(noteId)).then(json);
  }

  function createShare(noteId, canEdit) {
    return run().then(function () {
      return api('/rest/v1/fol_shares?select=token', {
        method: 'POST', body: [{ owner: session.user.id, note_id: noteId, can_edit: canEdit }], headers: { Prefer: 'return=representation' }
      });
    }).then(json).then(function (rows) { return shareLink(rows[0].token); });
  }

  function stopSharing(noteId) {
    return api('/rest/v1/fol_shares?note_id=eq.' + encodeURIComponent(noteId), { method: 'DELETE' });
  }

  // Copies a shared note onto this device. Resolves to the local note id.
  function openShared(shareToken) {
    return rpc('fol_shared_get', { p_token: shareToken }).then(json).then(function (r) {
      if (!r) throw new Error('This share link no longer works.');
      var localId = 'sh-' + shareToken, prefix = 'sh:' + shareToken + ':', ownerNote = r.note.id;
      return Promise.all(r.pages.map(function (row) {
        var key = 'pages:' + prefix + row.id;
        if (outbox[key]) return null; // Unsent edits here stay until they have been sent.
        return unpack(row.blob).then(function (page) {
          page.id = prefix + row.id;
          page.noteId = localId;
          return page;
        });
      })).then(function (pages) {
        var incoming = pages.filter(Boolean);
        return Store.raw.putMany('pages', incoming).then(function () {
          return Store.get('notes', localId);
        }).then(function (local) {
          var note = Object.assign({}, r.note, {
            id: localId, title: (r.note.title || 'Shared note'),
            pageIds: (r.note.pageIds || []).map(function (x) { return prefix + x; }),
            folderId: null, thumb: r.note.thumb || (local && local.thumb),
            shared: { token: shareToken, canEdit: !!r.can_edit, ownerNote: ownerNote }
          });
          if (local && local.deletedAt) delete note.deletedAt;
          return Store.raw.put('notes', note);
        }).then(function () { return localId; });
      });
    });
  }

  window.addEventListener('online', function () { schedule(0); });
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'hidden') run();
    else schedule(500);
  });
  setInterval(function () { if (session) run(); }, 60000);

  window.Folio = window.Folio || {};
  window.Folio.Sync = {
    run: run, signIn: signIn, signUp: signUp, signOut: signOut, fetchAsset: fetchAsset,
    createShare: createShare, sharesOf: sharesOf, stopSharing: stopSharing, openShared: openShared,
    user: function () { return session && session.user; },
    state: function () { return { busy: state.busy, lastSync: state.lastSync, error: state.error, pending: Object.keys(outbox).length }; },
    subscribe: function (fn) { listeners.push(fn); }
  };
})();
