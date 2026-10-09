/**
 * Vitest global setup — runs before every test file.
 *
 * Installs the in-memory chrome.* mock and stubs the browser APIs jsdom
 * doesn't implement (scrollIntoView, window.scrollTo).
 */
import { afterEach, beforeEach, vi } from 'vitest';
import { chrome, resetChrome } from './mocks/chrome.js';

globalThis.chrome = chrome;

// Under vitest, jsdom rejects `view: window` ("member view is not of type
// Window") because the global `window` isn't jsdom's own Window object. Real
// browsers accept it, so production code passes it; tests just drop it.
for (const name of ['MouseEvent', 'WheelEvent']) {
  const Native = globalThis[name];
  globalThis[name] = class extends Native {
    constructor(type, init = {}) {
      const { view, ...rest } = init;
      super(type, rest);
    }
  };
}

beforeEach(() => {
  resetChrome();
  document.head.innerHTML = '';
  document.body.innerHTML = '';
  document.body.removeAttribute('style');

  Element.prototype.scrollIntoView = vi.fn();
  window.scrollTo = vi.fn();
  // Silence the [Section View] diagnostic logging so test output stays readable.
  vi.spyOn(console, 'log').mockImplementation(() => {});
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});
