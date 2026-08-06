// Node 26 ships its own `localStorage` global that resolves to `undefined`
// unless the process was started with `--localstorage-file`, and it shadows the
// one jsdom provides. Anything reading `window.localStorage` — useSettings, and
// so every hook that depends on a configured instance — would see nothing.
//
// Install a spec-shaped in-memory store when that happens, and reset it between
// files so one spec cannot leak settings into the next.
if (typeof window !== 'undefined' && !window.localStorage) {
  const store = new Map<string, string>()
  const memoryStorage: Storage = {
    get length() {
      return store.size
    },
    clear: () => store.clear(),
    getItem: (key) => (store.has(key) ? store.get(key)! : null),
    key: (index) => [...store.keys()][index] ?? null,
    removeItem: (key) => {
      store.delete(key)
    },
    setItem: (key, value) => {
      store.set(String(key), String(value))
    },
  }

  for (const target of [window, globalThis]) {
    Object.defineProperty(target, 'localStorage', {
      value: memoryStorage,
      configurable: true,
      writable: true,
    })
  }
}
