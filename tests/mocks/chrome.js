/**
 * In-memory stand-in for the chrome.* APIs the extension uses:
 * storage.local (+ onChanged), runtime (manifest, getURL, messaging, openOptionsPage),
 * action.onClicked and tabs.sendMessage.
 */
import { vi } from 'vitest';

let store = {};
let senderTab = null; // what runtime.sendMessage reports as sender.tab

function createEvent() {
  const listeners = new Set();
  return {
    addListener: (fn) => listeners.add(fn),
    removeListener: (fn) => listeners.delete(fn),
    hasListener: (fn) => listeners.has(fn),
    dispatch: (...args) => [...listeners].forEach((fn) => fn(...args)),
    clear: () => listeners.clear(),
    get size() { return listeners.size; },
  };
}

const copy = (v) => (v === undefined ? undefined : structuredClone(v));

export const chrome = {
  storage: {
    onChanged: createEvent(),
    local: {
      async get(keys) {
        const wanted = keys == null ? Object.keys(store) : [].concat(keys);
        const out = {};
        wanted.forEach((k) => { if (k in store) out[k] = copy(store[k]); });
        return out;
      },
      async remove(keys) {
        const changes = {};
        [].concat(keys).forEach((key) => {
          if (key in store) {
            changes[key] = { oldValue: copy(store[key]), newValue: undefined };
            delete store[key];
          }
        });
        queueMicrotask(() => chrome.storage.onChanged.dispatch(changes, 'local'));
      },
      async set(items) {
        const changes = {};
        Object.keys(items).forEach((key) => {
          changes[key] = { oldValue: copy(store[key]), newValue: copy(items[key]) };
        });
        Object.assign(store, structuredClone(items));
        queueMicrotask(() => chrome.storage.onChanged.dispatch(changes, 'local'));
      },
    },
  },

  runtime: {
    getManifest: () => ({ version: '1.0.0' }),
    getURL: (path) => 'chrome-extension://test/' + path,
    onMessage: createEvent(),
    openOptionsPage: vi.fn(async () => {}),
    sendMessage: vi.fn(async () => {}),
  },

  action: { onClicked: createEvent() },

  tabs: { sendMessage: vi.fn(async () => {}) },
};

export function resetChrome() {
  store = {};
  senderTab = null;
  [chrome.storage.onChanged, chrome.runtime.onMessage, chrome.action.onClicked].forEach((ev) => ev.clear());
  chrome.runtime.sendMessage.mockClear();
  chrome.runtime.openOptionsPage.mockClear();
  chrome.tabs.sendMessage.mockClear();
}

/** Direct read of one persisted key, for assertions. */
export function peekStorage(key) {
  return store[key];
}

/** Direct write, to seed saved settings before init: seedStorage('sort', 'price') or seedStorage({ sort: 'price', ... }). */
export function seedStorage(keyOrObject, value) {
  const items = typeof keyOrObject === 'string' ? { [keyOrObject]: value } : keyOrObject;
  Object.assign(store, structuredClone(items));
}

/** Let queued microtasks (storage change events) run. */
export const flush = async () => {
  for (let i = 0; i < 5; i++) await Promise.resolve();
};
