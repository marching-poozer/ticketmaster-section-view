// Runs at document_start, before the page has asked for its tickets: loads the
// module that watches the page's requests for Ticketmaster's list API (capture.js),
// which loader.js's modules then share. Content scripts can't use static imports.
(function () {
  try {
    import(chrome.runtime.getURL('src/content/capture.js')).catch(function () {});
  } catch (err) {
    // No extension context (it was reloaded or removed under this page): nothing to do.
  }
})();
