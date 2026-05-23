const api = window.skillSpotlight;

let state = {
  config: { entries: [], recentSources: [], hotkey: {}, theme: 'light' },
  effectiveEntries: [],
  sourceGroups: [],
  hotkeyAccelerator: 'Alt+Space',
  configPath: '',
};
let query = '';
let snippetFilter = '';
let selectedIndex = 0;
let editingDirectIndex = null;
let route = 'search';
let ignoreHoverSelection = false;
let lastMousePosition = null;

const els = {
  shell: document.getElementById('app'),
  search: document.getElementById('search'),
  hotkey: document.getElementById('hotkey'),
  results: document.getElementById('results'),
  searchView: document.getElementById('searchView'),
  settingsView: document.getElementById('settingsView'),
  prefsBtn: document.getElementById('prefsBtn'),
  entryList: document.getElementById('entryList'),
  sourceGroups: document.getElementById('sourceGroups'),
  addEntry: document.getElementById('addEntry'),
  addDirectory: document.getElementById('addDirectory'),
  sourcePathInput: document.getElementById('sourcePathInput'),
  sourcePrefixInput: document.getElementById('sourcePrefixInput'),
  undo: document.getElementById('undo'),
  themeSelect: document.getElementById('themeSelect'),
  hotkeyInput: document.getElementById('hotkeyInput'),
  saveHotkey: document.getElementById('saveHotkey'),
  hotkeyStatus: document.getElementById('hotkeyStatus'),
  configPath: document.getElementById('configPath'),
  revealConfig: document.getElementById('revealConfig'),
  reloadConfig: document.getElementById('reloadConfig'),
  snippetFilter: document.getElementById('snippetFilter'),
  newKey: document.getElementById('newKey'),
  newValue: document.getElementById('newValue'),
  snippetCount: document.querySelector('[data-count="snippets"]'),
  metaDirect: document.querySelector('[data-meta="direct"]'),
  metaDir: document.querySelector('[data-meta="dir"]'),
  chooseDirBtn: document.getElementById('chooseDirBtn'),
  confirmDialog: document.getElementById('confirmDialog'),
  confirmTitle: document.getElementById('confirmTitle'),
  confirmBody: document.getElementById('confirmBody'),
  confirmOk: document.getElementById('confirmOk'),
  confirmCancel: document.getElementById('confirmCancel'),
};

let confirmResolver = null;

function showConfirm({ title = 'Are you sure?', body = '', okLabel = 'Confirm', cancelLabel = 'Cancel', destructive = false } = {}) {
  els.confirmTitle.textContent = title;
  els.confirmBody.textContent = body;
  els.confirmOk.textContent = okLabel;
  els.confirmCancel.textContent = cancelLabel;
  els.confirmCancel.classList.toggle('hidden', cancelLabel === null);
  els.confirmOk.classList.toggle('danger-action', destructive);
  els.confirmDialog.classList.remove('hidden');
  els.confirmDialog.setAttribute('aria-hidden', 'false');
  setTimeout(() => els.confirmOk.focus(), 0);
  return new Promise((resolve) => { confirmResolver = resolve; });
}

function showAlert({ title, body, okLabel = 'OK' } = {}) {
  return showConfirm({ title, body, okLabel, cancelLabel: null, destructive: false });
}

function closeConfirm(result) {
  els.confirmDialog.classList.add('hidden');
  els.confirmDialog.setAttribute('aria-hidden', 'true');
  if (confirmResolver) {
    const r = confirmResolver;
    confirmResolver = null;
    r(result);
  }
}

function scoreToken(qRaw, targetRaw) {
  const q = Array.from(String(qRaw || '').toLowerCase());
  const target = Array.from(String(targetRaw || '').toLowerCase());
  if (!q.length) return 0;
  let qi = 0;
  let score = 0;
  let prev = -1;
  let boundary = true;
  for (let ti = 0; ti < target.length && qi < q.length; ti += 1) {
    const ch = target[ti];
    if (ch === q[qi]) {
      score += 10;
      if (ti === 0) score += 50;
      if (boundary) score += 20;
      if (prev === ti - 1) score += 15;
      prev = ti;
      qi += 1;
    }
    boundary = ch === '-' || ch === '_' || ch === ' ' || ch === '/' || ch === ':';
  }
  return qi === q.length ? score : null;
}

function scoreEntry(qRaw, targetRaw) {
  const rawQuery = String(qRaw || '').trim().toLowerCase();
  const rawTarget = String(targetRaw || '').toLowerCase();
  if (!rawQuery) return 0;

  const tokens = rawQuery.split(/\s+/).filter(Boolean);
  let matchedTokens = 0;
  let total = 0;

  for (const token of tokens) {
    const exactIndex = rawTarget.indexOf(token);
    if (exactIndex !== -1) {
      matchedTokens += 1;
      total += 1000 + token.length * 25;
      if (exactIndex === 0) total += 500;
      if (exactIndex > 0 && /[-_ /:]/.test(rawTarget[exactIndex - 1])) total += 250;
      total -= exactIndex;
      continue;
    }

    const fuzzyScore = scoreToken(token, targetRaw);
    if (fuzzyScore !== null) {
      matchedTokens += 1;
      total += fuzzyScore;
    }
  }

  if (!matchedTokens) return null;
  return matchedTokens * 100000 + total;
}

function searchEntries(q, entries) {
  if (!q) return [...entries].sort((a, b) => a.key.localeCompare(b.key));
  return entries
    .map((entry) => ({ entry, score: scoreEntry(q, entry.key) }))
    .filter((item) => item.score !== null)
    .sort((a, b) => b.score - a.score || a.entry.key.localeCompare(b.entry.key))
    .map((item) => item.entry);
}

function currentResults() {
  return searchEntries(query, state.effectiveEntries || []);
}

function middleTruncate(value, max = 80) {
  const text = String(value || '');
  if (text.length <= max) return text;
  const keep = Math.floor((max - 1) / 2);
  return `${text.slice(0, keep)}...${text.slice(-keep)}`;
}

function escapeHtml(value) {
  return String(value || '').replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
}

function escapeAttr(value) {
  return escapeHtml(value).replace(/`/g, '&#96;');
}

// Build a regex that matches any contiguous run of characters from the query.
// Used for visual highlighting only — not for scoring.
function buildHighlightRegex(q) {
  const tokens = String(q || '').trim().split(/\s+/).filter(Boolean);
  if (!tokens.length) return null;
  const escaped = tokens.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  return new RegExp(`(${escaped.join('|')})`, 'ig');
}

function highlight(text, regex) {
  const safe = escapeHtml(text);
  if (!regex) return safe;
  return safe.replace(regex, '<span class="hi">$1</span>');
}

function resolveEntryIcon(entry) {
  return entry.kind === 'directory' ? 'folder' : 'direct';
}

function iconSvg(id) {
  return `<svg aria-hidden="true"><use href="#i-${id}"/></svg>`;
}

function entrySourceLabel(entry) {
  if (entry.kind === 'directory' || entry.sourceId) {
    const prefix = String(entry.key || '').split(':')[0];
    return { label: prefix ? `${prefix}:` : 'directory', cls: 'dir' };
  }
  return { label: 'direct', cls: 'snip' };
}

function applyTheme() {
  const theme = state.config.theme === 'dark' ? 'dark' : 'light';
  document.documentElement.dataset.theme = theme;
  els.themeSelect.value = theme;
}

function setRoute(next) {
  route = next;
  void api.setRoute(route);
  els.searchView.classList.toggle('hidden', route !== 'search');
  els.settingsView.classList.toggle('hidden', route !== 'settings');
  els.shell.classList.toggle('settings-mode', route === 'settings');
  if (route === 'search') {
    requestAnimationFrame(() => {
      els.search.focus();
      els.search.select();
    });
  }
}

function renderResults() {
  const results = currentResults();
  selectedIndex = Math.max(0, Math.min(selectedIndex, Math.max(0, results.length - 1)));
  els.results.innerHTML = '';

  if (!results.length) {
    const empty = document.createElement('div');
    empty.className = 'empty';
    empty.textContent = query ? 'No matches' : 'No snippets yet — open Preferences to add some.';
    els.results.append(empty);
    return;
  }

  const hi = buildHighlightRegex(query);

  results.forEach((entry, index) => {
    const row = document.createElement('button');
    row.className = `result-row${index === selectedIndex ? ' selected' : ''}`;
    const src = entrySourceLabel(entry);
    const showSpark = !query && index === 0; // gentle "best match" hint when idle

    row.innerHTML = `
      <span class="row-icon">${iconSvg(resolveEntryIcon(entry))}</span>
      <span class="key">${highlight(entry.key, hi)}</span>
      <span class="value">${highlight(middleTruncate(entry.value), hi)}</span>
      <span class="kind">${escapeHtml(src.label)}</span>
      <span class="arrow">↵</span>
      ${showSpark ? '<span class="spark" aria-hidden="true"></span>' : ''}
    `;
    row.addEventListener('mouseenter', () => {
      if (ignoreHoverSelection) return;
      if (selectedIndex === index) return;
      selectedIndex = index;
      renderResults();
    });
    row.addEventListener('click', () => {
      ignoreHoverSelection = false;
      selectedIndex = index;
      void api.pasteEntry(entry);
    });
    els.results.append(row);
  });

  els.results
    .querySelector('.result-row.selected')
    ?.scrollIntoView({ block: 'nearest' });
}

function renderSettings() {
  applyTheme();
  els.hotkey.textContent = state.hotkeyAccelerator || 'Alt+Space';
  els.hotkeyInput.value = state.hotkeyAccelerator || 'Alt+Space';
  els.configPath.textContent = state.configPath || '';
  renderRegularSnippets();
  renderSourceGroups();
  updateSnippetCount();
}

function matchesFilter(entry, needle) {
  if (!needle) return true;
  const q = needle.toLowerCase();
  return (
    String(entry.key || '').toLowerCase().includes(q) ||
    String(entry.value || '').toLowerCase().includes(q)
  );
}

function renderRegularSnippets() {
  els.entryList.innerHTML = '';
  const entries = (state.config.entries || [])
    .map((entry, index) => ({ ...entry, index }))
    .filter((entry) => entry.kind !== 'directory')
    .filter((entry) => matchesFilter(entry, snippetFilter));

  if (!entries.length) {
    const empty = document.createElement('div');
    empty.className = 'item-empty';
    empty.textContent = snippetFilter ? 'No snippets match the filter.' : 'No direct snippets yet — add one above.';
    els.entryList.append(empty);
    return;
  }

  for (const entry of entries) {
    const row = document.createElement('div');
    row.className = 'item direct';
    row.dataset.index = String(entry.index);
    const isEditing = editingDirectIndex === entry.index;
    if (isEditing) {
      row.classList.add('editing');
      row.innerHTML = `
        <span class="ico">${iconSvg('direct')}</span>
        <input class="text-field" data-field="key" data-index="${entry.index}" value="${escapeAttr(entry.key)}" placeholder="key" autocomplete="off" spellcheck="false">
        <input class="text-field" data-field="value" data-index="${entry.index}" value="${escapeAttr(entry.value)}" placeholder="value" autocomplete="off" spellcheck="false">
        <div class="actions">
          <button class="icon" title="Confirm" data-action="confirm-edit" data-index="${entry.index}">✓</button>
          <button class="icon" title="Revert" data-action="revert-edit" data-index="${entry.index}">↶</button>
        </div>
      `;
    } else {
      row.innerHTML = `
        <span class="ico">${iconSvg('direct')}</span>
        <span class="k" title="${escapeAttr(entry.key)}">${escapeHtml(entry.key)}</span>
        <span class="v" title="${escapeAttr(entry.value)}">${escapeHtml(entry.value)}</span>
        <div class="actions">
          <button class="icon" title="Edit" data-action="edit-entry" data-index="${entry.index}">✎</button>
          <button class="icon danger" title="Delete" data-action="delete-entry" data-index="${entry.index}">✕</button>
        </div>
      `;
    }
    els.entryList.append(row);
  }

  if (editingDirectIndex !== null) {
    const input = els.entryList.querySelector(`input[data-field="key"][data-index="${editingDirectIndex}"]`);
    input?.focus();
    input?.select();
  }
}

function renderSourceGroups() {
  els.sourceGroups.innerHTML = '';
  const groups = state.sourceGroups || [];
  if (!groups.length) {
    const empty = document.createElement('div');
    empty.className = 'item-empty';
    empty.textContent = 'No directory sources yet — browse for a folder above.';
    els.sourceGroups.append(empty);
    return;
  }

  const filter = snippetFilter;

  for (const group of groups) {
    const visibleSnippets = filter
      ? (group.snippets || []).filter((snippet) => matchesFilter(snippet, filter))
      : (group.snippets || []);

    if (filter && !group.missing && !visibleSnippets.length) continue;

    const wrapper = document.createElement('div');
    const expanded = filter ? true : group.expanded;
    wrapper.className = `source-group${expanded ? '' : ' collapsed'}`;
    const totalCount = (group.snippets || []).length;
    const meta = group.missing
      ? 'missing — directory unreadable'
      : filter
        ? `${group.path} · ${visibleSnippets.length} of ${totalCount} match`
        : `${group.path} · ${totalCount} snippet${totalCount === 1 ? '' : 's'}`;
    const iconId = 'folder';
    wrapper.innerHTML = `
      <header class="source-header">
        <button class="chev" data-action="toggle-source" data-id="${escapeAttr(group.id)}" title="Toggle">▾</button>
        <span class="source-glyph">${iconSvg(iconId)}</span>
        <div class="source-info">
          <input class="prefix-input" data-action="source-prefix" data-id="${escapeAttr(group.id)}" value="${escapeAttr(group.lastPrefix || '')}" placeholder="prefix:" title="Edit prefix">
          <span class="source-meta-text" title="${escapeAttr(group.path)}">${escapeHtml(meta)}</span>
        </div>
        <div class="source-actions">
          <button class="icon" data-action="reveal-source" data-id="${escapeAttr(group.id)}" aria-label="Reveal in Finder" title="Reveal in Finder">↗</button>
          <button class="icon" data-action="refresh-source" data-id="${escapeAttr(group.id)}" aria-label="Refresh" title="Rescan this directory">⟳</button>
          <button class="icon danger" data-action="remove-source" data-id="${escapeAttr(group.id)}" aria-label="Remove" title="Remove source">✕</button>
        </div>
      </header>
      <div class="source-children"></div>
    `;

    const children = wrapper.querySelector('.source-children');
    if (group.missing) {
      const missing = document.createElement('div');
      missing.className = 'item-empty';
      missing.textContent = 'Directory is missing or unreadable.';
      children.append(missing);
    } else if (!visibleSnippets.length) {
      const empty = document.createElement('div');
      empty.className = 'item-empty';
      empty.textContent = filter ? 'No snippets match the filter.' : 'No files matched in this directory.';
      children.append(empty);
    } else {
      for (const snippet of visibleSnippets) {
        const row = document.createElement('div');
        row.className = 'item dir';
        row.innerHTML = `
          <span class="ico">${iconSvg(iconId)}</span>
          <span class="k" title="${escapeAttr(snippet.key)}">${escapeHtml(snippet.key)}</span>
          <span class="v" title="${escapeAttr(snippet.value)}">${escapeHtml(snippet.value)}</span>
          <span class="actions"></span>
        `;
        children.append(row);
      }
    }
    els.sourceGroups.append(wrapper);
  }
}

function updateSnippetCount() {
  const total = (state.effectiveEntries || []).length;
  if (els.snippetCount) els.snippetCount.textContent = total ? String(total) : '';

  const direct = (state.config.entries || []).filter((e) => e.kind !== 'directory').length;
  if (els.metaDirect) els.metaDirect.textContent = `${direct} ${direct === 1 ? 'entry' : 'entries'}`;

  const groups = state.sourceGroups || [];
  const dirSnippetCount = groups.reduce((sum, g) => sum + (g.snippets?.length || 0), 0);
  if (els.metaDir) {
    if (!groups.length) {
      els.metaDir.textContent = 'no directories yet';
    } else {
      els.metaDir.textContent = `${groups.length} director${groups.length === 1 ? 'y' : 'ies'} · ${dirSnippetCount} snippet${dirSnippetCount === 1 ? '' : 's'}`;
    }
  }
}

async function refreshState() {
  state = await api.getState();
  renderResults();
  renderSettings();
}

async function confirmEditedEntries() {
  const entries = [...(state.config.entries || [])];
  for (const input of els.entryList.querySelectorAll('input[data-field]')) {
    const index = Number(input.dataset.index);
    const field = input.dataset.field;
    if (!entries[index]) continue;
    entries[index][field] = input.value;
  }
  const nextEntries = entries.filter((entry) => entry.key);
  editingDirectIndex = null;
  state.config.entries = nextEntries;
  await api.saveEntries(nextEntries);
  state = await api.getState();
  renderResults();
  renderSettings();
}

function findSource(sourceId) {
  return (state.config.recentSources || []).find((source) => source.id === sourceId);
}

async function saveSourcePatch(sourceId, patch) {
  const source = findSource(sourceId);
  if (!source) return;
  await api.saveSource({ ...source, ...patch });
  await refreshState();
}

async function commitNewEntry() {
  const key = els.newKey.value.trim();
  const value = els.newValue.value;
  if (!key) {
    els.newKey.focus();
    return;
  }
  const next = [...(state.config.entries || []), { key, value, kind: 'regular' }];
  await api.saveEntries(next);
  els.newKey.value = '';
  els.newValue.value = '';
  await refreshState();
  els.newKey.focus();
}

els.search.addEventListener('input', () => {
  query = els.search.value;
  selectedIndex = 0;
  ignoreHoverSelection = false;
  renderResults();
});

els.results.addEventListener('mousemove', (event) => {
  const next = { x: event.clientX, y: event.clientY };
  if (
    !lastMousePosition ||
    lastMousePosition.x !== next.x ||
    lastMousePosition.y !== next.y
  ) {
    ignoreHoverSelection = false;
  }
  lastMousePosition = next;
});

window.addEventListener('keydown', async (event) => {
  if (event.metaKey && event.key === ',') {
    event.preventDefault();
    setRoute('settings');
    return;
  }

  if (route !== 'search') {
    if (event.key === 'Escape') {
      if (els.confirmDialog && !els.confirmDialog.classList.contains('hidden')) {
        closeConfirm(false);
        return;
      }
      const active = document.activeElement;
      if (active && active.tagName === 'INPUT' && active.closest('.item.editing')) {
        active.blur();
        return;
      }
      setRoute('search');
    } else if (event.key === '/' && document.activeElement !== els.snippetFilter && document.activeElement.tagName !== 'INPUT') {
      event.preventDefault();
      els.snippetFilter?.focus();
    }
    return;
  }

  if (event.metaKey && event.key.toLowerCase() === 'a') {
    event.preventDefault();
    els.search.focus();
    els.search.select();
    return;
  }

  const results = currentResults();
  if (event.key === 'Escape') {
    event.preventDefault();
    await api.hide();
  } else if (event.key === 'ArrowDown') {
    event.preventDefault();
    ignoreHoverSelection = true;
    selectedIndex = Math.min(selectedIndex + 1, Math.max(0, results.length - 1));
    renderResults();
  } else if (event.key === 'ArrowUp') {
    event.preventDefault();
    ignoreHoverSelection = true;
    selectedIndex = Math.max(selectedIndex - 1, 0);
    renderResults();
  } else if (event.key === 'Enter' && event.metaKey) {
    event.preventDefault();
    if (results[selectedIndex]) await api.revealEntry(results[selectedIndex]);
  } else if (event.key === 'Enter') {
    event.preventDefault();
    if (results[selectedIndex]) await api.pasteEntry(results[selectedIndex]);
  } else if (event.key.toLowerCase() === 'c' && event.metaKey) {
    event.preventDefault();
    if (results[selectedIndex]) await api.copyEntry(results[selectedIndex]);
  }
});

els.prefsBtn.addEventListener('click', () => setRoute('settings'));

els.addEntry.addEventListener('click', commitNewEntry);
els.newKey.addEventListener('keydown', (event) => {
  if (event.key === 'Enter') {
    event.preventDefault();
    els.newValue.focus();
  }
});
els.newValue.addEventListener('keydown', (event) => {
  if (event.key === 'Enter') {
    event.preventDefault();
    void commitNewEntry();
  }
});

if (els.snippetFilter) {
  els.snippetFilter.addEventListener('input', () => {
    snippetFilter = els.snippetFilter.value;
    renderRegularSnippets();
    renderSourceGroups();
  });
}

async function importDirectory(dir, prefix = '') {
  if (!dir) return;
  const existing = findSourceByPath(dir);
  if (existing) {
    await showAlert({
      title: 'Directory already imported',
      body: `${dir}\n\nIt's already a snippet source${existing.lastPrefix ? ` with prefix "${existing.lastPrefix}"` : ''}. Use the ⟳ icon on the existing source to rescan.`,
      okLabel: 'Got it',
    });
    return;
  }
  await api.applySync({ path: dir, lastPrefix: prefix, expanded: true }, []);
  await refreshState();
}

els.chooseDirBtn.addEventListener('click', async () => {
  try {
    const picked = await api.chooseSyncDirectory();
    if (!picked) return;
    await importDirectory(picked, '');
  } catch (error) {
    console.error('Failed to import directory', error);
    await showAlert({
      title: 'Directory import failed',
      body: error?.message || String(error || 'The selected directory could not be imported.'),
      okLabel: 'OK',
    });
  }
});

function normalizePath(value) {
  let raw = String(value || '').trim().replace(/\/+$/, '');
  if (api.homeDir && (raw === '~' || raw.startsWith('~/'))) {
    raw = api.homeDir + raw.slice(1);
  }
  return raw;
}

function findSourceByPath(dir) {
  const target = normalizePath(dir);
  return (state.config.recentSources || []).find((source) => normalizePath(source.path) === target);
}

els.addDirectory.addEventListener('click', async () => {
  const dir = els.sourcePathInput.value.trim();
  if (!dir) {
    els.chooseDirBtn.focus();
    return;
  }
  const existing = findSourceByPath(dir);
  if (existing) {
    await showAlert({
      title: 'Directory already imported',
      body: `${dir}\n\nIt's already listed as a snippet source${existing.lastPrefix ? ` with prefix "${existing.lastPrefix}"` : ''}. Use the refresh icon on the existing source to rescan.`,
      okLabel: 'Got it',
    });
    return;
  }
  const prefix = els.sourcePrefixInput.value.trim();
  await api.applySync({ path: dir, lastPrefix: prefix, expanded: true }, []);
  els.sourcePathInput.value = '~/.claude/skills';
  els.sourcePrefixInput.value = 'claude:';
  await refreshState();
});

els.confirmOk.addEventListener('click', () => closeConfirm(true));
els.confirmCancel.addEventListener('click', () => closeConfirm(false));
els.confirmDialog.addEventListener('click', (event) => {
  if (event.target === els.confirmDialog) closeConfirm(false);
});

els.undo.addEventListener('click', async () => {
  await api.undo();
  await refreshState();
});

els.entryList.addEventListener('keydown', (event) => {
  if (!event.target.matches('input[data-field]')) return;
  if (event.key === 'Enter') {
    event.preventDefault();
    void confirmEditedEntries();
  } else if (event.key === 'Escape') {
    event.preventDefault();
    editingDirectIndex = null;
    renderRegularSnippets();
  }
});

els.entryList.addEventListener('click', async (event) => {
  if (event.target.matches('input[data-field]')) return;
  const actionBtn = event.target.closest('button[data-action]');
  if (actionBtn) {
    const action = actionBtn.dataset.action;
    const index = Number(actionBtn.dataset.index);
    if (action === 'edit-entry') {
      editingDirectIndex = index;
      renderRegularSnippets();
    } else if (action === 'confirm-edit') {
      await confirmEditedEntries();
    } else if (action === 'revert-edit') {
      editingDirectIndex = null;
      renderRegularSnippets();
    } else if (action === 'delete-entry') {
      editingDirectIndex = null;
      await api.saveEntries((state.config.entries || []).filter((_entry, itemIndex) => itemIndex !== index));
      await refreshState();
    }
    return;
  }
  const row = event.target.closest('.item');
  if (!row || !row.dataset.index) return;
  if (event.target.closest('.actions')) return;
  editingDirectIndex = Number(row.dataset.index);
  renderRegularSnippets();
});

els.sourceGroups.addEventListener('click', async (event) => {
  const button = event.target.closest('button');
  if (!button) return;
  const action = button.dataset.action;
  const id = button.dataset.id;
  if (action === 'toggle-source') {
    const source = findSource(id);
    await saveSourcePatch(id, { expanded: !source?.expanded });
  } else if (action === 'reveal-source') {
    const source = findSource(id);
    if (source?.path) await api.revealSource(source.path);
  } else if (action === 'refresh-source') {
    const source = findSource(id);
    if (!source) return;
    await api.applySync({ ...source }, []);
    await refreshState();
  } else if (action === 'remove-source') {
    const source = findSource(id);
    const label = source?.lastPrefix || source?.path || 'this directory source';
    const ok = await showConfirm({
      title: 'Remove directory source?',
      body: `Remove ${label} and all snippets generated from it. The files on disk will not be touched.`,
      okLabel: 'Remove',
      destructive: true,
    });
    if (!ok) return;
    await api.removeSource(id);
    await refreshState();
  }
});

els.sourceGroups.addEventListener('change', async (event) => {
  const input = event.target;
  if (!input.matches('input[data-action="source-prefix"]')) return;
  await saveSourcePatch(input.dataset.id, { lastPrefix: input.value });
});

els.themeSelect.addEventListener('change', async () => {
  await api.setTheme(els.themeSelect.value);
  await refreshState();
});

els.saveHotkey.addEventListener('click', async () => {
  const result = await api.setHotkey(els.hotkeyInput.value.trim());
  els.hotkeyStatus.textContent = result.ok ? `Registered ${result.accelerator}` : `Failed to register ${result.accelerator}`;
  await refreshState();
});

els.revealConfig.addEventListener('click', () => api.revealConfig());
els.reloadConfig.addEventListener('click', async () => {
  await api.reloadConfig();
  await refreshState();
});

for (const navItem of document.querySelectorAll('.settings-nav button')) {
  navItem.addEventListener('click', () => {
    for (const button of document.querySelectorAll('.settings-nav button')) button.classList.toggle('active', button === navItem);
    for (const page of document.querySelectorAll('.settings-page')) page.classList.toggle('hidden', page.id !== navItem.dataset.page);
  });
}

api.onShown((payload) => {
  query = '';
  selectedIndex = 0;
  els.search.value = '';
  setRoute(payload.route === 'settings' || payload.route === 'prefs' ? 'settings' : 'search');
  renderResults();
});
api.onState((payload) => {
  state = payload;
  renderResults();
  if (editingDirectIndex !== null) {
    updateSnippetCount();
    return;
  }
  renderSettings();
});

refreshState();
