// Messages between the content script and the extension's service worker.
export const MSG = {
  // service worker -> content script: the toolbar icon was clicked.
  TOGGLE_VIEW: 'toggle-view',
  // content script -> service worker: open the options page (content scripts can't).
  OPEN_OPTIONS: 'open-options',
};
