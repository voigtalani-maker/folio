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

  function route() {
    var parts = location.hash.replace(/^#\/?/, '').split('/');
    navigation = navigation.then(function () {
      return Folio.Editor.close();
    }).then(function () {
      if (parts[0] === 'n' && parts[1]) {
        showView(true);
        return Folio.Editor.open(parts[1]).then(function (found) {
          if (!found) {
            Folio.UI.toast('That note could not be found.');
            location.hash = '#/';
          }
        });
      }
      showView(false);
      if (parts[0] === 'f' && parts[1]) return Folio.Library.show({ kind: 'folder', id: parts[1] });
      if (parts[0] === 'favourites') return Folio.Library.show({ kind: 'favourites' });
      if (parts[0] === 'trash') return Folio.Library.show({ kind: 'trash' });
      return Folio.Library.show({ kind: 'all' });
    }).catch(function (err) {
      Folio.UI.toast('Something went wrong: ' + (err && err.message || 'unknown error'));
    });
  }

  window.addEventListener('hashchange', route);
  route();

  if ('serviceWorker' in navigator && location.protocol === 'https:') {
    navigator.serviceWorker.register('sw.js').catch(function () { /* the app still works online */ });
  }
})();
