import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

test('adds regular snippet, imports directory snippets, and searches', async ({ page }) => {
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
      name: path.parse(fileName).name,
      value: fs.realpathSync(path.join(fixtureDir, fileName)),
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

  await expect(page.locator('#settingsView')).toBeVisible();
  await expect(page.locator('.search-bar')).toBeHidden();

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
  await directKeyInput.press(process.platform === 'darwin' ? 'Meta+A' : 'Control+A');
  await directKeyInput.type('manual-snippet-updated');
  await expect(directKeyInput).toHaveValue('manual-snippet-updated');
  await directValueInput.click();
  await expect(directValueInput).toBeFocused();
  await directValueInput.press(process.platform === 'darwin' ? 'Meta+A' : 'Control+A');
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
  await page.locator('#entryList input[data-field="key"]').press(process.platform === 'darwin' ? 'Meta+A' : 'Control+A');
  await page.locator('#entryList input[data-field="key"]').type('manual-snippet-reverted');
  await page.locator('#entryList input[data-field="value"]').click();
  await page.locator('#entryList input[data-field="value"]').press(process.platform === 'darwin' ? 'Meta+A' : 'Control+A');
  await page.locator('#entryList input[data-field="value"]').type('/tmp/manual-value-reverted');
  await page.locator('#entryList .item.direct.editing button[data-action="revert-edit"]').click();
  await expect(page.locator('#entryList')).toContainText('manual-snippet-updated');
  await expect(page.locator('#entryList')).toContainText('/tmp/manual-value-updated');
  await expect(page.locator('#entryList')).not.toContainText('manual-snippet-reverted');
  await expect.poll(() => page.evaluate(() => window.skillSpotlight.getState().then((state) => {
    const entry = state.config.entries.find((item) => item.kind === 'regular');
    return entry ? { key: entry.key, value: entry.value } : null;
  }))).toEqual({ key: 'manual-snippet-updated', value: '/tmp/manual-value-updated' });

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
  await expect(page.locator('#sourceGroups')).toContainText('note');
  await expect(page.locator('#sourceGroups')).toContainText('skill-j');

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
    expect.objectContaining({ key: 'codexnote', value: fs.realpathSync(path.join(fixtureDir, 'note.md')), kind: 'directory' }),
  ]));

  await page.keyboard.press('Escape');
  await expect(page.locator('#searchView')).toBeVisible();
  await expect(page.locator('.search-bar')).toBeVisible();
  await page.locator('#search').fill('codexskill-a');
  await page.keyboard.press('Meta+A');
  await expect(page.locator('#search')).toHaveJSProperty('selectionStart', 0);
  await expect(page.locator('#search')).toHaveJSProperty('selectionEnd', 'codexskill-a'.length);
  await expect(page.locator('#results')).toContainText('codexskill-a');
  await expect(page.locator('#results')).toContainText('fixtures/skills/skill-a');
  await page.locator('#search').fill('codexskill');
  await expect(page.locator('.result-row')).toHaveCount(10);
  await expect(page.locator('#results')).toContainText('codexskill-j');
  await page.locator('.result-row').first().hover();
  await expect(page.locator('.result-row.selected .key')).toHaveText('codexskill-a');
  await page.keyboard.press('ArrowDown');
  await expect(page.locator('.result-row.selected .key')).toHaveText('codexskill-b');
  await page.keyboard.press('ArrowDown');
  await expect(page.locator('.result-row.selected .key')).toHaveText('codexskill-c');
});
