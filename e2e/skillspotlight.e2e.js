import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const selectAllShortcut = process.platform === 'darwin' ? 'Meta+A' : 'Control+A';

async function setupPage(page) {
  const projectRoot = path.resolve(__dirname, '..');
  const runtimeDir = path.join(projectRoot, 'e2e', '.runtime');
  fs.rmSync(runtimeDir, { recursive: true, force: true });
  fs.mkdirSync(runtimeDir, { recursive: true });

  const configPath = path.join(runtimeDir, 'config.json');
  const fixtureDir = path.join(projectRoot, 'e2e', 'fixtures', 'skills');
  const directoryEntries = fs.readdirSync(fixtureDir)
    .filter((name) => !name.startsWith('.'))
    .sort((a, b) => a.localeCompare(b))
    .map((fileName) => ({
      name: fs.statSync(path.join(fixtureDir, fileName)).isFile() ? fileName : path.parse(fileName).name,
      value: fs.realpathSync(path.join(fixtureDir, fileName)),
      sourceChildKind: fs.statSync(path.join(fixtureDir, fileName)).isFile() ? 'file' : 'folder',
    }));

  await page.addInitScript((fixture) => {
    window.__SKILLSPOTLIGHT_E2E__ = fixture;
  }, {
    configPath,
    fixtureDir,
    homeDir: process.env.HOME || '',
    directoryEntries,
  });

  await page.goto('/?e2e=1');
  await page.waitForLoadState('domcontentloaded');

  return { configPath, fixtureDir };
}

async function calls(page, name) {
  return page.evaluate((callName) => (window.__SKILLSPOTLIGHT_E2E_CALLS__ || []).filter((call) => !callName || call.name === callName), name);
}

test('adds regular snippet, imports directory snippets, and searches', async ({ page }) => {
  const { fixtureDir } = await setupPage(page);

  await expect(page.locator('#settingsView')).toBeVisible();
  await expect(page.locator('.search-bar')).toBeHidden();
  await expect(page.locator('[data-page="snippetsPage"]')).toHaveClass(/active/);

  await page.locator('#newKey').fill('manual-snippet');
  await page.locator('#newValue').fill('/tmp/manual-value');
  await expect(page.locator('#newValue')).toHaveValue('/tmp/manual-value');
  await page.locator('#addEntry').click();
  await expect.poll(() => page.evaluate(() => window.skillSpotlight.getState().then((state) => state.config.entries[0]?.value))).toBe('/tmp/manual-value');

  await page.locator('#entryList .item.direct').first().click();
  const editingDirectRow = page.locator('#entryList .item.direct.editing');
  await expect(editingDirectRow.locator('button[data-action="confirm-edit"]')).toBeVisible();
  await expect(editingDirectRow.locator('button[data-action="revert-edit"]')).toBeVisible();
  await expect(editingDirectRow.locator('button[data-action="delete-entry"]')).toHaveCount(0);
  const directKeyInput = page.locator('#entryList input[data-field="key"]');
  const directValueInput = page.locator('#entryList input[data-field="value"]');
  await directKeyInput.press(selectAllShortcut);
  await directKeyInput.type('manual-snippet-updated');
  await expect(directKeyInput).toHaveValue('manual-snippet-updated');
  await directValueInput.click();
  await expect(directValueInput).toBeFocused();
  await directValueInput.press(selectAllShortcut);
  await directValueInput.type('/tmp/manual-value-updated');
  await expect(directValueInput).toHaveValue('/tmp/manual-value-updated');
  await editingDirectRow.locator('button[data-action="confirm-edit"]').click();
  await expect(page.locator('#entryList')).toContainText('manual-snippet-updated');
  await expect(page.locator('#entryList')).toContainText('/tmp/manual-value-updated');
  await expect.poll(() => page.evaluate(() => window.skillSpotlight.getState().then((state) => {
    const entry = state.config.entries.find((item) => item.kind === 'regular');
    return entry ? { key: entry.key, value: entry.value } : null;
  }))).toEqual({ key: 'manual-snippet-updated', value: '/tmp/manual-value-updated' });

  await page.locator('#entryList .item.direct').first().click();
  await page.locator('#entryList input[data-field="key"]').press(selectAllShortcut);
  await page.locator('#entryList input[data-field="key"]').type('manual-snippet-reverted');
  await page.locator('#entryList input[data-field="value"]').click();
  await page.locator('#entryList input[data-field="value"]').press(selectAllShortcut);
  await page.locator('#entryList input[data-field="value"]').type('/tmp/manual-value-reverted');
  await page.locator('#entryList .item.direct.editing button[data-action="revert-edit"]').click();
  await expect(page.locator('#entryList')).toContainText('manual-snippet-updated');
  await expect(page.locator('#entryList')).toContainText('/tmp/manual-value-updated');
  await expect(page.locator('#entryList')).not.toContainText('manual-snippet-reverted');
  await expect.poll(() => page.evaluate(() => window.skillSpotlight.getState().then((state) => {
    const entry = state.config.entries.find((item) => item.kind === 'regular');
    return entry ? { key: entry.key, value: entry.value } : null;
  }))).toEqual({ key: 'manual-snippet-updated', value: '/tmp/manual-value-updated' });

  await page.locator('#newKey').fill('delete-me');
  await page.locator('#newValue').fill('/tmp/delete-me');
  await page.locator('#addEntry').click();
  await expect(page.locator('#entryList')).toContainText('delete-me');
  await page.locator('#entryList .item.direct', { hasText: 'delete-me' }).locator('button[data-action="delete-entry"]').click();
  await expect(page.locator('#entryList')).not.toContainText('delete-me');
  await page.locator('#undo').click();
  await expect(page.locator('#entryList')).toContainText('delete-me');

  await page.locator('#chooseDirBtn').click();

  await expect.poll(() => page.evaluate(() => window.__SKILLSPOTLIGHT_E2E_APPLY_SYNC_CALLS__?.[0])).toEqual(expect.objectContaining({
    path: fixtureDir,
    lastPrefix: '',
    expanded: true,
  }));
  const firstApplySyncSource = await page.evaluate(() => window.__SKILLSPOTLIGHT_E2E_APPLY_SYNC_CALLS__[0]);
  expect(firstApplySyncSource).not.toHaveProperty('id');
  await expect(page.locator('#confirmTitle')).not.toHaveText('Directory import failed');

  await expect(page.locator('#sourceGroups')).toContainText(fixtureDir);
  await expect(page.locator('#sourceGroups')).toContainText('skill-a');
  await expect(page.locator('#sourceGroups')).toContainText('skill-b');
  await expect(page.locator('#sourceGroups')).toContainText('note.md');
  await expect(page.locator('#sourceGroups')).toContainText('skill-j');

  await page.locator('#chooseDirBtn').click();
  await expect(page.locator('#confirmTitle')).toHaveText('Directory already imported');
  await page.locator('#confirmOk').click();

  const sourceGroup = page.locator('#sourceGroups .source-group').filter({ hasText: fixtureDir });
  await sourceGroup.locator('button[data-action="toggle-source"]').click();
  await expect(sourceGroup).toHaveClass(/collapsed/);
  await sourceGroup.locator('button[data-action="toggle-source"]').click();
  await expect(sourceGroup).not.toHaveClass(/collapsed/);

  await sourceGroup.locator('button[data-action="reveal-source"]').click();
  expect(await calls(page, 'revealSource')).toEqual(expect.arrayContaining([
    expect.objectContaining({ path: fixtureDir }),
  ]));

  await sourceGroup.locator('button[data-action="refresh-source"]').click();
  await expect.poll(() => page.evaluate(() => window.__SKILLSPOTLIGHT_E2E_APPLY_SYNC_CALLS__?.length)).toBeGreaterThanOrEqual(2);

  await page.locator('.prefix-input').fill('codex');
  await page.locator('.prefix-input').blur();
  await expect(page.locator('#sourceGroups')).toContainText('codexskill-a');
  await expect(page.locator('#sourceGroups')).toContainText('codexskill-j');

  const stored = await page.evaluate(() => window.skillSpotlight.getState().then((state) => state.config));
  expect(stored.entries).toEqual(expect.arrayContaining([
    expect.objectContaining({ key: 'manual-snippet-updated', value: '/tmp/manual-value-updated', kind: 'regular' }),
    expect.objectContaining({ key: 'codexskill-a', value: fs.realpathSync(path.join(fixtureDir, 'skill-a')), kind: 'directory' }),
    expect.objectContaining({ key: 'codexskill-b', value: fs.realpathSync(path.join(fixtureDir, 'skill-b')), kind: 'directory' }),
    expect.objectContaining({ key: 'codexskill-j', value: fs.realpathSync(path.join(fixtureDir, 'skill-j')), kind: 'directory' }),
    expect.objectContaining({ key: 'codexnote.md', value: fs.realpathSync(path.join(fixtureDir, 'note.md')), kind: 'directory', sourceChildKind: 'file' }),
  ]));

  await expect(page.locator('#sourceGroups .item.dir', { hasText: 'codexnote.md' }).locator('use')).toHaveAttribute('href', '#i-file');
  await expect(page.locator('#sourceGroups .item.dir', { hasText: 'codexskill-a' }).locator('use')).toHaveAttribute('href', '#i-folder');

  await page.locator('#sourcePathInput').fill(`${fixtureDir}-secondary`);
  await page.locator('#sourcePrefixInput').fill('tmp:');
  await page.locator('#addDirectory').dispatchEvent('click');
  await expect(page.locator('#sourceGroups')).toContainText('tmp:skill-a');
  await page.locator('#sourceGroups .source-group').filter({ hasText: `${fixtureDir}-secondary` }).locator('button[data-action="remove-source"]').click();
  await expect(page.locator('#confirmTitle')).toHaveText('Remove directory source?');
  await page.locator('#confirmCancel').click();
  await expect(page.locator('#sourceGroups')).toContainText('tmp:skill-a');
  await page.locator('#sourceGroups .source-group').filter({ hasText: `${fixtureDir}-secondary` }).locator('button[data-action="remove-source"]').click();
  await page.locator('#confirmOk').click();
  await expect(page.locator('#sourceGroups')).not.toContainText('tmp:skill-a');

  await page.evaluate(() => window.skillSpotlight.syncAll());
  expect(await calls(page, 'syncAll')).toHaveLength(1);

  await page.keyboard.press('Escape');
  await expect(page.locator('#searchView')).toBeVisible();
  await expect(page.locator('.search-bar')).toBeVisible();
  await page.locator('#search').fill('codexskill-a');
  await page.keyboard.press('Meta+A');
  await expect(page.locator('#search')).toHaveJSProperty('selectionStart', 0);
  await expect(page.locator('#search')).toHaveJSProperty('selectionEnd', 'codexskill-a'.length);
  await expect(page.locator('#results')).toContainText('codexskill-a');
  await expect(page.locator('#results')).toContainText('fixtures/skills/skill-a');
  await page.keyboard.press('Meta+Enter');
  expect(await calls(page, 'revealEntry')).toEqual(expect.arrayContaining([
    expect.objectContaining({ entry: expect.objectContaining({ key: 'codexskill-a' }) }),
  ]));
  await page.keyboard.press('Meta+C');
  expect(await calls(page, 'copyEntry')).toEqual(expect.arrayContaining([
    expect.objectContaining({ entry: expect.objectContaining({ key: 'codexskill-a' }) }),
  ]));
  await page.keyboard.press('Enter');
  expect(await calls(page, 'pasteEntry')).toEqual(expect.arrayContaining([
    expect.objectContaining({ entry: expect.objectContaining({ key: 'codexskill-a' }) }),
  ]));
  await page.locator('#search').fill('does-not-exist');
  await expect(page.locator('#results')).toContainText('No matches');
  await page.locator('#search').fill('codexskill');
  await expect(page.locator('.result-row')).toHaveCount(10);
  await expect(page.locator('#results')).toContainText('codexskill-j');
  await page.locator('.result-row').first().hover();
  await expect(page.locator('.result-row.selected .key')).toHaveText('codexskill-a');
  await page.keyboard.press('ArrowDown');
  await expect(page.locator('.result-row.selected .key')).toHaveText('codexskill-b');
  await page.keyboard.press('ArrowDown');
  await expect(page.locator('.result-row.selected .key')).toHaveText('codexskill-c');
  await page.keyboard.press('Escape');
  expect(await calls(page, 'hide')).toHaveLength(1);
});

test('updates appearance, shortcut, storage, and settings navigation', async ({ page }) => {
  const { configPath } = await setupPage(page);

  await page.locator('[data-page="appearancePage"]').click();
  await expect(page.locator('#appearancePage')).toBeVisible();
  await page.locator('#themeSelect').selectOption('dark');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  expect(await calls(page, 'setTheme')).toEqual(expect.arrayContaining([
    expect.objectContaining({ theme: 'dark' }),
  ]));

  await page.locator('[data-page="shortcutPage"]').click();
  await expect(page.locator('#shortcutPage')).toBeVisible();
  await page.locator('#saveHotkey').click();
  await expect(page.locator('#hotkeyStatus')).toHaveText('Press a shortcut now.');
  await expect.poll(() => page.evaluate(() => window.__SKILLSPOTLIGHT_E2E_CAPTURE_ACTIVE__)).toBe(true);
  await page.evaluate(() => window.__SKILLSPOTLIGHT_E2E_TRIGGER_GLOBAL_SHORTCUT__());
  expect(await calls(page, 'toggleWindow')).toHaveLength(0);
  await page.keyboard.down('Alt');
  await expect(page.locator('#hotkeyStatus')).toHaveText('Press a shortcut now.');
  await page.keyboard.press('Space');
  await page.keyboard.up('Alt');
  await expect(page.locator('#hotkeyStatus')).toHaveText('Registered Alt+Space');
  await expect(page.locator('#hotkey')).toHaveText('Alt+Space');
  await expect.poll(() => page.evaluate(() => window.__SKILLSPOTLIGHT_E2E_CAPTURE_ACTIVE__)).toBe(false);
  expect(await calls(page, 'setHotkey')).toEqual(expect.arrayContaining([
    expect.objectContaining({ accelerator: 'Alt+Space' }),
  ]));

  await page.locator('#saveHotkey').click();
  await page.keyboard.press('Alt+Shift+Space');
  await expect(page.locator('#hotkeyStatus')).toHaveText('Registered Alt+Shift+Space');
  await expect(page.locator('#hotkey')).toHaveText('Alt+Shift+Space');
  expect(await calls(page, 'setHotkey')).toEqual(expect.arrayContaining([
    expect.objectContaining({ accelerator: 'Alt+Shift+Space' }),
  ]));
  await page.evaluate(() => window.__SKILLSPOTLIGHT_E2E_TRIGGER_GLOBAL_SHORTCUT__('Alt+Space'));
  expect(await calls(page, 'toggleWindow')).toHaveLength(0);
  await page.evaluate(() => window.__SKILLSPOTLIGHT_E2E_TRIGGER_GLOBAL_SHORTCUT__('Alt+Shift+Space'));
  expect(await calls(page, 'toggleWindow')).toHaveLength(1);

  await page.evaluate(() => {
    window.__SKILLSPOTLIGHT_E2E_FAIL_HOTKEYS__ = ['Control+Alt+F12'];
  });
  await page.locator('#saveHotkey').click();
  await expect(page.locator('#hotkeyStatus')).toHaveText('Press a shortcut now.');
  await page.keyboard.press('Control+Alt+F12');
  await expect(page.locator('#hotkeyStatus')).toHaveText('Failed to register Control+Alt+F12. Keeping Alt+Shift+Space.');
  await expect(page.locator('#hotkey')).toHaveText('Alt+Shift+Space');
  await page.evaluate(() => window.__SKILLSPOTLIGHT_E2E_TRIGGER_GLOBAL_SHORTCUT__('Control+Alt+F12'));
  expect(await calls(page, 'toggleWindow')).toHaveLength(1);
  await page.evaluate(() => window.__SKILLSPOTLIGHT_E2E_TRIGGER_GLOBAL_SHORTCUT__('Alt+Shift+Space'));
  expect(await calls(page, 'toggleWindow')).toHaveLength(2);

  await page.locator('[data-page="storagePage"]').click();
  await expect(page.locator('#storagePage')).toBeVisible();
  await expect(page.locator('#configPath')).toHaveText(configPath);
  await page.locator('#revealConfig').click();
  await page.locator('#reloadConfig').click();
  expect(await calls(page, 'revealConfig')).toHaveLength(1);
  expect(await calls(page, 'reloadConfig')).toHaveLength(1);

  await page.locator('[data-page="snippetsPage"]').click();
  await expect(page.locator('#snippetsPage')).toBeVisible();
  await page.locator('#snippetFilter').fill('nothing');
  await expect(page.locator('#entryList')).toContainText('No snippets match the filter.');
});

test('starts native window drag from chrome without making controls draggable', async ({ page }) => {
  await setupPage(page);

  const dragMouseDown = { button: 0, buttons: 1, bubbles: true };

  await page.locator('.settings-titlebar').dispatchEvent('mousedown', dragMouseDown);
  await expect.poll(() => calls(page, 'startWindowDrag')).toHaveLength(1);

  await page.locator('#newKey').dispatchEvent('mousedown', dragMouseDown);
  await expect.poll(() => calls(page, 'startWindowDrag')).toHaveLength(1);

  await page.keyboard.press('Escape');
  await expect(page.locator('#searchView')).toBeVisible();

  await page.locator('.glyph').dispatchEvent('mousedown', dragMouseDown);
  await expect.poll(() => calls(page, 'startWindowDrag')).toHaveLength(2);

  await page.locator('#search').dispatchEvent('mousedown', dragMouseDown);
  await page.locator('#prefsBtn').dispatchEvent('mousedown', dragMouseDown);
  await expect.poll(() => calls(page, 'startWindowDrag')).toHaveLength(2);

  await page.locator('.foot-item').first().dispatchEvent('mousedown', dragMouseDown);
  await expect.poll(() => calls(page, 'startWindowDrag')).toHaveLength(3);
});
