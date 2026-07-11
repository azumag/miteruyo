import { describe, it, expect, vi } from 'vitest';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

describe('Popup Script', () => {
  async function loadPopupHtml() {
    return readFile(new URL('../popup.html', import.meta.url), 'utf8');
  }

  async function loadPopupTestExports() {
    const source = await readFile(new URL('../popup.js', import.meta.url), 'utf8');
    const helperSource = source.slice(
      source.indexOf('const CHANNEL_NAME_REGEX'),
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
      `${helperSource}\n${migrationSource}\nglobalThis.__testExports = { normalizeStoredChannels, normalizeChannelName, getValidTwitchChannelName, canRenderChannelSettings, getNextAutoOpenState, isSameChannel, normalizeCategoryList, migrateBlockedCategories, migrateAllowedOnlyCategories, parseCategoryOptionValue, isSameCategory, includesCategory, getCategoriesNotAlreadyIncluded, addCategoryIfMissing, removeMatchingCategories };`,
      sandbox,
      { filename: 'popup.js' }
    );

    return sandbox;
  }

  async function loadPopupAuthExports() {
    const source = await readFile(new URL('../popup.js', import.meta.url), 'utf8');
    const authSource = source.slice(
      source.indexOf('function startTwitchAuthFlow'),
      source.indexOf('function checkTwitchConnection')
    );
    const sandbox = {
      chrome: {
        storage: {
          local: {
            set: vi.fn(),
          },
        },
        identity: {
          getRedirectURL: () => 'https://example.chromiumapp.org/',
          launchWebAuthFlow: vi.fn(),
        },
        runtime: {
          lastError: null,
        },
      },
      clientId: 'test-client-id',
      crypto: { randomUUID: () => 'state-1' },
      checkTwitchConnection: vi.fn(),
      rewriteNeedsLoginButton: vi.fn(),
      console: {
        log: vi.fn(),
        error: vi.fn(),
      },
      URL,
      URLSearchParams,
    };

    vm.createContext(sandbox);
    vm.runInContext(
      `${authSource}\nglobalThis.__testExports = { startTwitchAuthFlow, handleTwitchAuthResponse, parseHashToObj };`,
      sandbox,
      { filename: 'popup.js' }
    );

    return sandbox;
  }

  async function loadPopupStreamExports() {
    const source = await readFile(new URL('../popup.js', import.meta.url), 'utf8');
    const clientIdSource = source.slice(
      source.indexOf('const clientId'),
      source.indexOf('// Migrate old nested token format')
    );
    const migrateSource = source.slice(
      source.indexOf('function migrateOAuthToken'),
      source.indexOf('function normalizeStoredChannels')
    );
    const helperSource = source.slice(
      source.indexOf('function normalizeStoredChannels'),
      source.indexOf('// Category search using Twitch API')
    );
    const streamSource = source.slice(
      source.indexOf('async function checkStream'),
      source.indexOf('// Miteruyoの管理対象ウィンドウでタブを開く')
    );
    const sandbox = {
      chrome: {
        storage: {
          local: {
            get: vi.fn(() => Promise.resolve({ oauth_token: 'token-1' })),
          },
        },
      },
      fetch: vi.fn(),
      AbortController,
      setTimeout,
      clearTimeout,
      console: {
        log: vi.fn(),
        error: vi.fn(),
      },
    };

    vm.createContext(sandbox);
    vm.runInContext(
      `${clientIdSource}\n${migrateSource}\n${helperSource}\n${streamSource}\nglobalThis.__testExports = { checkStream };`,
      sandbox,
      { filename: 'popup.js' }
    );

    return sandbox;
  }

  async function loadPopupConnectionExports() {
    const source = await readFile(new URL('../popup.js', import.meta.url), 'utf8');
    const connectionSource = source.slice(
      source.indexOf('function checkTwitchConnection'),
      source.indexOf('async function checkStream')
    );
    const mainElement = { hidden: false };
    const loginTwitchElement = { textContent: '', disabled: false };
    const sandbox = {
      chrome: {
        storage: { local: { set: vi.fn() } },
        action: { setBadgeText: vi.fn() },
        notifications: { clear: vi.fn() },
      },
      document: {
        getElementById: vi.fn((id) => (id === 'main' ? mainElement : loginTwitchElement)),
      },
      loginTwitch: loginTwitchElement,
      AUTH_NOTIFICATION_ID: 'miteruyo-auth-expired',
      fetch: vi.fn(),
      console: { log: vi.fn(), error: vi.fn() },
    };

    vm.createContext(sandbox);
    vm.runInContext(
      `${connectionSource}\nglobalThis.__testExports = { checkTwitchConnection, rewriteNeedsLoginButton };`,
      sandbox,
      { filename: 'popup.js' }
    );

    return { sandbox, mainElement, loginTwitchElement };
  }

  async function loadPopupChannelExports(channels) {
    const source = await readFile(new URL('../popup.js', import.meta.url), 'utf8');
    const helperSource = source.slice(
      source.indexOf('function normalizeStoredChannels'),
      source.indexOf('// Category search using Twitch API')
    );
    const removeSource = source.slice(
      source.indexOf('function removeChannel'),
      source.indexOf('channelInput.addEventListener')
    );
    const channelSource = source.slice(
      source.indexOf('async function duplicatedChannel'),
      source.indexOf('enableSwitch.addEventListener')
    );
    const sandbox = {
      chrome: {
        storage: {
          local: {
            get: vi.fn((_key, callback) => {
              if (callback) callback({ channels });
              return Promise.resolve({ channels });
            }),
            set: vi.fn(),
          },
        },
      },
    };

    vm.createContext(sandbox);
    vm.runInContext(
      `${helperSource}\n${removeSource}\n${channelSource}\nglobalThis.__testExports = { removeChannel, duplicatedChannel, saveChannelToList };`,
      sandbox,
      { filename: 'popup.js' }
    );

    return sandbox;
  }

  it('keeps the add-channel and filter controls constrained to the popup width', async () => {
    const html = await loadPopupHtml();

    expect(html).toContain('input-group has-validation channel-add-group');
    expect(html).toContain('max-width: 100%;');
    expect(html).toContain('.channel-add-group');
    expect(html).toContain('flex-wrap: nowrap;');
    expect(html).toContain('#channelInput');
    expect(html).toContain('#addChannelBtn');
    expect(html).toContain('.popup-switches');
    expect(html).toContain('.popup-switch');
    expect(html).not.toContain('row form-switch');
  });

  it('gives channel row controls fixed space and lets channel names truncate', async () => {
    const html = await loadPopupHtml();
    const popupSource = await readFile(new URL('../popup.js', import.meta.url), 'utf8');

    expect(html).toContain('table-layout: fixed;');
    expect(html).toContain('flex: 0 0 80px;');
    expect(html).toContain('<col style="width: 124px;">');
    expect(html).toContain('<col style="width: 60px;">');
    expect(html).toContain('.channel-name-cell');
    expect(html).toContain('text-overflow: ellipsis;');
    expect(popupSource).toContain("cntd.className = 'channel-name-cell';");
  });

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

  it('cycles the auto-open toggle through normal -> snoozed -> paused -> normal', async () => {
    const { __testExports } = await loadPopupTestExports();

    const normal = { onLiveOpen: true, snoozed: false };
    expect(__testExports.getNextAutoOpenState(normal)).toEqual({ onLiveOpen: true, snoozed: true });

    const snoozed = { onLiveOpen: true, snoozed: true };
    expect(__testExports.getNextAutoOpenState(snoozed)).toEqual({ onLiveOpen: false, snoozed: false });

    const paused = { onLiveOpen: false, snoozed: false };
    expect(__testExports.getNextAutoOpenState(paused)).toEqual({ onLiveOpen: true, snoozed: false });
  });

  it('recovers to normal from an invalid onLiveOpen/snoozed combination', async () => {
    const { __testExports } = await loadPopupTestExports();

    expect(__testExports.getNextAutoOpenState({ onLiveOpen: false, snoozed: true }))
      .toEqual({ onLiveOpen: true, snoozed: false });
  });

  it('matches channel names case-insensitively for popup duplicate checks', async () => {
    const { __testExports } = await loadPopupTestExports();

    expect(__testExports.isSameChannel(
      { name: 'testuser' },
      { name: 'TestUser' }
    )).toBe(true);
    expect(__testExports.isSameChannel(
      { name: 'testuser' },
      { name: 'otheruser' }
    )).toBe(false);
    expect(__testExports.isSameChannel(
      { name: '' },
      { name: '' }
    )).toBe(false);
  });

  it('only renders settings controls for valid stored channel names', async () => {
    const { __testExports } = await loadPopupTestExports();

    expect(__testExports.canRenderChannelSettings({ name: 'Valid_User' })).toBe(true);
    expect(__testExports.getValidTwitchChannelName({ name: 'Valid_User' })).toBe('Valid_User');

    for (const channel of [
      { name: 123 },
      { name: {} },
      {},
      { name: '' },
      { name: 'ab' },
      { name: 'invalid user' },
    ]) {
      expect(__testExports.canRenderChannelSettings(channel)).toBe(false);
      expect(__testExports.getValidTwitchChannelName(channel)).toBe('');
    }
  });

  it('detects manually added channels with different casing as duplicates', async () => {
    const { __testExports } = await loadPopupChannelExports([{ name: 'testuser' }]);

    await expect(__testExports.duplicatedChannel({ name: 'TestUser' })).resolves.toBe(true);
  });

  it('replaces casing-only duplicate channels instead of appending them', async () => {
    const sandbox = await loadPopupChannelExports([{ name: 'testuser', onLiveOpen: false }]);

    sandbox.__testExports.saveChannelToList({ name: 'TestUser', onLiveOpen: true });

    expect(sandbox.chrome.storage.local.set).toHaveBeenCalledWith({
      channels: [{ name: 'TestUser', onLiveOpen: true }],
    });
  });

  it('removes casing-equivalent stored channels when deleting a channel', async () => {
    const sandbox = await loadPopupChannelExports([
      { name: 'testuser', onLiveOpen: false },
      { name: 'TestUser', onLiveOpen: true },
      { name: 'otheruser', onLiveOpen: true },
      null,
    ]);

    sandbox.__testExports.removeChannel({ name: 'TESTUSER' });

    expect(sandbox.chrome.storage.local.set).toHaveBeenCalledWith({
      channels: [{ name: 'otheruser', onLiveOpen: true }, null],
    });
  });

  it('removes only the clicked malformed stored channel by storage index', async () => {
    const malformedNumber = { name: 123, marker: 'clicked' };
    const malformedObject = { name: {}, marker: 'kept-object' };
    const emptyName = { name: '', marker: 'kept-empty' };
    const sameMalformedNumber = { name: 123, marker: 'kept-number' };
    const sandbox = await loadPopupChannelExports([
      malformedNumber,
      malformedObject,
      emptyName,
      sameMalformedNumber,
      { name: 'validuser' },
    ]);

    sandbox.__testExports.removeChannel(malformedNumber, 0);

    expect(sandbox.chrome.storage.local.set).toHaveBeenCalledWith({
      channels: [
        malformedObject,
        emptyName,
        sameMalformedNumber,
        { name: 'validuser' },
      ],
    });
  });

  it('removes an empty-name stored channel without wiping other malformed rows', async () => {
    const malformedNumber = { name: 123 };
    const emptyName = { name: '' };
    const nameless = {};
    const sandbox = await loadPopupChannelExports([
      malformedNumber,
      emptyName,
      nameless,
      { name: 'validuser' },
    ]);

    sandbox.__testExports.removeChannel(emptyName, 1);

    expect(sandbox.chrome.storage.local.set).toHaveBeenCalledWith({
      channels: [
        malformedNumber,
        nameless,
        { name: 'validuser' },
      ],
    });
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

  it('filters channel allowed dropdown options with legacy category matching', async () => {
    const { __testExports } = await loadPopupTestExports();
    const currentAllowed = [{ id: null, name: 'Just Chatting' }];
    const blockedCategories = [
      { id: '509658', name: 'just chatting' },
      { id: '26936', name: 'Music' },
    ];

    expect(__testExports.getCategoriesNotAlreadyIncluded(blockedCategories, currentAllowed)).toEqual([
      { id: '26936', name: 'Music' },
    ]);
  });

  it('does not append channel allowed dropdown selections already matched by legacy category name', async () => {
    const { __testExports } = await loadPopupTestExports();
    const currentAllowed = [{ id: null, name: 'Just Chatting' }];

    expect(__testExports.addCategoryIfMissing(currentAllowed, {
      id: '509658',
      name: 'just chatting',
    })).toBe(false);
    expect(currentAllowed).toEqual([{ id: null, name: 'Just Chatting' }]);
  });

  it('removes equivalent legacy and Twitch category tags together', async () => {
    const { __testExports } = await loadPopupTestExports();
    const categories = [
      { id: null, name: 'Just Chatting' },
      { id: '509658', name: 'just chatting' },
      { id: '26936', name: 'Music' },
    ];

    expect(__testExports.removeMatchingCategories(categories, {
      id: '509658',
      name: 'Just Chatting',
    })).toEqual([
      { id: '26936', name: 'Music' },
    ]);
  });

  it('keeps same-name categories with different Twitch ids when removing category tags', async () => {
    const { __testExports } = await loadPopupTestExports();
    const categories = [
      { id: '509658', name: 'Just Chatting' },
      { id: '123', name: 'Just Chatting' },
      { id: null, name: 'Music' },
    ];

    expect(__testExports.removeMatchingCategories(categories, {
      id: '509658',
      name: 'Just Chatting',
    })).toEqual([
      { id: '123', name: 'Just Chatting' },
      { id: null, name: 'Music' },
    ]);
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

  it.each([
    ['missing token', 'https://example.chromiumapp.org/#state=state-1&token_type=bearer'],
    ['query-string error token', 'https://example.chromiumapp.org/?error=access_denied&state=state-1'],
    ['query-string token', 'https://example.chromiumapp.org/?access_token=query-token&state=state-1'],
    ['empty token', 'https://example.chromiumapp.org/#access_token=&state=state-1&token_type=bearer'],
    ['blank token', 'https://example.chromiumapp.org/#access_token=%20%20&state=state-1&token_type=bearer'],
  ])('rejects matching-state auth callbacks with %s', async (_name, responseUrl) => {
    const sandbox = await loadPopupAuthExports();
    const { __testExports, chrome, checkTwitchConnection, rewriteNeedsLoginButton, console } = sandbox;

    __testExports.handleTwitchAuthResponse(responseUrl, 'state-1');

    expect(chrome.storage.local.set).not.toHaveBeenCalled();
    expect(checkTwitchConnection).not.toHaveBeenCalled();
    expect(rewriteNeedsLoginButton).toHaveBeenCalledWith(false);
    expect(console.error).toHaveBeenCalledWith('OAuth response missing access token');
  });

  it('rejects auth callbacks when launchWebAuthFlow reports an error', async () => {
    const sandbox = await loadPopupAuthExports();
    const { __testExports, chrome, checkTwitchConnection, rewriteNeedsLoginButton, console } = sandbox;

    __testExports.handleTwitchAuthResponse(undefined, 'state-1', {
      message: 'Authorization page could not be loaded.',
    });

    expect(chrome.storage.local.set).not.toHaveBeenCalled();
    expect(checkTwitchConnection).not.toHaveBeenCalled();
    expect(rewriteNeedsLoginButton).toHaveBeenCalledTimes(1);
    expect(rewriteNeedsLoginButton).toHaveBeenCalledWith(false);
    // The error branch must short-circuit: only the failure is logged, never the
    // misleading generic 'Invalid OAuth response'.
    expect(console.error).toHaveBeenCalledTimes(1);
    expect(console.error).toHaveBeenCalledWith(
      'Twitch authorization failed:',
      'Authorization page could not be loaded.'
    );
    expect(console.error).not.toHaveBeenCalledWith('Invalid OAuth response');
  });

  it('reads chrome.runtime.lastError inside the launchWebAuthFlow callback', async () => {
    const sandbox = await loadPopupAuthExports();
    const { __testExports, chrome, checkTwitchConnection, rewriteNeedsLoginButton, console } = sandbox;
    // Simulate Chrome failing to load the auth page: callback fires with no
    // responseUrl while chrome.runtime.lastError is populated.
    chrome.runtime.lastError = { message: 'Authorization page could not be loaded.' };
    chrome.identity.launchWebAuthFlow.mockImplementation((_options, callback) => {
      callback(undefined);
    });

    __testExports.startTwitchAuthFlow();

    expect(chrome.identity.launchWebAuthFlow).toHaveBeenCalledTimes(1);
    expect(chrome.storage.local.set).not.toHaveBeenCalled();
    expect(checkTwitchConnection).not.toHaveBeenCalled();
    expect(rewriteNeedsLoginButton).toHaveBeenCalledWith(false);
    expect(console.error).toHaveBeenCalledWith(
      'Twitch authorization failed:',
      'Authorization page could not be loaded.'
    );
  });

  it('builds the Twitch auth URL with encoded redirect and scope parameters', async () => {
    const sandbox = await loadPopupAuthExports();
    const { __testExports, chrome } = sandbox;
    chrome.identity.launchWebAuthFlow.mockImplementation(() => {});

    __testExports.startTwitchAuthFlow();

    const options = chrome.identity.launchWebAuthFlow.mock.calls[0][0];
    const authUrl = new URL(options.url);
    expect(authUrl.origin).toBe('https://id.twitch.tv');
    expect(authUrl.pathname).toBe('/oauth2/authorize');
    expect(authUrl.searchParams.get('client_id')).toBe('test-client-id');
    expect(authUrl.searchParams.get('redirect_uri')).toBe('https://example.chromiumapp.org/');
    expect(authUrl.searchParams.get('response_type')).toBe('token');
    expect(authUrl.searchParams.get('scope')).toBe('user:read:email');
    expect(authUrl.searchParams.get('state')).toBe('state-1');
    expect(options.url).toContain('redirect_uri=https%3A%2F%2Fexample.chromiumapp.org%2F');
  });

  it('rejects malformed auth callbacks without logging the raw response', async () => {
    const sandbox = await loadPopupAuthExports();
    const { __testExports, chrome, checkTwitchConnection, rewriteNeedsLoginButton, console } = sandbox;

    __testExports.handleTwitchAuthResponse('not a valid URL', 'state-1');

    expect(chrome.storage.local.set).not.toHaveBeenCalled();
    expect(checkTwitchConnection).not.toHaveBeenCalled();
    expect(rewriteNeedsLoginButton).toHaveBeenCalledWith(false);
    expect(console.error).toHaveBeenCalledWith('Invalid OAuth response');
    expect(console.error.mock.calls.flat().join('\n')).not.toContain('not a valid URL');
  });

  it('preserves state mismatch rejection before token storage', async () => {
    const sandbox = await loadPopupAuthExports();
    const { __testExports, chrome, checkTwitchConnection, rewriteNeedsLoginButton, console } = sandbox;

    __testExports.handleTwitchAuthResponse(
      'https://example.chromiumapp.org/#access_token=secret-token&state=attacker',
      'state-1'
    );

    expect(chrome.storage.local.set).not.toHaveBeenCalled();
    expect(checkTwitchConnection).not.toHaveBeenCalled();
    expect(rewriteNeedsLoginButton).toHaveBeenCalledWith(false);
    expect(console.error).toHaveBeenCalledWith('OAuth state mismatch: possible CSRF attack');
  });

  it('clears the auth-expired badge and flag when reconnecting succeeds', async () => {
    const { sandbox } = await loadPopupConnectionExports();
    sandbox.fetch.mockResolvedValue({ ok: true });

    const result = await sandbox.__testExports.checkTwitchConnection('valid-token');

    expect(result).toBe(true);
    expect(sandbox.chrome.action.setBadgeText).toHaveBeenCalledWith({ text: '' });
    expect(sandbox.chrome.storage.local.set).toHaveBeenCalledWith({ isAuthExpired: false });
    expect(sandbox.chrome.notifications.clear).toHaveBeenCalledWith('miteruyo-auth-expired');
  });

  it('does not touch the badge when reconnecting still fails', async () => {
    const { sandbox } = await loadPopupConnectionExports();
    sandbox.fetch.mockResolvedValue({ ok: false });

    const result = await sandbox.__testExports.checkTwitchConnection('bad-token');

    expect(result).toBe(false);
    expect(sandbox.chrome.action.setBadgeText).not.toHaveBeenCalled();
    expect(sandbox.chrome.storage.local.set).not.toHaveBeenCalled();
  });

  it('keeps its AUTH_NOTIFICATION_ID constant in sync with background-functions.js (issue #147)', async () => {
    const popupSource = await readFile(new URL('../popup.js', import.meta.url), 'utf8');
    const backgroundSource = await readFile(new URL('../background-functions.js', import.meta.url), 'utf8');

    const popupMatch = popupSource.match(/const AUTH_NOTIFICATION_ID = '([^']+)';/);
    const backgroundMatch = backgroundSource.match(/const AUTH_NOTIFICATION_ID = '([^']+)';/);

    expect(popupMatch).not.toBeNull();
    expect(backgroundMatch).not.toBeNull();
    expect(popupMatch[1]).toBe(backgroundMatch[1]);
  });

  it('shows the development-support terms in a native disclosure above the OFUSE link', async () => {
    const html = await loadPopupHtml();

    expect(html).toContain('<details class="mb-2">');
    expect(html).toContain('<summary class="text-muted" id="supportDetailsSummary">');
    expect(html).toContain('class="modal-dialog modal-dialog-centered modal-dialog-scrollable"');
    expect(html).toContain('href="https://ofuse.me/8fe1bedb"');
    expect(html).toContain('rel="noopener noreferrer"');
    [
      'supportDetailsIntro',
      'supportDetailsRequests',
      'supportDetailsDisclaimer',
      'supportDetailsRights',
      'supportDetailsPrivacy',
    ].forEach((id) => expect(html).toContain(`id="${id}"`));
  });

  it('provides complete localized development-support terms', async () => {
    const [jaSource, enSource] = await Promise.all([
      readFile(new URL('../_locales/ja/messages.json', import.meta.url), 'utf8'),
      readFile(new URL('../_locales/en/messages.json', import.meta.url), 'utf8'),
    ]);
    const ja = JSON.parse(jaSource);
    const en = JSON.parse(enSource);
    const keys = [
      'supportDetailsSummary',
      'supportDetailsIntro',
      'supportDetailsRequests',
      'supportDetailsDisclaimer',
      'supportDetailsRights',
      'supportDetailsPrivacy',
    ];

    keys.forEach((key) => {
      expect(ja[key].message).toBeTruthy();
      expect(en[key].message).toBeTruthy();
    });
    expect(keys.map((key) => ja[key].message)).toEqual([
      '開発支援について',
      'このソフトは、もともと作者自身の利用のために開発しているものを、希望があったため無料で公開しているものです。',
      '開発継続の支援として、OFUSEの支援付きレターで不具合報告・改善案・機能要望を受け付けています。',
      'いただいた内容は今後の開発の参考にしますが、採用・実装・返信・調査・修正・公開時期を保証するものではありません。個別の開発依頼、請負契約、有償サポートとしてお受けするものではありません。',
      '採用した内容は、作者の判断で無料公開版や今後の関連ソフトに反映する場合があります。その場合でも、投稿者への個別報酬、権利付与、クレジット表記等は発生しません。',
      '個人情報、秘密情報、業務上の機密、第三者の著作物・コードなどは送信しないでください。',
    ]);
  });

  it('describes auto-open-once as a current-stream snooze in both locales', async () => {
    const [jaSource, enSource] = await Promise.all([
      readFile(new URL('../_locales/ja/messages.json', import.meta.url), 'utf8'),
      readFile(new URL('../_locales/en/messages.json', import.meta.url), 'utf8'),
    ]);
    const ja = JSON.parse(jaSource);
    const en = JSON.parse(enSource);

    expect(ja.autoOpenOnce.message).toBe('自動で開いたタブを閉じたら次の配信まで開かない');
    expect(en.autoOpenOnce.message).toBe('Closing an auto-opened tab snoozes until the next stream');
  });

  it.each([
    ['non-string name', { name: 123 }],
    ['missing name', { onLiveOpen: true }],
    ['empty name', { name: '' }],
    ['too-short name', { name: 'ab' }],
    ['invalid characters', { name: 'bad user' }],
  ])('does not query Twitch streams for %s', async (_name, channel) => {
    const sandbox = await loadPopupStreamExports();
    const { __testExports, chrome, fetch } = sandbox;

    const result = await __testExports.checkStream(channel);

    expect(fetch).not.toHaveBeenCalled();
    expect(chrome.storage.local.get).not.toHaveBeenCalled();
    expect(result).toBe(channel);
    expect(result.onLive).toBe(false);
    expect(result.status).toBe('error');
    expect(result.lastError).toBe('Invalid channel name');
  });

  it('queries Twitch streams for valid stored channel names', async () => {
    const sandbox = await loadPopupStreamExports();
    const { __testExports, chrome, fetch } = sandbox;
    fetch.mockResolvedValue({ ok: false, status: 401 });
    const channel = { name: 'Valid_User' };

    const result = await __testExports.checkStream(channel);

    expect(chrome.storage.local.get).toHaveBeenCalledWith('oauth_token');
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch.mock.calls[0][0]).toBe('https://api.twitch.tv/helix/streams?user_login=Valid_User');
    expect(fetch.mock.calls[0][1].headers).toEqual({
      'Client-ID': 'lt060jwpltwp3weqdk53dx450aj99p',
      'Authorization': 'Bearer token-1',
    });
    expect(result.status).toBe('error');
  });
});
