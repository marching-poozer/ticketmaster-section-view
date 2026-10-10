// Runs at document_start, before the page has asked for its tickets: loads the modules that watch the page as it loads: the
// one that notes its requests for Ticketmaster's list API (capture.js) and the one that receives the seat map's data from
// the page (map-data-store.js, fed by main-hook.js in the page's own world). loader.js's modules share both.
// Content scripts can't use static imports.
(function () {
  ['capture.js', 'map-data-store.js'].forEach(function (name) {
    try {
      import(chrome.runtime.getURL('src/content/' + name)).catch(function () {});
    } catch (err) {
      // No extension context (it was reloaded or removed under this page): nothing to do.
    }
  });
})();
