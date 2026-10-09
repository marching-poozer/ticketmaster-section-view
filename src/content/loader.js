// Content scripts declared in the manifest are classic scripts and can't use
// static `import`. This tiny shim pulls in the real ES-module entry point
// (everything it imports is listed in web_accessible_resources).
(async function () {
  try {
    const { initDisplay } = await import(chrome.runtime.getURL('src/content/display.js'));
    await initDisplay();
  } catch (err) {
    console.error('[Section View]: failed to start:', err);
  }
})();
