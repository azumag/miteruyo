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
      source.indexOf('// Render global allowed-only categories tag list')
    );
    const sandbox = {
      console: {
        log: vi.fn(),
        error: vi.fn(),
      }
    };

    vm.createContext(sandbox);
    vm.runInContext(
      `${helperSource}\n${migrationSource}\nglobalThis.__testExports = { normalizeStoredChannels, normalizeCategoryList, migrateBlockedCategories, migrateAllowedOnlyCategories, parseCategoryOptionValue, isSameCategory, includesCategory };`,
      sandbox,
      { filename: 'popup.js' }
    );

    return sandbox;
  }

  async function loadPopupAuthExports() {
    const source = await readFile(new URL('../popup.js', import.meta.url), 'utf8');
    const authSource = source.slice(
      source.indexOf('function handleTwitchAuthResponse'),
      source.indexOf('function checkTwitchConnection')
    );
    const sandbox = {
      chrome: {
        storage: {
          local: {
            set: vi.fn(),
          },
        },
      },
      checkTwitchConnection: vi.fn(),
      console: {
        log: vi.fn(),
        error: vi.fn(),
      },
      URL,
      URLSearchParams,
    };

    vm.createContext(sandbox);
    vm.runInContext(
      `${authSource}\nglobalThis.__testExports = { handleTwitchAuthResponse, parseHashToObj };`,
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
    expect(__testExports.normalizeCategoryList([{ id: '1' }, { id: '2', name: '' }, { id: '3', name: '   ' }, '', '  ', null, 1])).toEqual([]);
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

  it('normalizes malformed blocked category objects during migration', async () => {
    const sandbox = await loadPopupTestExports();
    const { __testExports } = sandbox;
    const blockedCategoryList = [
      { id: '1' },
      { id: '2', name: { broken: true } },
      { id: '3', name: '' },
      { id: '4', name: '   ' },
      { id: '5', name: 'Just Chatting' },
    ];
    const set = vi.fn();

    sandbox.chrome = {
      storage: {
        local: {
          get: vi.fn().mockResolvedValue({ blockedCategoryList }),
          set,
        },
      },
    };

    await expect(__testExports.migrateBlockedCategories()).resolves.toEqual([
      { id: '5', name: 'Just Chatting' },
    ]);
    expect(set).toHaveBeenCalledWith({
      blockedCategoryList: [{ id: '5', name: 'Just Chatting' }],
    });
  });

  it('normalizes malformed allowed-only category objects during migration', async () => {
    const sandbox = await loadPopupTestExports();
    const { __testExports } = sandbox;
    const allowedOnlyCategoryList = [
      { id: '1' },
      { id: '2', name: { broken: true } },
      { id: '3', name: '' },
      { id: '4', name: '   ' },
      { id: '5', name: 'Just Chatting' },
    ];
    const set = vi.fn();

    sandbox.chrome = {
      storage: {
        local: {
          get: vi.fn().mockResolvedValue({ allowedOnlyCategoryList }),
          set,
        },
      },
    };

    await expect(__testExports.migrateAllowedOnlyCategories()).resolves.toEqual([
      { id: '5', name: 'Just Chatting' },
    ]);
    expect(set).toHaveBeenCalledWith({
      allowedOnlyCategoryList: [{ id: '5', name: 'Just Chatting' }],
    });
  });

  it('matches categories by id when both categories have ids', async () => {
    const { __testExports } = await loadPopupTestExports();

    expect(__testExports.isSameCategory(
      { id: '509658', name: 'Just Chatting' },
      { id: '509658', name: 'Different Name' }
    )).toBe(true);
    expect(__testExports.isSameCategory(
      { id: '509658', name: 'Just Chatting' },
      { id: '123', name: 'Just Chatting' }
    )).toBe(false);
  });

  it('matches legacy categories by name when either id is missing', async () => {
    const { __testExports } = await loadPopupTestExports();
    const legacyCategory = { id: null, name: ' Just Chatting ' };
    const twitchCategory = { id: '509658', name: 'just chatting' };

    expect(__testExports.isSameCategory(legacyCategory, twitchCategory)).toBe(true);
    expect(__testExports.includesCategory([legacyCategory], twitchCategory)).toBe(true);
  });

  it('does not match unmatched legacy names or empty names', async () => {
    const { __testExports } = await loadPopupTestExports();

    expect(__testExports.isSameCategory(
      { id: null, name: 'Just Chatting' },
      { id: '509658', name: 'Music' }
    )).toBe(false);
    expect(__testExports.isSameCategory(
      { id: null, name: ' ' },
      { id: null, name: '' }
    )).toBe(false);
  });

  it('handles Twitch auth tokens without logging the redirect URL', async () => {
    const sandbox = await loadPopupAuthExports();
    const { __testExports, chrome, checkTwitchConnection, console } = sandbox;
    const responseUrl = 'https://example.chromiumapp.org/#access_token=secret-token&state=state-1';

    __testExports.handleTwitchAuthResponse(responseUrl, 'state-1');

    expect(chrome.storage.local.set).toHaveBeenCalledWith({ oauth_token: 'secret-token' });
    expect(checkTwitchConnection).toHaveBeenCalledWith('secret-token');
    expect(console.log).not.toHaveBeenCalled();
  });
});
