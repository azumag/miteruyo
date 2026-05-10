import { describe, it, expect, vi } from 'vitest';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

describe('Popup Script', () => {
  async function loadPopupTestExports() {
    const source = await readFile(new URL('../popup.js', import.meta.url), 'utf8');
    const helperSource = source.slice(
      source.indexOf('function normalizeStoredChannels'),
      source.indexOf('// Category search using Twitch API')
    );
    const migrationSource = source.slice(
      source.indexOf('async function migrateBlockedCategories'),
      source.indexOf('// Migrate allowed-only categories')
    );
    const sandbox = {
      console: {
        error: vi.fn(),
      }
    };

    vm.createContext(sandbox);
    vm.runInContext(
      `${helperSource}\n${migrationSource}\nglobalThis.__testExports = { normalizeStoredChannels, normalizeCategoryList, migrateBlockedCategories, parseCategoryOptionValue };`,
      sandbox,
      { filename: 'popup.js' }
    );

    return sandbox;
  }

  it('parses valid category option values', async () => {
    const { __testExports, console } = await loadPopupTestExports();

    expect(__testExports.parseCategoryOptionValue('{"id":"123","name":"Games"}')).toEqual({
      id: '123',
      name: 'Games',
    });
    expect(console.error).not.toHaveBeenCalled();
  });

  it('ignores invalid category option values without throwing', async () => {
    const { __testExports, console } = await loadPopupTestExports();

    expect(__testExports.parseCategoryOptionValue('{bad json')).toBeNull();
    expect(__testExports.parseCategoryOptionValue('null')).toBeNull();
    expect(__testExports.parseCategoryOptionValue('{"id":"123"}')).toBeNull();
    expect(console.error).toHaveBeenCalledTimes(1);
    expect(console.error.mock.calls[0][0]).toBe('Failed to parse category:');
    expect(console.error.mock.calls[0][1].name).toBe('SyntaxError');
  });

  it('normalizes non-array channels from storage', async () => {
    const { __testExports } = await loadPopupTestExports();
    const channels = [{ name: 'valid_channel' }];

    expect(__testExports.normalizeStoredChannels(channels)).toBe(channels);
    expect(__testExports.normalizeStoredChannels(null)).toEqual([]);
    expect(__testExports.normalizeStoredChannels('broken')).toEqual([]);
    expect(__testExports.normalizeStoredChannels({ 0: { name: 'broken' } })).toEqual([]);
  });

  it('normalizes popup category lists before channel row rendering uses them', async () => {
    const { __testExports } = await loadPopupTestExports();
    const categories = [{ id: '1', name: 'Just Chatting' }];

    expect(__testExports.normalizeCategoryList(categories)).toEqual(categories);
    expect(__testExports.normalizeCategoryList(['Just Chatting'])).toEqual([
      { id: null, name: 'Just Chatting' },
    ]);
    expect(__testExports.normalizeCategoryList(null)).toEqual([]);
    expect(__testExports.normalizeCategoryList('broken')).toEqual([]);
    expect(__testExports.normalizeCategoryList({ 0: { id: '1', name: 'Broken' } })).toEqual([]);
    expect(__testExports.normalizeCategoryList([{ id: '1' }, null, 1])).toEqual([]);
  });

  it('keeps migrated blocked category objects with null ids', async () => {
    const sandbox = await loadPopupTestExports();
    const { __testExports } = sandbox;
    const blockedCategoryList = [{ id: null, name: 'Just Chatting' }];
    const set = vi.fn();

    const chrome = {
      storage: {
        local: {
          get: vi.fn().mockResolvedValue({ blockedCategoryList }),
          set,
        },
      },
    };
    sandbox.chrome = chrome;

    await expect(__testExports.migrateBlockedCategories()).resolves.toBe(blockedCategoryList);
    expect(set).not.toHaveBeenCalled();
  });
});
