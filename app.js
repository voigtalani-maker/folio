// Folio routing and start-up.
(function () {
  'use strict';
  var library = document.getElementById('library');
  var editor = document.getElementById('editor');
  var navigation = Promise.resolve();

  function showView(isEditor) {
    library.hidden = isEditor;
    editor.hidden = !isEditor;
  }

  // Opens files handed to Folio, then shows the last one.
  function openFiles(files) {
    if (!files.length) return Folio.Library.show({ kind: 'all' });
    Folio.UI.toast('Opening ' + (files.length === 1 ? files[0].name : files.length + ' files') + '…');
    return files.reduce(function (chain, f) {
      return chain.then(function () { return Folio.Docs.openFile(f, null); });
    }, Promise.resolve()).then(function (note) {
      if (note.keptAsFile) Folio.UI.toast(note.openError || 'Folio can\'t show this type of file, so it\'s saved as an attachment on the page.');
      location.hash = '#/n/' + note.id;
    });
  }
  window.Folio.openFiles = openFiles;

  function route() {
    var parts = location.hash.replace(/^#\/?/, '').split('/');
    navigation = navigation.then(function () {
      return Folio.Editor.close();
    }).then(function () {
      if (parts[0] === 'n' && parts[1]) {
        showView(true);
        return Folio.Editor.open(parts[1]).then(function (found) {
          if (found === 'locked') {
            location.hash = '#/';
          } else if (!found) {
            Folio.UI.toast('That note could not be found.');
            location.hash = '#/';
          }
        });
      }
      showView(false);
      if (parts[0] === 'f' && parts[1]) return Folio.Library.show({ kind: 'folder', id: parts[1] });
      if (parts[0] === 'favourites') return Folio.Library.show({ kind: 'favourites' });
      if (parts[0] === 'trash') return Folio.Library.show({ kind: 'trash' });
      if (parts[0] === 's' && parts[1]) {
        // A share link: copy the note here, then open it.
        return Folio.Sync.openShared(parts[1]).then(function (id) {
          location.replace('#/n/' + id);
        }).catch(function (err) {
          Folio.UI.toast(err.message);
          location.replace('#/');
        });
      }
      if (parts[0] === 'incoming') {
        return Folio.Docs.takeSharedFiles().then(function (files) {
          history.replaceState(null, '', '#/');
          return openFiles(files);
        });
      }
      if (parts[0] === 't' && parts[1]) return Folio.Library.show({ kind: 'tag', tag: decodeURIComponent(parts[1]) });
      if (parts[0] === 'new') {
        // The home-screen "New note" shortcut lands here.
        return Folio.Library.show({ kind: 'all' }).then(function () {
          history.replaceState(null, '', '#/');
          Folio.Library.newNote();
        });
      }
      return Folio.Library.show({ kind: 'all' });
    }).catch(function (err) {
      Folio.UI.toast('Something went wrong: ' + (err && err.message || 'unknown error'));
    });
  }

  // "Open with Folio", where the device supports it.
  if ('launchQueue' in window) {
    window.launchQueue.setConsumer(function (params) {
      if (!params.files || !params.files.length) return;
      Promise.all(params.files.map(function (h) { return h.getFile(); })).then(openFiles).catch(function (err) {
        Folio.UI.toast('Could not open that file: ' + err.message);
      });
    });
  }

  window.addEventListener('hashchange', route);
  route();

  if ('serviceWorker' in navigator && location.protocol === 'https:') {
    navigator.serviceWorker.register('sw.js').catch(function () { /* the app still works online */ });
  }
})();
