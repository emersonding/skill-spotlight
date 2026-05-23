const isE2e = new URLSearchParams(window.location.search).get('e2e') === '1';

let registeredHotkey = '';

async function installE2eApi() {
  const fixture = window.__SKILLSPOTLIGHT_E2E__ || {};
  const stateCallbacks = [];
  const shownCallbacks = [];
  window.__SKILLSPOTLIGHT_E2E_APPLY_SYNC_CALLS__ = [];
  window.__SKILLSPOTLIGHT_E2E_CALLS__ = [];
  let undoEntries = null;
  let state = {
    config: { entries: [], recentSources: [], hotkey: { key: 'Space', modifiers: ['option'] }, theme: 'light' },
    effectiveEntries: [],
    sourceGroups: [],
    hotkeyAccelerator: 'Alt+Space',
    configPath: fixture.configPath || '/tmp/skillspotlight-tauri-e2e/config.json',
  };

  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function emitState() {
    const payload = clone(state);
    for (const callback of stateCallbacks) callback(payload);
  }

  function normalizePrefix(prefix) {
    return String(prefix || '').trim();
  }

  function recordCall(name, payload = {}) {
    window.__SKILLSPOTLIGHT_E2E_CALLS__.push({ name, ...clone(payload) });
  }

  function rebuildSourceGroups() {
    state.effectiveEntries = clone(state.config.entries);
    state.sourceGroups = state.config.recentSources.map((source) => ({
      ...source,
      missing: false,
      snippets: state.config.entries.filter((entry) => entry.kind === 'directory' && entry.sourceId === source.id),
    }));
  }

  function scanFixtureSource(source) {
    const entries = fixture.directoryEntries || [];
    return entries.map((entry) => ({
      key: `${normalizePrefix(source.lastPrefix)}${entry.name}`,
      value: entry.value,
      kind: 'directory',
      sourceId: source.id,
      sourcePath: source.path,
      name: entry.name,
    }));
  }

  window.skillSpotlight = {
    homeDir: fixture.homeDir || '',
    getState: async () => clone(state),
    hide: async () => {
      recordCall('hide');
      return { ok: true };
    },
    setRoute: async () => ({ ok: true }),
    pasteEntry: async (entry) => {
      recordCall('pasteEntry', { entry });
      return { mode: 'paste' };
    },
    copyEntry: async (entry) => {
      recordCall('copyEntry', { entry });
      return { ok: true };
    },
    revealEntry: async (entry) => {
      recordCall('revealEntry', { entry });
      return undefined;
    },
    saveEntries: async (entries) => {
      undoEntries = clone(state.config.entries);
      state.config.entries = clone(entries);
      rebuildSourceGroups();
      emitState();
      return { ok: true };
    },
    setTheme: async (theme) => {
      recordCall('setTheme', { theme });
      state.config.theme = theme === 'dark' ? 'dark' : 'light';
      emitState();
      return { ok: true };
    },
    undo: async () => {
      recordCall('undo');
      if (!undoEntries) return { ok: false };
      const current = clone(state.config.entries);
      state.config.entries = undoEntries;
      undoEntries = current;
      rebuildSourceGroups();
      emitState();
      return { ok: true };
    },
    chooseSyncDirectory: async () => fixture.fixtureDir || null,
    applySync: async (source, replaceKeys = []) => {
      window.__SKILLSPOTLIGHT_E2E_APPLY_SYNC_CALLS__.push(clone(source));
      recordCall('applySync', { source });
      undoEntries = clone(state.config.entries);
      const sourceId = source.id || `source-${Date.now()}`;
      const nextSource = {
        id: sourceId,
        path: source.path,
        lastPrefix: normalizePrefix(source.lastPrefix),
        expanded: source.expanded !== false,
      };
      state.config.recentSources = [
        nextSource,
        ...state.config.recentSources.filter((item) => item.id !== sourceId && item.path !== nextSource.path),
      ].slice(0, 12);
      state.config.entries = [
        ...state.config.entries.filter((entry) => entry.kind !== 'directory' || entry.sourceId !== sourceId),
        ...scanFixtureSource(nextSource),
      ];
      rebuildSourceGroups();
      emitState();
      return { ok: true, ignoredReplaceKeys: replaceKeys };
    },
    saveSource: async (source) => {
      recordCall('saveSource', { source });
      state.config.recentSources = [
        source,
        ...state.config.recentSources.filter((item) => item.id !== source.id),
      ];
      state.config.entries = state.config.entries.map((entry) => {
        if (entry.kind !== 'directory' || entry.sourceId !== source.id) return entry;
        return { ...entry, key: `${normalizePrefix(source.lastPrefix)}${entry.name}`, sourcePath: source.path };
      });
      rebuildSourceGroups();
      emitState();
      return { ok: true };
    },
    removeSource: async (sourceId) => {
      recordCall('removeSource', { sourceId });
      state.config.recentSources = state.config.recentSources.filter((source) => source.id !== sourceId);
      state.config.entries = state.config.entries.filter((entry) => entry.kind !== 'directory' || entry.sourceId !== sourceId);
      rebuildSourceGroups();
      emitState();
      return { ok: true };
    },
    syncAll: async () => {
      recordCall('syncAll');
      state.config.recentSources = state.config.recentSources.map((source) => ({ ...source }));
      state.config.entries = [
        ...state.config.entries.filter((entry) => entry.kind !== 'directory'),
        ...state.config.recentSources.flatMap((source) => scanFixtureSource(source)),
      ];
      rebuildSourceGroups();
      emitState();
      return undefined;
    },
    setHotkey: async (accelerator) => {
      recordCall('setHotkey', { accelerator });
      state.hotkeyAccelerator = accelerator;
      emitState();
      return { ok: true, accelerator };
    },
    reloadConfig: async () => {
      recordCall('reloadConfig');
      return { ok: true };
    },
    revealConfig: async () => {
      recordCall('revealConfig');
      return undefined;
    },
    revealSource: async (path) => {
      recordCall('revealSource', { path });
      return undefined;
    },
    onShown: (callback) => {
      shownCallbacks.push(callback);
      queueMicrotask(() => callback({ route: 'settings' }));
    },
    onState: (callback) => {
      stateCallbacks.push(callback);
    },
  };

  await import('./renderer/app.js');
}

async function installTauriApi() {
  const { invoke } = await import('@tauri-apps/api/core');
  const { listen } = await import('@tauri-apps/api/event');
  const { register, unregisterAll } = await import('@tauri-apps/plugin-global-shortcut');

  async function registerHotkey(accelerator) {
  await unregisterAll();
  registeredHotkey = '';
  if (!accelerator) return { ok: false, accelerator: '' };

  try {
    await register(accelerator, (event) => {
      if (event.state === 'Pressed') {
        void invoke('toggle_window');
      }
    });
    registeredHotkey = accelerator;
    return { ok: true, accelerator };
  } catch {
    return { ok: false, accelerator };
  }
}

  window.skillSpotlight = {
  homeDir: '',
  getState: () => invoke('get_state'),
  hide: () => invoke('hide'),
  setRoute: (route) => invoke('set_route', { route }),
  pasteEntry: (entry) => invoke('paste_entry', { entry }),
  copyEntry: (entry) => invoke('copy_entry', { entry }),
  revealEntry: (entry) => invoke('reveal_entry', { entry }),
  saveEntries: (entries) => invoke('save_entries', { entries }),
  setTheme: (theme) => invoke('set_theme', { theme }),
  undo: () => invoke('undo'),
  chooseSyncDirectory: () => invoke('choose_sync_directory'),
  applySync: (source) => invoke('apply_sync', { source }),
  saveSource: (source) => invoke('save_source', { source }),
  removeSource: (sourceId) => invoke('remove_source', { sourceId }),
  syncAll: () => invoke('sync_all'),
  setHotkey: async (accelerator) => {
    const result = await registerHotkey(accelerator);
    if (result.ok) await invoke('set_hotkey', { accelerator });
    return result;
  },
  reloadConfig: async () => {
    const result = await invoke('reload_config');
    const state = await invoke('get_state');
    await registerHotkey(state.hotkeyAccelerator);
    return result;
  },
  revealConfig: () => invoke('reveal_config'),
  revealSource: (path) => invoke('reveal_source', { path }),
  onShown: (callback) => {
    void listen('shown', (event) => callback(event.payload));
  },
  onState: (callback) => {
    void listen('state', (event) => callback(event.payload));
  },
};

  const homeDir = await invoke('get_home_dir');
  window.skillSpotlight.homeDir = homeDir;

  const initialState = await invoke('get_state');
  await registerHotkey(initialState.hotkeyAccelerator);

  window.addEventListener('beforeunload', () => {
    if (registeredHotkey) void unregisterAll();
  });

  await import('./renderer/app.js');
}

if (isE2e) {
  await installE2eApi();
} else {
  await installTauriApi();
}
