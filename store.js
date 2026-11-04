// Folio storage: everything lives in IndexedDB on this device (no cloud yet).
(function () {
  'use strict';
  var DB_NAME = 'folio';
  var STORES = ['folders', 'notes', 'pages', 'assets'];
  var dbPromise = null;

  function open() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise(function (resolve, reject) {
      var req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = function () {
        var db = req.result;
        STORES.forEach(function (name) {
          if (!db.objectStoreNames.contains(name)) {
            var store = db.createObjectStore(name, { keyPath: 'id' });
            if (name === 'pages') store.createIndex('noteId', 'noteId');
          }
        });
      };
      req.onsuccess = function () { resolve(req.result); };
      req.onerror = function () { reject(req.error); };
    });
    return dbPromise;
  }

  function run(store, mode, fn) {
    return open().then(function (db) {
      return new Promise(function (resolve, reject) {
        var tx = db.transaction(store, mode);
        var result;
        var req = fn(tx.objectStore(store));
        if (req) req.onsuccess = function () { result = req.result; };
        tx.oncomplete = function () { resolve(result); };
        tx.onerror = function () { reject(tx.error); };
        tx.onabort = function () { reject(tx.error); };
      });
    });
  }

  var Store = {
    all: function (store) { return run(store, 'readonly', function (s) { return s.getAll(); }); },
    get: function (store, id) { return run(store, 'readonly', function (s) { return s.get(id); }); },
    put: function (store, value) { return run(store, 'readwrite', function (s) { return s.put(value); }); },
    del: function (store, id) { return run(store, 'readwrite', function (s) { return s.delete(id); }); },
    putMany: function (store, values) {
      return run(store, 'readwrite', function (s) { values.forEach(function (v) { s.put(v); }); });
    },
    pagesOf: function (noteId) {
      return run('pages', 'readonly', function (s) { return s.index('noteId').getAll(noteId); });
    },
    // Permanently removes a note, its pages and any images only it used.
    purgeNote: function (note) {
      return Store.pagesOf(note.id).then(function (pages) {
        var ids = {};
        pages.forEach(function (p) {
          p.items.forEach(function (it) { if (it.type === 'image') ids[it.asset] = true; });
        });
        return Promise.all(pages.map(function (p) { return Store.del('pages', p.id); }))
          .then(function () { return Store.del('notes', note.id); })
          .then(function () { return Store.all('pages'); })
          .then(function (rest) {
            rest.forEach(function (p) {
              p.items.forEach(function (it) { if (it.type === 'image') delete ids[it.asset]; });
            });
            return Promise.all(Object.keys(ids).map(function (id) { return Store.del('assets', id); }));
          });
      });
    },
    exportAll: function () {
      return Promise.all(STORES.map(Store.all)).then(function (r) {
        var assets = r[3];
        return Promise.all(assets.map(function (a) {
          return new Promise(function (resolve, reject) {
            var fr = new FileReader();
            fr.onload = function () { resolve({ id: a.id, data: fr.result }); };
            fr.onerror = function () { reject(fr.error); };
            fr.readAsDataURL(a.blob);
          });
        })).then(function (encoded) {
          return { app: 'folio', version: 1, exportedAt: Date.now(), folders: r[0], notes: r[1], pages: r[2], assets: encoded };
        });
      });
    },
    // Restoring adds to the library; items with the same id are replaced by the backup copy.
    importAll: function (data) {
      if (!data || data.app !== 'folio') return Promise.reject(new Error('This is not a Folio backup file.'));
      return Promise.all((data.assets || []).map(function (a) {
        return fetch(a.data).then(function (r) { return r.blob(); }).then(function (blob) {
          return { id: a.id, blob: blob };
        });
      })).then(function (assets) {
        return Promise.all([
          Store.putMany('folders', data.folders || []),
          Store.putMany('notes', data.notes || []),
          Store.putMany('pages', data.pages || []),
          Store.putMany('assets', assets)
        ]);
      });
    }
  };

  window.Folio = window.Folio || {};
  window.Folio.Store = Store;
})();
