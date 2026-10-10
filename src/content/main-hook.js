// Runs in the PAGE's own world, at document_start, before the page's scripts: hands the extension two responses the page itself
// asks for when it loads its seat map, as the page receives them (nothing is requested again, nothing is sent anywhere):
//   - the map's geometry   .../maps/geometry/<n>/event/<id>/placeDetailNoKeys
//   - the seats on sale    .../api/ismds/(host|event)/<id>/facets?q=available&...&show=places&...
// The page's fetch and XMLHttpRequest are wrapped so that they work exactly as before; for a request of one of those two kinds the
// response is read from a CLONE and posted to the extension (content/map-data-store.js) with window.postMessage. The URL is not
// passed on (it carries the page's own API key); the extension needs only the text. The latest of each is kept here too, and
// posted again when the extension says hello (its modules load a little after the page starts: it may not have been listening yet).
// A plain script: no imports in this world.
(function () {
  'use strict';
  if (window.__tmsvMainHook) return;
  window.__tmsvMainHook = true;

  var GEOMETRY = /\/maps\/geometry\/\d+\/event\/[^/?]+\/placeDetailNoKeys/;
  var FACETS = /\/api\/ismds\/(?:host|event)\/[^/?]+\/facets/;

  function kindOf(url) {
    var text = String(url);
    if (GEOMETRY.test(text)) return 'geometry';
    // only the request for every seat on sale (not a narrower one the page may make for something else)
    if (FACETS.test(text) && /[?&]show=places(?:&|$)/.test(text) && /[?&]q=available(?:&|$)/.test(text)) return 'facets';
    return null;
  }

  var latest = {}; // kind -> the text of the latest response

  function post(kind, text) {
    try {
      var origin = window.location.origin;
      window.postMessage({ __tmsv: 1, kind: kind, text: text }, origin && origin !== 'null' ? origin : '*');
    } catch (err) { /* never the page's problem */ }
  }

  function send(kind, text) {
    latest[kind] = text;
    post(kind, text);
  }

  window.addEventListener('message', function (event) {
    try {
      var data = event.data;
      if (event.source === window && data && data.__tmsv === 1 && data.kind === 'hello') Object.keys(latest).forEach(function (kind) { post(kind, latest[kind]); });
    } catch (err) { /* ignore */ }
  });

  var originalFetch = window.fetch;
  if (typeof originalFetch === 'function') {
    window.fetch = function (input) {
      var promise = originalFetch.apply(this, arguments);
      try {
        var url = typeof input === 'string' ? input : input && input.url ? input.url : String(input);
        var kind = kindOf(url);
        if (kind) {
          promise.then(function (response) {
            try {
              if (response && response.ok) response.clone().text().then(function (text) { send(kind, text); }, function () {});
            } catch (err) { /* ignore */ }
          }, function () {});
        }
      } catch (err) { /* ignore */ }
      return promise;
    };
  }

  var proto = window.XMLHttpRequest && window.XMLHttpRequest.prototype;
  if (proto && proto.open && proto.send) {
    var originalOpen = proto.open;
    var originalSend = proto.send;
    proto.open = function (method, url) {
      try { this.__tmsvKind = kindOf(url); } catch (err) { /* ignore */ }
      return originalOpen.apply(this, arguments);
    };
    proto.send = function () {
      var xhr = this;
      try {
        if (xhr.__tmsvKind) {
          xhr.addEventListener('load', function () {
            try {
              if (xhr.status < 200 || xhr.status >= 300) return;
              var text = xhr.responseType === '' || xhr.responseType === 'text' ? xhr.responseText : xhr.responseType === 'json' ? JSON.stringify(xhr.response) : null;
              if (text) send(xhr.__tmsvKind, text);
            } catch (err) { /* ignore */ }
          });
        }
      } catch (err) { /* ignore */ }
      return originalSend.apply(this, arguments);
    };
  }
})();
