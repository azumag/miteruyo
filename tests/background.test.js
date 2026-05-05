import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createChromeMock } from './setup.js';
import {
  ensureAlarmsExist,
  shouldOpenChannel,
  onWindowRemoved,
  onStorageChangedForTabRotation,
  onStorageChangedForCheckInterval,
  isTwitchChannelPage,
  showNotification,
  checkTabRotate,
  checkStreams,
  validateToken,
  migrateOAuthToken,
  channelQueuedStreams,
  channelQueuedStreamsInMultiTwitch,
  onNotificationClicked,
  openInManagedWindow,
  checkOfflineWithTab,
  countTwitchChannelTabs,
  displaceNonPriorityTabs,
} from '../background-functions.js';

describe('Background Script', () => {
  let chromeMock;
  let originalChrome;
  let originalFetch;

  beforeEach(() => {
    chromeMock = createChromeMock();
    originalChrome = globalThis.chrome;
    originalFetch = globalThis.fetch;
    globalThis.chrome = chromeMock;
  });

  afterEach(() => {
    globalThis.chrome = originalChrome;
    globalThis.fetch = originalFetch;
    vi.clearAllMocks();
  });

  describe('isTwitchChannelPage', () => {
    it('should return true for valid channel URLs', () => {
      expect(isTwitchChannelPage('https://www.twitch.tv/testuser')).toBe(true);
      expect(isTwitchChannelPage('https://twitch.tv/testuser')).toBe(true);
    });

    it('should return false for system pages', () => {
      expect(isTwitchChannelPage('https://www.twitch.tv/directory')).toBe(false);
      expect(isTwitchChannelPage('https://www.twitch.tv/settings')).toBe(false);
    });

    it('should return false for invalid inputs', () => {
      expect(isTwitchChannelPage(null)).toBe(false);
      expect(isTwitchChannelPage('')).toBe(false);
      expect(isTwitchChannelPage('https://example.com')).toBe(false);
    });
  });

  describe('ensureAlarmsExist', () => {
    it('should create periodicalUpdate alarm if it does not exist', async () => {
      // Mock: no alarms exist, tab rotation disabled
      chromeMock.alarms.get.mockResolvedValue(null);
      chromeMock.storage.local.get.mockResolvedValue({
        isEnabledTabRotation: false,
      });

      await ensureAlarmsExist();

      expect(chromeMock.alarms.get).toHaveBeenCalledWith('periodicalUpdate');
      expect(chromeMock.alarms.create).toHaveBeenCalledWith('periodicalUpdate', {
        periodInMinutes: 1,
      });
    });

    it('should not create alarm if it already exists', async () => {
      // Mock: periodicalUpdate exists, tabRotationAlarm exists
      chromeMock.alarms.get
        .mockResolvedValueOnce({ name: 'periodicalUpdate' })
        .mockResolvedValueOnce({ name: 'tabRotationAlarm' });

      await ensureAlarmsExist();

      expect(chromeMock.alarms.create).not.toHaveBeenCalled();
    });
  });

  describe('checkStream (integration)', () => {
    it('should return online status when stream is live', async () => {
      const mockStreamData = {
        data: [{
          game_name: 'Test Game',
          game_id: '123',
          title: 'Test Stream',
          viewer_count: 100,
          tags: ['tag1'],
          user_id: '12345',
        }],
      };

      const mockChannelData = {
        data: [{ is_branded_content: false }],
      };

      globalThis.fetch = vi.fn()
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve(mockStreamData),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve(mockChannelData),
        });

      // checkStreams calls the internal checkStream function
      // Set up storage so checkStreams will process our channel
      chromeMock.storage.local.get.mockResolvedValue({
        isEnabled: true,
        isEnabledNotifications: false,
        isOpenMultiTwitch: false,
        channels: [{ name: 'testchannel', onLiveOpen: false }],
        oauth_token: 'test_token',
        isEnabledAutoClose: false,
      });

      await checkStreams();

      // Verify that channels were updated with online status
      const setCall = chromeMock.storage.local.set.mock.calls.find(
        call => call[0].channels
      );
      expect(setCall).toBeDefined();
      const updatedChannels = setCall[0].channels;
      expect(updatedChannels[0].onLive).toBe(true);
      expect(updatedChannels[0].status).toBe('online');
      expect(updatedChannels[0].game_name).toBe('Test Game');
      expect(updatedChannels[0].game_id).toBe('123');
      expect(updatedChannels[0].viewer_count).toBe(100);
      expect(updatedChannels[0].is_branded_content).toBe(false);
      expect(updatedChannels[0].lastChecked).toBeDefined();
      // hasBeenOpened should be reset when channel goes online
      expect(updatedChannels[0].hasBeenOpened).toBe(false);
      // snoozed should also be reset when channel goes online
      expect(updatedChannels[0].snoozed).toBe(false);
    });

    it('should reset snoozed flag when channel goes from offline to online', async () => {
      const mockStreamData = {
        data: [{
          game_name: 'Test Game',
          game_id: '123',
          title: 'Test Stream',
          viewer_count: 100,
          tags: ['tag1'],
          user_id: '12345',
        }],
      };

      const mockChannelData = {
        data: [{ is_branded_content: false }],
      };

      globalThis.fetch = vi.fn()
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve(mockStreamData),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve(mockChannelData),
        });

      chromeMock.storage.local.get.mockResolvedValue({
        isEnabled: true,
        isEnabledNotifications: false,
        isOpenMultiTwitch: false,
        channels: [{ name: 'testchannel', onLiveOpen: false, onLive: false, snoozed: true }],
        oauth_token: 'test_token',
        isEnabledAutoClose: false,
      });

      await checkStreams();

      const setCall = chromeMock.storage.local.set.mock.calls.find(
        call => call[0].channels
      );
      expect(setCall).toBeDefined();
      const updatedChannels = setCall[0].channels;
      expect(updatedChannels[0].onLive).toBe(true);
      expect(updatedChannels[0].snoozed).toBe(false);
    });

    it('should return offline status when stream is not live', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ data: [] }),
      });

      chromeMock.storage.local.get.mockResolvedValue({
        isEnabled: true,
        isEnabledNotifications: false,
        isOpenMultiTwitch: false,
        channels: [{ name: 'offlinechannel', onLiveOpen: false }],
        oauth_token: 'test_token',
        isEnabledAutoClose: false,
      });

      await checkStreams();

      const setCall = chromeMock.storage.local.set.mock.calls.find(
        call => call[0].channels
      );
      expect(setCall).toBeDefined();
      const updatedChannels = setCall[0].channels;
      expect(updatedChannels[0].onLive).toBe(false);
      expect(updatedChannels[0].status).toBe('offline');
      expect(updatedChannels[0].lastChecked).toBeDefined();
    });

    it('should handle null channel gracefully in checkStreams', async () => {
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ data: [] }),
      });

      chromeMock.storage.local.get.mockResolvedValue({
        isEnabled: true,
        isEnabledNotifications: false,
        isOpenMultiTwitch: false,
        channels: [null],
        oauth_token: 'test_token',
        isEnabledAutoClose: false,
      });

      await checkStreams();

      const setCall = chromeMock.storage.local.set.mock.calls.find(
        call => call[0].channels
      );
      expect(setCall).toBeDefined();
      // null channel returns null from checkStream
      expect(setCall[0].channels[0]).toBeNull();
      expect(consoleErrorSpy).not.toHaveBeenCalledWith(
        'checkStreams error:',
        expect.anything()
      );
      consoleErrorSpy.mockRestore();
    });

    it('should handle null channel gracefully when MultiTwitch is enabled', async () => {
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ data: [] }),
      });

      chromeMock.storage.local.get.mockResolvedValue({
        isEnabled: true,
        isEnabledNotifications: false,
        isOpenMultiTwitch: true,
        channels: [null],
        oauth_token: 'test_token',
        isEnabledAutoClose: false,
      });

      await checkStreams();

      expect(consoleErrorSpy).not.toHaveBeenCalledWith(
        'checkStreams error:',
        expect.anything()
      );
      consoleErrorSpy.mockRestore();
    });

    it('should treat non-array stored channels as empty in checkStreams', async () => {
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      globalThis.fetch = vi.fn();

      chromeMock.storage.local.get.mockResolvedValue({
        isEnabled: true,
        isEnabledNotifications: false,
        isOpenMultiTwitch: false,
        channels: { testchannel: { name: 'testchannel' } },
        oauth_token: 'test_token',
      });

      await checkStreams();

      expect(globalThis.fetch).not.toHaveBeenCalled();
      expect(chromeMock.storage.local.set).not.toHaveBeenCalledWith(
        expect.objectContaining({ channels: expect.anything() })
      );
      expect(consoleErrorSpy).not.toHaveBeenCalledWith(
        'checkStreams error:',
        expect.anything()
      );
      consoleErrorSpy.mockRestore();
    });
  });

  describe('channelQueuedStreamsInMultiTwitch', () => {
    it('should treat non-array stored channels as empty', async () => {
      chromeMock.storage.local.get.mockResolvedValue({
        isEnabled: true,
        channels: 'broken-channel-data',
      });

      await channelQueuedStreamsInMultiTwitch();

      expect(chromeMock.tabs.query).not.toHaveBeenCalled();
      expect(chromeMock.tabs.create).not.toHaveBeenCalled();
    });

    it('should preserve MultiTwitch URL creation for valid channel arrays', async () => {
      chromeMock.storage.local.get.mockImplementation((keys) => {
        if (Array.isArray(keys) && keys.includes('channels')) {
          return Promise.resolve({
            isEnabled: true,
            channels: [
              { name: 'first', onLive: true, onLiveOpen: true },
              { name: 'offline', onLive: false, onLiveOpen: true },
              { name: 'second', onLive: true, onLiveOpen: true },
            ],
          });
        }
        if (keys === 'lastOpenWindowId') {
          return Promise.resolve({ lastOpenWindowId: 10 });
        }
        return Promise.resolve({});
      });
      chromeMock.tabs.query.mockResolvedValue([]);

      await channelQueuedStreamsInMultiTwitch();

      expect(chromeMock.tabs.create).toHaveBeenCalledWith({
        url: 'https://multitwitch.tv/first/second',
        windowId: 10,
      });
    });
  });

  describe('API response error handling', () => {
    it('should handle HTTP error responses gracefully', async () => {
      // Mock fetch returning a non-ok response
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 401,
        json: () => Promise.resolve({ error: 'Unauthorized' }),
        headers: { get: () => null },
      });

      chromeMock.storage.local.get.mockResolvedValue({
        isEnabled: true,
        isEnabledNotifications: false,
        isOpenMultiTwitch: false,
        channels: [{ name: 'testchannel', onLiveOpen: false }],
        oauth_token: 'expired_token',
        isEnabledAutoClose: false,
      });

      await checkStreams();

      const setCall = chromeMock.storage.local.set.mock.calls.find(
        call => call[0].channels
      );
      expect(setCall).toBeDefined();
      expect(setCall[0].channels[0].status).toBe('error');
      expect(setCall[0].channels[0].lastError).toBe('HTTP 401');
    });

    it('should handle invalid JSON response gracefully', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.reject(new SyntaxError('Unexpected token')),
        headers: { get: () => null },
      });

      chromeMock.storage.local.get.mockResolvedValue({
        isEnabled: true,
        isEnabledNotifications: false,
        isOpenMultiTwitch: false,
        channels: [{ name: 'testchannel', onLiveOpen: false }],
        oauth_token: 'test_token',
        isEnabledAutoClose: false,
      });

      await checkStreams();

      const setCall = chromeMock.storage.local.set.mock.calls.find(
        call => call[0].channels
      );
      expect(setCall).toBeDefined();
      expect(setCall[0].channels[0].status).toBe('error');
      expect(setCall[0].channels[0].lastError).toBe('JSON parse error');
    });

    it('should handle rate limit (429) response with retry', async () => {
      // First call returns 429, second call succeeds
      globalThis.fetch = vi.fn()
        .mockResolvedValueOnce({
          ok: false,
          status: 429,
          headers: { get: () => null },
          json: () => Promise.resolve({}),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ data: [] }),
          headers: { get: () => null },
        });

      chromeMock.storage.local.get.mockResolvedValue({
        isEnabled: true,
        isEnabledNotifications: false,
        isOpenMultiTwitch: false,
        channels: [{ name: 'testchannel', onLiveOpen: false }],
        oauth_token: 'test_token',
        isEnabledAutoClose: false,
      });

      await checkStreams();

      // fetchWithRetry should have retried after 429
      expect(globalThis.fetch).toHaveBeenCalledTimes(2);
      const setCall = chromeMock.storage.local.set.mock.calls.find(
        call => call[0].channels
      );
      expect(setCall).toBeDefined();
      expect(setCall[0].channels[0].status).toBe('offline');
    });
  });

  describe('checkStreams (integration)', () => {
    it('should skip if both extension and notifications are disabled', async () => {
      chromeMock.storage.local.get.mockResolvedValue({
        isEnabled: false,
        isEnabledNotifications: false,
        channels: [],
        oauth_token: null,
      });

      await checkStreams();

      // Should not save any channels since it returned early
      const setCall = chromeMock.storage.local.set.mock.calls.find(
        call => call[0].channels
      );
      expect(setCall).toBeUndefined();
    });

    it('should skip if no oauth token', async () => {
      chromeMock.storage.local.get.mockResolvedValue({
        isEnabled: true,
        isEnabledNotifications: false,
        isOpenMultiTwitch: false,
        channels: [{ name: 'test' }],
        oauth_token: null,
      });

      await checkStreams();

      // Should not save any channels since it returned early
      const setCall = chromeMock.storage.local.set.mock.calls.find(
        call => call[0].channels
      );
      expect(setCall).toBeUndefined();
    });
  });

  describe('Parallel processing', () => {
    it('should process multiple channels in parallel', async () => {
      const channels = [
        { name: 'channel1', onLiveOpen: false },
        { name: 'channel2', onLiveOpen: false },
        { name: 'channel3', onLiveOpen: false },
      ];

      globalThis.fetch = vi.fn().mockImplementation(() => {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ data: [] }),
        });
      });

      chromeMock.storage.local.get.mockResolvedValue({
        isEnabled: true,
        isEnabledNotifications: false,
        isOpenMultiTwitch: false,
        channels: channels,
        oauth_token: 'test',
        isEnabledAutoClose: false,
      });

      await checkStreams();

      const setCall = chromeMock.storage.local.set.mock.calls.find(
        call => call[0].channels
      );
      expect(setCall).toBeDefined();
      expect(setCall[0].channels).toHaveLength(3);
      // Each channel triggers one fetch (offline channels don't need 2nd fetch)
      expect(globalThis.fetch).toHaveBeenCalledTimes(3);
    });

    it('should handle errors gracefully in parallel processing', async () => {
      const channels = [
        { name: 'channel1', onLiveOpen: false },
        { name: 'error_channel', onLiveOpen: false },
      ];

      globalThis.fetch = vi.fn().mockImplementation((url) => {
        if (url.includes('error_channel')) {
          return Promise.reject(new Error('Network error'));
        }
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ data: [] }),
        });
      });

      chromeMock.storage.local.get.mockResolvedValue({
        isEnabled: true,
        isEnabledNotifications: false,
        isOpenMultiTwitch: false,
        channels: channels,
        oauth_token: 'test',
        isEnabledAutoClose: false,
      });

      await checkStreams();

      const setCall = chromeMock.storage.local.set.mock.calls.find(
        call => call[0].channels
      );
      expect(setCall).toBeDefined();
      expect(setCall[0].channels).toHaveLength(2);
      expect(setCall[0].channels[0].status).toBe('offline');
      expect(setCall[0].channels[1].status).toBe('error');
    });
  });

  describe('shouldOpenChannel', () => {
    it('should return false if channel is not live', async () => {
      const result = await shouldOpenChannel({ name: 'test', onLive: false, onLiveOpen: true });
      expect(result).toBe(false);
    });

    it('should block channel with allowed-only list when category does not match', async () => {
      chromeMock.storage.local.get.mockResolvedValue({
        allowedOnlyCategoryList: [{ id: '123', name: 'Test Game' }],
        blockedCategoryList: [],
        blockedCategoryNames: '',
        isSkipBrandedContent: false,
      });

      const result = await shouldOpenChannel({
        name: 'test',
        onLive: true,
        onLiveOpen: true,
        game_id: '456',
        game_name: 'Other Game',
      });
      expect(result).toBe(false);
    });

    it('should open channel with allowed-only list when category matches', async () => {
      chromeMock.storage.local.get.mockResolvedValue({
        allowedOnlyCategoryList: [{ id: '123', name: 'Test Game' }],
        blockedCategoryList: [],
        blockedCategoryNames: '',
        isSkipBrandedContent: false,
      });

      const result = await shouldOpenChannel({
        name: 'test',
        onLive: true,
        onLiveOpen: true,
        game_id: '123',
        game_name: 'Test Game',
      });
      expect(result).toBe(true);
    });

    it('should prioritize channel allowed-only list over global allowed-only list', async () => {
      chromeMock.storage.local.get.mockResolvedValue({
        allowedOnlyCategoryList: [{ id: '123', name: 'Global Game' }],
        blockedCategoryList: [],
        blockedCategoryNames: '',
        isSkipBrandedContent: false,
      });

      const result = await shouldOpenChannel({
        name: 'test',
        onLive: true,
        onLiveOpen: true,
        game_id: '456',
        game_name: 'Channel Game',
        allowedOnlyCategoryList: [{ id: '456', name: 'Channel Game' }],
      });
      expect(result).toBe(true);
    });

    it('should use blocked list when no allowed-only list is set', async () => {
      chromeMock.storage.local.get.mockResolvedValue({
        allowedOnlyCategoryList: [],
        blockedCategoryList: [{ id: '123', name: 'Blocked Game' }],
        blockedCategoryNames: '',
        isSkipBrandedContent: false,
      });

      const result = await shouldOpenChannel({
        name: 'test',
        onLive: true,
        onLiveOpen: true,
        game_id: '123',
        game_name: 'Blocked Game',
      });
      expect(result).toBe(false);
    });

    it('should block branded content when isSkipBrandedContent is true', async () => {
      chromeMock.storage.local.get.mockImplementation((keys) => {
        if (typeof keys === 'string' && keys === 'isSkipBrandedContent') {
          return Promise.resolve({ isSkipBrandedContent: true });
        }
        return Promise.resolve({
          allowedOnlyCategoryList: [],
          blockedCategoryList: [],
          blockedCategoryNames: '',
        });
      });

      const result = await shouldOpenChannel({
        name: 'test',
        onLive: true,
        onLiveOpen: true,
        is_branded_content: true,
        game_name: 'Test Game',
      });
      expect(result).toBe(false);
    });

    it('should return false when isAutoOpenOnce is true and hasBeenOpened is true', async () => {
      chromeMock.storage.local.get.mockImplementation((keys) => {
        if (typeof keys === 'string' && keys === 'isAutoOpenOnce') {
          return Promise.resolve({ isAutoOpenOnce: true });
        }
        return Promise.resolve({
          allowedOnlyCategoryList: [],
          blockedCategoryList: [],
          blockedCategoryNames: '',
        });
      });

      const result = await shouldOpenChannel({
        name: 'test',
        onLive: true,
        onLiveOpen: true,
        hasBeenOpened: true,
        game_name: 'Test Game',
      });
      expect(result).toBe(false);
    });

    it('should return true when isAutoOpenOnce is true but hasBeenOpened is false', async () => {
      chromeMock.storage.local.get.mockImplementation((keys) => {
        if (typeof keys === 'string' && keys === 'isAutoOpenOnce') {
          return Promise.resolve({ isAutoOpenOnce: true });
        }
        if (typeof keys === 'string' && keys === 'isSkipBrandedContent') {
          return Promise.resolve({ isSkipBrandedContent: false });
        }
        return Promise.resolve({
          allowedOnlyCategoryList: [],
          blockedCategoryList: [],
          blockedCategoryNames: '',
        });
      });

      const result = await shouldOpenChannel({
        name: 'test',
        onLive: true,
        onLiveOpen: true,
        hasBeenOpened: false,
        game_name: 'Test Game',
      });
      expect(result).toBe(true);
    });

    it('should return true when isAutoOpenOnce is false even if hasBeenOpened is true', async () => {
      chromeMock.storage.local.get.mockImplementation((keys) => {
        if (typeof keys === 'string' && keys === 'isAutoOpenOnce') {
          return Promise.resolve({ isAutoOpenOnce: false });
        }
        if (typeof keys === 'string' && keys === 'isSkipBrandedContent') {
          return Promise.resolve({ isSkipBrandedContent: false });
        }
        return Promise.resolve({
          allowedOnlyCategoryList: [],
          blockedCategoryList: [],
          blockedCategoryNames: '',
        });
      });

      const result = await shouldOpenChannel({
        name: 'test',
        onLive: true,
        onLiveOpen: true,
        hasBeenOpened: true,
        game_name: 'Test Game',
      });
      expect(result).toBe(true);
    });

    it('should return true when forAutoClose is true even if isAutoOpenOnce and hasBeenOpened are true', async () => {
      chromeMock.storage.local.get.mockImplementation((keys) => {
        if (typeof keys === 'string' && keys === 'isSkipBrandedContent') {
          return Promise.resolve({ isSkipBrandedContent: false });
        }
        return Promise.resolve({
          allowedOnlyCategoryList: [],
          blockedCategoryList: [],
          blockedCategoryNames: '',
        });
      });

      const result = await shouldOpenChannel({
        name: 'test',
        onLive: true,
        onLiveOpen: true,
        hasBeenOpened: true,
        game_name: 'Test Game',
      }, { forAutoClose: true });
      expect(result).toBe(true);
    });

    it('should return false when channel is snoozed', async () => {
      chromeMock.storage.local.get.mockImplementation((keys) => {
        if (typeof keys === 'string' && keys === 'isSkipBrandedContent') {
          return Promise.resolve({ isSkipBrandedContent: false });
        }
        return Promise.resolve({
          allowedOnlyCategoryList: [],
          blockedCategoryList: [],
          blockedCategoryNames: '',
        });
      });

      const result = await shouldOpenChannel({
        name: 'test',
        onLive: true,
        onLiveOpen: true,
        snoozed: true,
        game_name: 'Test Game',
      });
      expect(result).toBe(false);
    });

    it('should return false when channel is snoozed even if not snoozed previously (no reset while online)', async () => {
      // Verify snooze is NOT reset when channel stays continuously online
      const mockStreamData = {
        data: [{
          game_name: 'Test Game',
          game_id: '123',
          title: 'Test Stream',
          viewer_count: 100,
          tags: ['tag1'],
          user_id: '12345',
        }],
      };
      const mockChannelData = {
        data: [{ is_branded_content: false }],
      };

      globalThis.fetch = vi.fn()
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve(mockStreamData),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve(mockChannelData),
        });

      chromeMock.storage.local.get.mockResolvedValue({
        isEnabled: true,
        isEnabledNotifications: false,
        isOpenMultiTwitch: false,
        channels: [{ name: 'testchannel', onLiveOpen: true, onLive: true, snoozed: true }],
        oauth_token: 'test_token',
        isEnabledAutoClose: false,
      });

      await checkStreams();

      const setCall = chromeMock.storage.local.set.mock.calls.find(
        call => call[0].channels
      );
      expect(setCall).toBeDefined();
      const updatedChannels = setCall[0].channels;
      expect(updatedChannels[0].onLive).toBe(true);
      // snoozed should remain true when channel stays online
      expect(updatedChannels[0].snoozed).toBe(true);
    });

    it('should return true when forAutoClose is true even if channel is snoozed', async () => {
      chromeMock.storage.local.get.mockImplementation((keys) => {
        if (typeof keys === 'string' && keys === 'isSkipBrandedContent') {
          return Promise.resolve({ isSkipBrandedContent: false });
        }
        return Promise.resolve({
          allowedOnlyCategoryList: [],
          blockedCategoryList: [],
          blockedCategoryNames: '',
        });
      });

      const result = await shouldOpenChannel({
        name: 'test',
        onLive: true,
        onLiveOpen: true,
        snoozed: true,
        game_name: 'Test Game',
      }, { forAutoClose: true });
      expect(result).toBe(true);
    });

    it('should allow branded content when channel brandedContentSetting is open', async () => {
      chromeMock.storage.local.get.mockResolvedValue({
        allowedOnlyCategoryList: [],
        blockedCategoryList: [],
        blockedCategoryNames: '',
      });

      const result = await shouldOpenChannel({
        name: 'test',
        onLive: true,
        onLiveOpen: true,
        is_branded_content: true,
        brandedContentSetting: 'open',
        game_name: 'Test Game',
      });
      expect(result).toBe(true);
    });
  });

  describe('tabRotationAlarm', () => {
    it('should create tabRotationAlarm only when isEnabledTabRotation is true', async () => {
      chromeMock.alarms.get.mockResolvedValue(null);
      chromeMock.storage.local.get.mockResolvedValue({
        isEnabledTabRotation: true,
        tabRotationInterval: 5,
      });

      await ensureAlarmsExist();

      expect(chromeMock.alarms.create).toHaveBeenCalledWith('tabRotationAlarm', {
        periodInMinutes: 5,
      });
    });

    it('should not create tabRotationAlarm when isEnabledTabRotation is false', async () => {
      // periodicalUpdate already exists, tabRotationAlarm does not
      chromeMock.alarms.get
        .mockResolvedValueOnce({ name: 'periodicalUpdate' })
        .mockResolvedValueOnce(null);
      chromeMock.storage.local.get.mockResolvedValue({
        isEnabledTabRotation: false,
        tabRotationInterval: 5,
      });

      await ensureAlarmsExist();

      // Only periodicalUpdate check should not trigger create
      expect(chromeMock.alarms.create).not.toHaveBeenCalled();
    });

    it('should use default interval of 5 when tabRotationInterval is not set', async () => {
      chromeMock.alarms.get.mockResolvedValue(null);
      chromeMock.storage.local.get.mockResolvedValue({
        isEnabledTabRotation: true,
      });

      await ensureAlarmsExist();

      expect(chromeMock.alarms.create).toHaveBeenCalledWith('tabRotationAlarm', {
        periodInMinutes: 5,
      });
    });
  });

  describe('windowRemovalListener', () => {
    it('should clear lastOpenWindowId when managed window is closed', async () => {
      const managedWindowId = 123;
      chromeMock.storage.local.get.mockResolvedValue({ lastOpenWindowId: managedWindowId });

      await onWindowRemoved(managedWindowId);

      expect(chromeMock.storage.local.set).toHaveBeenCalledWith({ lastOpenWindowId: null });
    });

    it('should not clear lastOpenWindowId when different window is closed', async () => {
      chromeMock.storage.local.get.mockResolvedValue({ lastOpenWindowId: 123 });

      await onWindowRemoved(456);

      expect(chromeMock.storage.local.set).not.toHaveBeenCalled();
    });
  });

  describe('storageChangeListener for tab rotation', () => {
    it('should recreate alarm when isEnabledTabRotation changes to true', async () => {
      chromeMock.alarms.get.mockResolvedValue(null);
      chromeMock.alarms.clear.mockResolvedValue(true);
      chromeMock.storage.local.get.mockResolvedValue({
        isEnabledTabRotation: true,
        tabRotationInterval: 3,
      });

      await onStorageChangedForTabRotation(
        { isEnabledTabRotation: { newValue: true } },
        'local'
      );

      expect(chromeMock.alarms.create).toHaveBeenCalledWith('tabRotationAlarm', {
        periodInMinutes: 3,
      });
    });

    it('should clear alarm when isEnabledTabRotation changes to false', async () => {
      chromeMock.alarms.get.mockResolvedValue({ name: 'tabRotationAlarm' });
      chromeMock.alarms.clear.mockResolvedValue(true);
      chromeMock.storage.local.get.mockResolvedValue({
        isEnabledTabRotation: false,
        tabRotationInterval: 3,
      });

      await onStorageChangedForTabRotation(
        { isEnabledTabRotation: { newValue: false } },
        'local'
      );

      expect(chromeMock.alarms.clear).toHaveBeenCalledWith('tabRotationAlarm');
      expect(chromeMock.alarms.create).not.toHaveBeenCalled();
    });

    it('should ignore changes from non-local storage area', async () => {
      await onStorageChangedForTabRotation(
        { isEnabledTabRotation: { newValue: true } },
        'sync'
      );

      expect(chromeMock.alarms.get).not.toHaveBeenCalled();
      expect(chromeMock.alarms.create).not.toHaveBeenCalled();
    });

    it('should recreate alarm when isDynamicRotation changes', async () => {
      chromeMock.alarms.get.mockResolvedValue({ name: 'tabRotationAlarm' });
      chromeMock.alarms.clear.mockResolvedValue(true);
      chromeMock.storage.local.get.mockResolvedValue({
        isEnabledTabRotation: true,
        tabRotationInterval: 10,
      });

      await onStorageChangedForTabRotation(
        { isDynamicRotation: { newValue: true } },
        'local'
      );

      expect(chromeMock.alarms.clear).toHaveBeenCalledWith('tabRotationAlarm');
      expect(chromeMock.alarms.create).toHaveBeenCalledWith('tabRotationAlarm', {
        periodInMinutes: 10,
      });
    });
  });

  describe('checkInterval feature', () => {
    it('should create periodicalUpdate alarm with default interval of 1 minute', async () => {
      chromeMock.alarms.get.mockResolvedValue(null);
      chromeMock.storage.local.get.mockResolvedValue({});

      await ensureAlarmsExist();

      expect(chromeMock.alarms.create).toHaveBeenCalledWith('periodicalUpdate', {
        periodInMinutes: 1,
      });
    });

    it('should create periodicalUpdate alarm with custom interval from storage', async () => {
      chromeMock.alarms.get.mockResolvedValue(null);
      chromeMock.storage.local.get.mockResolvedValue({
        checkInterval: 5,
      });

      await ensureAlarmsExist();

      expect(chromeMock.alarms.create).toHaveBeenCalledWith('periodicalUpdate', {
        periodInMinutes: 5,
      });
    });

    it('should enforce minimum interval of 1 minute', async () => {
      chromeMock.alarms.get.mockResolvedValue(null);
      chromeMock.storage.local.get.mockResolvedValue({
        checkInterval: 0,
      });

      await ensureAlarmsExist();

      expect(chromeMock.alarms.create).toHaveBeenCalledWith('periodicalUpdate', {
        periodInMinutes: 1,
      });
    });

    it('should enforce maximum interval of 60 minutes', async () => {
      chromeMock.alarms.get.mockResolvedValue(null);
      chromeMock.storage.local.get.mockResolvedValue({
        checkInterval: 120,
      });

      await ensureAlarmsExist();

      expect(chromeMock.alarms.create).toHaveBeenCalledWith('periodicalUpdate', {
        periodInMinutes: 60,
      });
    });

    it('should recreate alarm when checkInterval changes', async () => {
      chromeMock.alarms.get.mockResolvedValue({ name: 'periodicalUpdate' });
      chromeMock.alarms.clear.mockResolvedValue(true);

      await onStorageChangedForCheckInterval(
        { checkInterval: { newValue: 10 } },
        'local'
      );

      expect(chromeMock.alarms.clear).toHaveBeenCalledWith('periodicalUpdate');
      expect(chromeMock.alarms.create).toHaveBeenCalledWith('periodicalUpdate', {
        periodInMinutes: 10,
      });
    });

    it('should enforce minimum interval of 1 minute when interval changes', async () => {
      chromeMock.alarms.get.mockResolvedValue({ name: 'periodicalUpdate' });
      chromeMock.alarms.clear.mockResolvedValue(true);

      await onStorageChangedForCheckInterval(
        { checkInterval: { newValue: 0 } },
        'local'
      );

      expect(chromeMock.alarms.create).toHaveBeenCalledWith('periodicalUpdate', {
        periodInMinutes: 1,
      });
    });

    it('should enforce maximum interval of 60 minutes when interval changes', async () => {
      chromeMock.alarms.get.mockResolvedValue({ name: 'periodicalUpdate' });
      chromeMock.alarms.clear.mockResolvedValue(true);

      await onStorageChangedForCheckInterval(
        { checkInterval: { newValue: 120 } },
        'local'
      );

      expect(chromeMock.alarms.create).toHaveBeenCalledWith('periodicalUpdate', {
        periodInMinutes: 60,
      });
    });

    it('should ignore changes from non-local storage area', async () => {
      await onStorageChangedForCheckInterval(
        { checkInterval: { newValue: 5 } },
        'sync'
      );

      expect(chromeMock.alarms.get).not.toHaveBeenCalled();
      expect(chromeMock.alarms.create).not.toHaveBeenCalled();
    });
  });

  describe('Tab rotation recovery after window closure', () => {
    it('should recover tab rotation when window is reopened and channels go live', async () => {
      const managedWindowId = 123;

      // Step 1: Window is closed
      chromeMock.storage.local.get.mockResolvedValue({ lastOpenWindowId: managedWindowId });
      await onWindowRemoved(managedWindowId);
      expect(chromeMock.storage.local.set).toHaveBeenCalledWith({ lastOpenWindowId: null });

      // Step 2: checkTabRotate sees new window
      const newWindowId = 456;
      chromeMock.storage.local.get.mockResolvedValue({
        lastOpenWindowId: newWindowId,
        isEnabledTabRotation: true,
        isEnabledTabMute: false,
      });

      // checkTabRotate calls chrome.windows.get with callback
      // It should proceed since targetWindowId is set
      await checkTabRotate();

      // Verify it attempted to get the window
      expect(chromeMock.windows.get).toHaveBeenCalled();
    });

    it('should handle case where window is closed but tab rotation is still enabled', async () => {
      const managedWindowId = 123;

      // Window is closed
      chromeMock.storage.local.get.mockResolvedValueOnce({ lastOpenWindowId: managedWindowId });
      await onWindowRemoved(managedWindowId);

      // checkTabRotate should exit early since lastOpenWindowId is null
      chromeMock.storage.local.get
        .mockResolvedValueOnce({ isEnabledTabRotation: true })
        .mockResolvedValueOnce({ lastOpenWindowId: null });

      await checkTabRotate();

      // Should not try to get any window since targetWindowId is null
      expect(chromeMock.windows.get).not.toHaveBeenCalled();
    });
  });

  describe('showNotification', () => {
    it('should create notification with title and category', () => {
      showNotification({
        name: 'testuser',
        title: 'Playing some games!',
        game_name: 'Just Chatting',
      });

      expect(chromeMock.notifications.create).toHaveBeenCalledTimes(1);
      const [, options] = chromeMock.notifications.create.mock.calls[0];
      expect(options.message).toBe('Playing some games!\n【Just Chatting】');
    });

    it('should create notification with only title if no category', () => {
      showNotification({ name: 'testuser', title: 'My Stream' });
      const [, options] = chromeMock.notifications.create.mock.calls[0];
      expect(options.message).toBe('My Stream');
    });

    it('should create notification with only category if no title', () => {
      showNotification({ name: 'testuser', game_name: 'Fortnite' });
      const [, options] = chromeMock.notifications.create.mock.calls[0];
      expect(options.message).toBe('【Fortnite】');
    });

    it('should fallback to default message if no title and category', () => {
      showNotification({ name: 'testuser' });
      const [, options] = chromeMock.notifications.create.mock.calls[0];
      expect(options.message).toBe('配信開始！');
    });
  });

  describe('validateToken', () => {
    it('should return true when token is valid', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({ ok: true });
      const result = await validateToken('valid_token');
      expect(result).toBe(true);
      expect(globalThis.fetch).toHaveBeenCalledWith(
        'https://id.twitch.tv/oauth2/validate',
        { headers: { 'Authorization': 'OAuth valid_token' } }
      );
    });

    it('should return false when token is invalid', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({ ok: false });
      const result = await validateToken('invalid_token');
      expect(result).toBe(false);
    });

    it('should return false on network error', async () => {
      globalThis.fetch = vi.fn().mockRejectedValue(new Error('Network error'));
      const result = await validateToken('any_token');
      expect(result).toBe(false);
    });
  });

  describe('migrateOAuthToken', () => {
    it('should extract token from old nested format', () => {
      const result = migrateOAuthToken({ oauth_token: 'my_token' });
      expect(result).toBe('my_token');
    });

    it('should return string token as-is', () => {
      const result = migrateOAuthToken('my_token');
      expect(result).toBe('my_token');
    });

    it('should return null/undefined as-is', () => {
      expect(migrateOAuthToken(null)).toBeNull();
      expect(migrateOAuthToken(undefined)).toBeUndefined();
    });
  });

  describe('checkStreams token migration', () => {
    it('should migrate old nested token format and persist it', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ data: [] }),
      });

      chromeMock.storage.local.get.mockResolvedValue({
        isEnabled: true,
        isEnabledNotifications: false,
        isOpenMultiTwitch: false,
        channels: [{ name: 'testchannel', onLiveOpen: false }],
        oauth_token: { oauth_token: 'old_format_token' },
        isEnabledAutoClose: false,
      });

      await checkStreams();

      // Should persist migrated token
      const tokenSetCall = chromeMock.storage.local.set.mock.calls.find(
        call => typeof call[0].oauth_token === 'string'
      );
      expect(tokenSetCall).toBeDefined();
      expect(tokenSetCall[0].oauth_token).toBe('old_format_token');
    });
  });

  describe('Race condition fixes', () => {
    describe('openTabIfNotExists async/await', () => {
      it('should prevent duplicate tabs when opening multiple channels sequentially', async () => {
        const channels = [
          { name: 'channel1', onLive: true, onLiveOpen: true },
          { name: 'channel2', onLive: true, onLiveOpen: true },
          { name: 'channel3', onLive: true, onLiveOpen: true },
        ];

        // Mock: no existing tabs initially
        let existingTabs = [];
        chromeMock.tabs.query.mockImplementation(() => {
          return Promise.resolve([...existingTabs]);
        });

        // Mock tabs.create to add the created tab to the list
        chromeMock.tabs.create.mockImplementation(({ url, windowId }) => {
          const newTab = { url, windowId, id: existingTabs.length + 1 };
          existingTabs.push(newTab);
          return Promise.resolve(newTab);
        });

        chromeMock.storage.local.get.mockImplementation((keys) => {
          if (Array.isArray(keys) && keys.includes('allowedOnlyCategoryList')) {
            return Promise.resolve({
              allowedOnlyCategoryList: [],
              blockedCategoryList: [],
              blockedCategoryNames: '',
            });
          }
          return Promise.resolve({ isOpenNewWindow: false });
        });

        await channelQueuedStreams(channels);

        // With proper await, tabs.create should be called exactly 3 times
        // (once per channel, no duplicates)
        expect(chromeMock.tabs.create).toHaveBeenCalledTimes(3);
        expect(chromeMock.tabs.create).toHaveBeenCalledWith({
          url: 'https://www.twitch.tv/channel1',
          windowId: null,
        });
        expect(chromeMock.tabs.create).toHaveBeenCalledWith({
          url: 'https://www.twitch.tv/channel2',
          windowId: null,
        });
        expect(chromeMock.tabs.create).toHaveBeenCalledWith({
          url: 'https://www.twitch.tv/channel3',
          windowId: null,
        });
      });
    });

    describe('checkTabRotate async/await', () => {
      it('should rotate tabs correctly when window exists', async () => {
        const windowId = 123;
        const tabs = [
          { id: 1, url: 'https://www.twitch.tv/channel1', active: true },
          { id: 2, url: 'https://www.twitch.tv/channel2', active: false },
          { id: 3, url: 'https://www.twitch.tv/channel3', active: false },
        ];

        chromeMock.storage.local.get.mockImplementation((key) => {
          if (key === 'isEnabledTabRotation') {
            return Promise.resolve({ isEnabledTabRotation: true });
          }
          if (key === 'lastOpenWindowId') {
            return Promise.resolve({ lastOpenWindowId: windowId });
          }
          if (key === 'isEnabledTabMute') {
            return Promise.resolve({ isEnabledTabMute: false });
          }
          return Promise.resolve({});
        });

        chromeMock.windows.get.mockResolvedValue({ id: windowId });
        chromeMock.tabs.query.mockResolvedValue(tabs);

        await checkTabRotate();

        // Should rotate from tab 1 to tab 2
        expect(chromeMock.tabs.update).toHaveBeenCalledWith(1, { muted: false });
        expect(chromeMock.tabs.update).toHaveBeenCalledWith(2, { active: true, muted: false });
      });

      it('should clear lastOpenWindowId when window does not exist', async () => {
        const windowId = 123;

        chromeMock.storage.local.get.mockImplementation((key) => {
          if (key === 'isEnabledTabRotation') {
            return Promise.resolve({ isEnabledTabRotation: true });
          }
          if (key === 'lastOpenWindowId') {
            return Promise.resolve({ lastOpenWindowId: windowId });
          }
          return Promise.resolve({});
        });

        // Mock window.get to throw error (window not found)
        chromeMock.windows.get.mockRejectedValue(new Error('Window not found'));

        await checkTabRotate();

        // Should clear lastOpenWindowId
        expect(chromeMock.storage.local.set).toHaveBeenCalledWith({ lastOpenWindowId: null });
        // Should not try to query tabs
        expect(chromeMock.tabs.query).not.toHaveBeenCalled();
      });

      it('should recalculate alarm interval when dynamic rotation is enabled', async () => {
        const windowId = 123;
        const tabs = [
          { id: 1, url: 'https://www.twitch.tv/channel1', active: true },
          { id: 2, url: 'https://www.twitch.tv/channel2', active: false },
          { id: 3, url: 'https://www.twitch.tv/channel3', active: false },
          { id: 4, url: 'https://www.twitch.tv/channel4', active: false },
          { id: 5, url: 'https://www.twitch.tv/channel5', active: false },
        ];

        chromeMock.storage.local.get.mockImplementation((key) => {
          if (key === 'isEnabledTabRotation') {
            return Promise.resolve({ isEnabledTabRotation: true });
          }
          if (key === 'lastOpenWindowId') {
            return Promise.resolve({ lastOpenWindowId: windowId });
          }
          if (key === 'isEnabledTabMute') {
            return Promise.resolve({ isEnabledTabMute: false });
          }
          if (Array.isArray(key) && key.includes('isDynamicRotation')) {
            return Promise.resolve({ isDynamicRotation: true, tabRotationInterval: 10 });
          }
          return Promise.resolve({});
        });

        chromeMock.windows.get.mockResolvedValue({ id: windowId });
        chromeMock.tabs.query.mockResolvedValue(tabs);
        chromeMock.alarms.get.mockResolvedValue({ name: 'tabRotationAlarm', periodInMinutes: 10 });
        chromeMock.alarms.clear.mockResolvedValue(true);

        await checkTabRotate();

        // 10 min / 5 tabs = 2 min per tab
        expect(chromeMock.alarms.clear).toHaveBeenCalledWith('tabRotationAlarm');
        expect(chromeMock.alarms.create).toHaveBeenCalledWith('tabRotationAlarm', { periodInMinutes: 2 });
      });

      it('should not recalculate alarm when dynamic rotation is disabled', async () => {
        const windowId = 123;
        const tabs = [
          { id: 1, url: 'https://www.twitch.tv/channel1', active: true },
          { id: 2, url: 'https://www.twitch.tv/channel2', active: false },
        ];

        chromeMock.storage.local.get.mockImplementation((key) => {
          if (key === 'isEnabledTabRotation') {
            return Promise.resolve({ isEnabledTabRotation: true });
          }
          if (key === 'lastOpenWindowId') {
            return Promise.resolve({ lastOpenWindowId: windowId });
          }
          if (key === 'isEnabledTabMute') {
            return Promise.resolve({ isEnabledTabMute: false });
          }
          if (Array.isArray(key) && key.includes('isDynamicRotation')) {
            return Promise.resolve({ isDynamicRotation: false, tabRotationInterval: 10 });
          }
          return Promise.resolve({});
        });

        chromeMock.windows.get.mockResolvedValue({ id: windowId });
        chromeMock.tabs.query.mockResolvedValue(tabs);

        await checkTabRotate();

        // Should not recalculate alarm
        expect(chromeMock.alarms.create).not.toHaveBeenCalled();
      });

      it('should clamp dynamic rotation interval to minimum 1 minute', async () => {
        const windowId = 123;
        // 3 min / 10 tabs = 0.3 → clamped to 1 min
        const tabs = Array.from({ length: 10 }, (_, i) => ({
          id: i + 1,
          url: `https://www.twitch.tv/channel${i + 1}`,
          active: i === 0,
        }));

        chromeMock.storage.local.get.mockImplementation((key) => {
          if (key === 'isEnabledTabRotation') {
            return Promise.resolve({ isEnabledTabRotation: true });
          }
          if (key === 'lastOpenWindowId') {
            return Promise.resolve({ lastOpenWindowId: windowId });
          }
          if (key === 'isEnabledTabMute') {
            return Promise.resolve({ isEnabledTabMute: false });
          }
          if (Array.isArray(key) && key.includes('isDynamicRotation')) {
            return Promise.resolve({ isDynamicRotation: true, tabRotationInterval: 3 });
          }
          return Promise.resolve({});
        });

        chromeMock.windows.get.mockResolvedValue({ id: windowId });
        chromeMock.tabs.query.mockResolvedValue(tabs);
        chromeMock.alarms.get.mockResolvedValue({ name: 'tabRotationAlarm', periodInMinutes: 3 });
        chromeMock.alarms.clear.mockResolvedValue(true);

        await checkTabRotate();

        // Should clamp to 1 minute minimum
        expect(chromeMock.alarms.create).toHaveBeenCalledWith('tabRotationAlarm', { periodInMinutes: 1 });
      });

      it('should not recalculate when only 1 tab exists even if dynamic rotation is enabled', async () => {
        const windowId = 123;
        const tabs = [
          { id: 1, url: 'https://www.twitch.tv/channel1', active: true },
        ];

        chromeMock.storage.local.get.mockImplementation((key) => {
          if (key === 'isEnabledTabRotation') {
            return Promise.resolve({ isEnabledTabRotation: true });
          }
          if (key === 'lastOpenWindowId') {
            return Promise.resolve({ lastOpenWindowId: windowId });
          }
          if (key === 'isEnabledTabMute') {
            return Promise.resolve({ isEnabledTabMute: false });
          }
          return Promise.resolve({});
        });

        chromeMock.windows.get.mockResolvedValue({ id: windowId });
        chromeMock.tabs.query.mockResolvedValue(tabs);

        await checkTabRotate();

        // With only 1 tab, dynamic rotation block is skipped (tabs.length > 1 guard)
        expect(chromeMock.alarms.create).not.toHaveBeenCalled();
      });

      it('should not recreate alarm when interval is already correct', async () => {
        const windowId = 123;
        const tabs = [
          { id: 1, url: 'https://www.twitch.tv/channel1', active: true },
          { id: 2, url: 'https://www.twitch.tv/channel2', active: false },
        ];

        chromeMock.storage.local.get.mockImplementation((key) => {
          if (key === 'isEnabledTabRotation') {
            return Promise.resolve({ isEnabledTabRotation: true });
          }
          if (key === 'lastOpenWindowId') {
            return Promise.resolve({ lastOpenWindowId: windowId });
          }
          if (key === 'isEnabledTabMute') {
            return Promise.resolve({ isEnabledTabMute: false });
          }
          if (Array.isArray(key) && key.includes('isDynamicRotation')) {
            return Promise.resolve({ isDynamicRotation: true, tabRotationInterval: 10 });
          }
          return Promise.resolve({});
        });

        chromeMock.windows.get.mockResolvedValue({ id: windowId });
        chromeMock.tabs.query.mockResolvedValue(tabs);
        // 10 / 2 = 5, alarm is already 5 → no change needed
        chromeMock.alarms.get.mockResolvedValue({ name: 'tabRotationAlarm', periodInMinutes: 5 });

        await checkTabRotate();

        // Should not clear or recreate alarm
        expect(chromeMock.alarms.clear).not.toHaveBeenCalled();
        expect(chromeMock.alarms.create).not.toHaveBeenCalled();
      });

      it('should not rotate if no tabs exist', async () => {
        const windowId = 123;

        chromeMock.storage.local.get.mockImplementation((key) => {
          if (key === 'isEnabledTabRotation') {
            return Promise.resolve({ isEnabledTabRotation: true });
          }
          if (key === 'lastOpenWindowId') {
            return Promise.resolve({ lastOpenWindowId: windowId });
          }
          if (key === 'isEnabledTabMute') {
            return Promise.resolve({ isEnabledTabMute: false });
          }
          return Promise.resolve({});
        });

        chromeMock.windows.get.mockResolvedValue({ id: windowId });
        chromeMock.tabs.query.mockResolvedValue([]);

        await checkTabRotate();

        // Should not call tabs.update if no tabs
        expect(chromeMock.tabs.update).not.toHaveBeenCalled();
      });
    });
  });

  describe('Notification click handler', () => {
    it('should open channel with valid notification ID', async () => {
      chromeMock.storage.local.get.mockImplementation((key) => {
        if (key === 'lastOpenWindowId') {
          return Promise.resolve({ lastOpenWindowId: null });
        }
        if (key === 'isOpenNewWindow') {
          return Promise.resolve({ isOpenNewWindow: false });
        }
        return Promise.resolve({});
      });

      chromeMock.tabs.query.mockResolvedValue([]);
      chromeMock.tabs.create.mockResolvedValue({ id: 1 });

      await onNotificationClicked('miteruyo-live-valid_channel-1234567890');

      expect(chromeMock.tabs.create).toHaveBeenCalledWith({
        url: 'https://www.twitch.tv/valid_channel',
        windowId: undefined
      });
      expect(chromeMock.notifications.clear).toHaveBeenCalledWith('miteruyo-live-valid_channel-1234567890');
    });

    it('should handle channel names with hyphens', async () => {
      chromeMock.storage.local.get.mockImplementation((key) => {
        if (key === 'lastOpenWindowId') {
          return Promise.resolve({ lastOpenWindowId: null });
        }
        if (key === 'isOpenNewWindow') {
          return Promise.resolve({ isOpenNewWindow: false });
        }
        return Promise.resolve({});
      });

      chromeMock.tabs.query.mockResolvedValue([]);
      chromeMock.tabs.create.mockResolvedValue({ id: 1 });

      // Note: Twitch usernames cannot contain hyphens, but this tests the parsing logic
      await onNotificationClicked('miteruyo-live-valid_name-1234567890');

      expect(chromeMock.tabs.create).toHaveBeenCalledWith({
        url: 'https://www.twitch.tv/valid_name',
        windowId: undefined
      });
    });

    it('should reject invalid channel name with special characters', async () => {
      await onNotificationClicked('miteruyo-live-invalid!@#-1234567890');

      expect(chromeMock.tabs.create).not.toHaveBeenCalled();
      expect(chromeMock.notifications.clear).not.toHaveBeenCalled();
    });

    it('should reject channel name exceeding 25 characters', async () => {
      const longName = 'a'.repeat(26);
      await onNotificationClicked(`miteruyo-live-${longName}-1234567890`);

      expect(chromeMock.tabs.create).not.toHaveBeenCalled();
      expect(chromeMock.notifications.clear).not.toHaveBeenCalled();
    });

    it('should reject malformed notification ID without timestamp', async () => {
      await onNotificationClicked('miteruyo-live-channel_name');

      expect(chromeMock.tabs.create).not.toHaveBeenCalled();
      expect(chromeMock.notifications.clear).not.toHaveBeenCalled();
    });

    it('should reject notification ID without prefix', async () => {
      await onNotificationClicked('other-notification-12345');

      expect(chromeMock.tabs.create).not.toHaveBeenCalled();
      expect(chromeMock.notifications.clear).not.toHaveBeenCalled();
    });

    it('should handle errors gracefully', async () => {
      chromeMock.storage.local.get.mockRejectedValue(new Error('Storage error'));

      // Should not throw
      await expect(onNotificationClicked('miteruyo-live-valid_channel-1234567890')).rejects.toThrow('Storage error');

      expect(chromeMock.notifications.clear).not.toHaveBeenCalled();
    });
  });

  describe('openInManagedWindow', () => {
    it('should open tab in current window when isOpenNewWindow is false', async () => {
      chromeMock.storage.local.get.mockResolvedValue({
        isOpenNewWindow: false,
        lastOpenWindowId: null,
      });
      chromeMock.tabs.create.mockResolvedValue({ id: 1, windowId: 789 });

      await openInManagedWindow('testchannel');

      expect(chromeMock.tabs.create).toHaveBeenCalledWith({
        url: 'https://www.twitch.tv/testchannel',
      });
      expect(chromeMock.storage.local.set).toHaveBeenCalledWith({
        lastOpenWindowId: 789,
      });
      expect(chromeMock.windows.create).not.toHaveBeenCalled();
    });

    it('should create new window when isOpenNewWindow is true and no existing window', async () => {
      chromeMock.storage.local.get.mockResolvedValue({
        isOpenNewWindow: true,
        lastOpenWindowId: null,
      });
      chromeMock.windows.create.mockResolvedValue({ id: 42 });

      await openInManagedWindow('testchannel');

      expect(chromeMock.windows.create).toHaveBeenCalledWith({
        url: 'https://www.twitch.tv/testchannel',
      });
      expect(chromeMock.storage.local.set).toHaveBeenCalledWith({
        lastOpenWindowId: 42,
      });
      expect(chromeMock.tabs.create).not.toHaveBeenCalled();
    });

    it('should add tab to existing managed window when window exists', async () => {
      chromeMock.storage.local.get.mockResolvedValue({
        isOpenNewWindow: true,
        lastOpenWindowId: 123,
      });
      // checkWindowExists calls windows.get with { populate: false }
      chromeMock.windows.get.mockResolvedValue({ id: 123 });

      await openInManagedWindow('testchannel');

      expect(chromeMock.tabs.create).toHaveBeenCalledWith({
        url: 'https://www.twitch.tv/testchannel',
        windowId: 123,
      });
      expect(chromeMock.windows.create).not.toHaveBeenCalled();
    });

    it('should create new window when existing managed window is gone', async () => {
      chromeMock.storage.local.get.mockResolvedValue({
        isOpenNewWindow: true,
        lastOpenWindowId: 999,
      });
      // checkWindowExists: window no longer exists
      chromeMock.windows.get.mockRejectedValue(new Error('Window not found'));
      chromeMock.windows.create.mockResolvedValue({ id: 50 });

      await openInManagedWindow('testchannel');

      expect(chromeMock.windows.create).toHaveBeenCalledWith({
        url: 'https://www.twitch.tv/testchannel',
      });
      expect(chromeMock.storage.local.set).toHaveBeenCalledWith({
        lastOpenWindowId: 50,
      });
    });
  });

  describe('countTwitchChannelTabs', () => {
    it('should count only Twitch channel tabs', async () => {
      chromeMock.tabs.query.mockResolvedValue([
        { url: 'https://www.twitch.tv/channel1' },
        { url: 'https://www.twitch.tv/channel2' },
        { url: 'https://www.twitch.tv/directory' },
        { url: 'https://www.google.com' },
        { url: null },
      ]);

      const count = await countTwitchChannelTabs();
      expect(count).toBe(2);
    });

    it('should return 0 when no Twitch tabs exist', async () => {
      chromeMock.tabs.query.mockResolvedValue([
        { url: 'https://www.google.com' },
      ]);

      const count = await countTwitchChannelTabs();
      expect(count).toBe(0);
    });
  });

  describe('channelQueuedStreams max tab limit', () => {
    it('should stop opening tabs when max tab count is reached', async () => {
      const channels = [
        { name: 'channel1', onLive: true, onLiveOpen: true },
        { name: 'channel2', onLive: true, onLiveOpen: true },
        { name: 'channel3', onLive: true, onLiveOpen: true },
      ];

      // Start with 4 existing Twitch tabs, max is 5
      let existingTabs = [
        { url: 'https://www.twitch.tv/existing1', id: 101 },
        { url: 'https://www.twitch.tv/existing2', id: 102 },
        { url: 'https://www.twitch.tv/existing3', id: 103 },
        { url: 'https://www.twitch.tv/existing4', id: 104 },
      ];

      chromeMock.tabs.query.mockImplementation(() => Promise.resolve([...existingTabs]));
      chromeMock.tabs.create.mockImplementation(({ url }) => {
        const newTab = { url, id: existingTabs.length + 200 };
        existingTabs.push(newTab);
        return Promise.resolve(newTab);
      });

      chromeMock.storage.local.get.mockImplementation((keys) => {
        if (Array.isArray(keys) && keys.includes('isOpenNewWindow')) {
          return Promise.resolve({ isOpenNewWindow: false, isEnabledMaxTabs: true, maxTabCount: 5 });
        }
        if (Array.isArray(keys) && keys.includes('allowedOnlyCategoryList')) {
          return Promise.resolve({
            allowedOnlyCategoryList: [],
            blockedCategoryList: [],
            blockedCategoryNames: '',
          });
        }
        return Promise.resolve({});
      });

      await channelQueuedStreams(channels);

      // Only 1 tab should be opened (4 existing + 1 = 5 max)
      expect(chromeMock.tabs.create).toHaveBeenCalledTimes(1);
    });

    it('should count existing Twitch tabs once for the queue', async () => {
      const channels = [
        { name: 'channel1', onLive: false, onLiveOpen: true },
        { name: 'channel2', onLive: false, onLiveOpen: true },
        { name: 'channel3', onLive: false, onLiveOpen: true },
      ];

      chromeMock.tabs.query.mockResolvedValue([
        { url: 'https://www.twitch.tv/existing1', id: 101 },
      ]);

      chromeMock.storage.local.get.mockImplementation((keys) => {
        if (Array.isArray(keys) && keys.includes('isOpenNewWindow')) {
          return Promise.resolve({ isOpenNewWindow: false, isEnabledMaxTabs: true, maxTabCount: 5 });
        }
        if (Array.isArray(keys) && keys.includes('allowedOnlyCategoryList')) {
          return Promise.resolve({
            allowedOnlyCategoryList: [],
            blockedCategoryList: [],
            blockedCategoryNames: '',
          });
        }
        return Promise.resolve({});
      });

      await channelQueuedStreams(channels);

      expect(chromeMock.tabs.query).toHaveBeenCalledTimes(1);
      expect(chromeMock.tabs.create).not.toHaveBeenCalled();
    });

    it('should not limit tabs when isEnabledMaxTabs is false', async () => {
      const channels = [
        { name: 'channel1', onLive: true, onLiveOpen: true },
        { name: 'channel2', onLive: true, onLiveOpen: true },
      ];

      let existingTabs = [];
      chromeMock.tabs.query.mockImplementation(() => Promise.resolve([...existingTabs]));
      chromeMock.tabs.create.mockImplementation(({ url }) => {
        const newTab = { url, id: existingTabs.length + 1 };
        existingTabs.push(newTab);
        return Promise.resolve(newTab);
      });

      chromeMock.storage.local.get.mockImplementation((keys) => {
        if (Array.isArray(keys) && keys.includes('isOpenNewWindow')) {
          return Promise.resolve({ isOpenNewWindow: false, isEnabledMaxTabs: false, maxTabCount: 1 });
        }
        if (Array.isArray(keys) && keys.includes('allowedOnlyCategoryList')) {
          return Promise.resolve({
            allowedOnlyCategoryList: [],
            blockedCategoryList: [],
            blockedCategoryNames: '',
          });
        }
        return Promise.resolve({});
      });

      await channelQueuedStreams(channels);

      // Both tabs should open since limit is disabled
      expect(chromeMock.tabs.create).toHaveBeenCalledTimes(2);
    });

    it('should default to 5 when maxTabCount is not set', async () => {
      const channels = [
        { name: 'channel1', onLive: true, onLiveOpen: true },
      ];

      // Already at 5 tabs
      const existingTabs = [
        { url: 'https://www.twitch.tv/aaa01', id: 1 },
        { url: 'https://www.twitch.tv/aaa02', id: 2 },
        { url: 'https://www.twitch.tv/aaa03', id: 3 },
        { url: 'https://www.twitch.tv/aaa04', id: 4 },
        { url: 'https://www.twitch.tv/aaa05', id: 5 },
      ];

      chromeMock.tabs.query.mockResolvedValue(existingTabs);

      chromeMock.storage.local.get.mockImplementation((keys) => {
        if (Array.isArray(keys) && keys.includes('isOpenNewWindow')) {
          return Promise.resolve({ isOpenNewWindow: false, isEnabledMaxTabs: true, maxTabCount: undefined });
        }
        if (Array.isArray(keys) && keys.includes('allowedOnlyCategoryList')) {
          return Promise.resolve({
            allowedOnlyCategoryList: [],
            blockedCategoryList: [],
            blockedCategoryNames: '',
          });
        }
        return Promise.resolve({});
      });

      await channelQueuedStreams(channels);

      // No tabs should open (already at default max of 5)
      expect(chromeMock.tabs.create).not.toHaveBeenCalled();
    });
  });

  describe('closeUnwantedTabs (via checkStreams)', () => {
    it('should close tabs when stream category changes to blocked category', async () => {
      // Channel is online but playing a blocked category
      const mockStreamData = {
        data: [{
          game_name: 'Just Chatting',
          game_id: '509658',
          title: 'Stream Title',
          viewer_count: 100,
          tags: [],
          user_id: '12345',
        }],
      };
      const mockChannelData = {
        data: [{ is_branded_content: false }],
      };

      globalThis.fetch = vi.fn()
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve(mockStreamData),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve(mockChannelData),
        });

      // Setup: channel is online, auto-close enabled, "Just Chatting" is blocked
      chromeMock.storage.local.get.mockImplementation((keys) => {
        if (typeof keys === 'string') {
          if (keys === 'isEnabledAutoClose') return Promise.resolve({ isEnabledAutoClose: true });
          if (keys === 'isSkipBrandedContent') return Promise.resolve({ isSkipBrandedContent: false });
          if (keys === 'lastOpenWindowId') return Promise.resolve({ lastOpenWindowId: 100 });
          return Promise.resolve({});
        }
        if (Array.isArray(keys)) {
          if (keys.includes('isEnabled')) {
            return Promise.resolve({
              isEnabled: true,
              isEnabledNotifications: false,
              isOpenMultiTwitch: false,
              channels: [{ name: 'testchannel', onLive: true, onLiveOpen: true }],
              oauth_token: 'test_token',
            });
          }
          if (keys.includes('allowedOnlyCategoryList')) {
            return Promise.resolve({
              allowedOnlyCategoryList: [],
              blockedCategoryList: [{ id: '509658', name: 'Just Chatting' }],
              blockedCategoryNames: '',
            });
          }
          if (keys.includes('isOpenNewWindow')) {
            return Promise.resolve({ isOpenNewWindow: false, isEnabledMaxTabs: false });
          }
        }
        return Promise.resolve({});
      });

      // Tab exists in managed window for this channel
      chromeMock.tabs.query.mockResolvedValue([
        { id: 1, url: 'https://www.twitch.tv/testchannel', windowId: 100 },
      ]);

      await checkStreams();

      // Tab should be closed because category is blocked
      expect(chromeMock.tabs.remove).toHaveBeenCalledWith(1);
    });

    it('should NOT close tabs when stream category is not blocked', async () => {
      const mockStreamData = {
        data: [{
          game_name: 'Valorant',
          game_id: '516575',
          title: 'Stream Title',
          viewer_count: 100,
          tags: [],
          user_id: '12345',
        }],
      };
      const mockChannelData = {
        data: [{ is_branded_content: false }],
      };

      globalThis.fetch = vi.fn()
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve(mockStreamData),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve(mockChannelData),
        });

      chromeMock.storage.local.get.mockImplementation((keys) => {
        if (typeof keys === 'string') {
          if (keys === 'isEnabledAutoClose') return Promise.resolve({ isEnabledAutoClose: true });
          if (keys === 'isSkipBrandedContent') return Promise.resolve({ isSkipBrandedContent: false });
          if (keys === 'lastOpenWindowId') return Promise.resolve({ lastOpenWindowId: 100 });
          return Promise.resolve({});
        }
        if (Array.isArray(keys)) {
          if (keys.includes('isEnabled')) {
            return Promise.resolve({
              isEnabled: true,
              isEnabledNotifications: false,
              isOpenMultiTwitch: false,
              channels: [{ name: 'testchannel', onLive: true, onLiveOpen: true }],
              oauth_token: 'test_token',
            });
          }
          if (keys.includes('allowedOnlyCategoryList')) {
            return Promise.resolve({
              allowedOnlyCategoryList: [],
              blockedCategoryList: [{ id: '509658', name: 'Just Chatting' }],
              blockedCategoryNames: '',
            });
          }
          if (keys.includes('isOpenNewWindow')) {
            return Promise.resolve({ isOpenNewWindow: false, isEnabledMaxTabs: false });
          }
        }
        return Promise.resolve({});
      });

      chromeMock.tabs.query.mockResolvedValue([
        { id: 1, url: 'https://www.twitch.tv/testchannel', windowId: 100 },
      ]);

      await checkStreams();

      // Tab should NOT be closed - Valorant is not in blocked list
      expect(chromeMock.tabs.remove).not.toHaveBeenCalled();
    });

    it('should close tabs when stream becomes branded content and skip is enabled', async () => {
      const mockStreamData = {
        data: [{
          game_name: 'Valorant',
          game_id: '516575',
          title: 'Sponsored Stream',
          viewer_count: 100,
          tags: [],
          user_id: '12345',
        }],
      };
      const mockChannelData = {
        data: [{ is_branded_content: true }],
      };

      globalThis.fetch = vi.fn()
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve(mockStreamData),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve(mockChannelData),
        });

      chromeMock.storage.local.get.mockImplementation((keys) => {
        if (typeof keys === 'string') {
          if (keys === 'isEnabledAutoClose') return Promise.resolve({ isEnabledAutoClose: true });
          if (keys === 'isSkipBrandedContent') return Promise.resolve({ isSkipBrandedContent: true });
          if (keys === 'lastOpenWindowId') return Promise.resolve({ lastOpenWindowId: 100 });
          return Promise.resolve({});
        }
        if (Array.isArray(keys)) {
          if (keys.includes('isEnabled')) {
            return Promise.resolve({
              isEnabled: true,
              isEnabledNotifications: false,
              isOpenMultiTwitch: false,
              channels: [{ name: 'testchannel', onLive: true, onLiveOpen: true }],
              oauth_token: 'test_token',
            });
          }
          if (keys.includes('allowedOnlyCategoryList')) {
            return Promise.resolve({
              allowedOnlyCategoryList: [],
              blockedCategoryList: [],
              blockedCategoryNames: '',
            });
          }
          if (keys.includes('isOpenNewWindow')) {
            return Promise.resolve({ isOpenNewWindow: false, isEnabledMaxTabs: false });
          }
        }
        return Promise.resolve({});
      });

      chromeMock.tabs.query.mockResolvedValue([
        { id: 1, url: 'https://www.twitch.tv/testchannel', windowId: 100 },
      ]);

      await checkStreams();

      // Tab should be closed - branded content with skip enabled
      expect(chromeMock.tabs.remove).toHaveBeenCalledWith(1);
    });

    it('should NOT close tabs when isAutoOpenOnce is enabled and hasBeenOpened is true', async () => {
      // This is the CRITICAL bug scenario: closeUnwantedTabs must NOT close tabs
      // just because hasBeenOpened is true (auto-open-once prevents RE-OPENING, not KEEPING)
      const mockStreamData = {
        data: [{
          game_name: 'Valorant',
          game_id: '516575',
          title: 'Stream Title',
          viewer_count: 100,
          tags: [],
          user_id: '12345',
        }],
      };
      const mockChannelData = {
        data: [{ is_branded_content: false }],
      };

      globalThis.fetch = vi.fn()
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve(mockStreamData),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve(mockChannelData),
        });

      chromeMock.storage.local.get.mockImplementation((keys) => {
        if (typeof keys === 'string') {
          if (keys === 'isEnabledAutoClose') return Promise.resolve({ isEnabledAutoClose: true });
          if (keys === 'isSkipBrandedContent') return Promise.resolve({ isSkipBrandedContent: false });
          if (keys === 'isAutoOpenOnce') return Promise.resolve({ isAutoOpenOnce: true });
          if (keys === 'lastOpenWindowId') return Promise.resolve({ lastOpenWindowId: 100 });
          return Promise.resolve({});
        }
        if (Array.isArray(keys)) {
          if (keys.includes('isEnabled')) {
            return Promise.resolve({
              isEnabled: true,
              isEnabledNotifications: false,
              isOpenMultiTwitch: false,
              channels: [{ name: 'testchannel', onLive: true, onLiveOpen: true, hasBeenOpened: true }],
              oauth_token: 'test_token',
            });
          }
          if (keys.includes('allowedOnlyCategoryList')) {
            return Promise.resolve({
              allowedOnlyCategoryList: [],
              blockedCategoryList: [],
              blockedCategoryNames: '',
            });
          }
          if (keys.includes('isOpenNewWindow')) {
            return Promise.resolve({ isOpenNewWindow: false, isEnabledMaxTabs: false });
          }
        }
        return Promise.resolve({});
      });

      chromeMock.tabs.query.mockResolvedValue([
        { id: 1, url: 'https://www.twitch.tv/testchannel', windowId: 100 },
      ]);

      await checkStreams();

      // Tab should NOT be closed - hasBeenOpened only prevents re-opening, not keeping
      expect(chromeMock.tabs.remove).not.toHaveBeenCalled();
    });

    it('should still close offline channel tabs', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ data: [] }),
      });

      chromeMock.storage.local.get.mockImplementation((keys) => {
        if (typeof keys === 'string') {
          if (keys === 'isEnabledAutoClose') return Promise.resolve({ isEnabledAutoClose: true });
          if (keys === 'lastOpenWindowId') return Promise.resolve({ lastOpenWindowId: 100 });
          return Promise.resolve({});
        }
        if (Array.isArray(keys)) {
          if (keys.includes('isEnabled')) {
            return Promise.resolve({
              isEnabled: true,
              isEnabledNotifications: false,
              isOpenMultiTwitch: false,
              channels: [{ name: 'testchannel', onLive: true, onLiveOpen: true }],
              oauth_token: 'test_token',
            });
          }
          if (keys.includes('isOpenNewWindow')) {
            return Promise.resolve({ isOpenNewWindow: false, isEnabledMaxTabs: false });
          }
        }
        return Promise.resolve({});
      });

      chromeMock.tabs.query.mockResolvedValue([
        { id: 1, url: 'https://www.twitch.tv/testchannel', windowId: 100 },
      ]);

      await checkStreams();

      // Tab should be closed - channel went offline
      expect(chromeMock.tabs.remove).toHaveBeenCalledWith(1);
    });
  });

  describe('Priority channels', () => {
    describe('channelQueuedStreams priority ordering', () => {
      it('should open priority channels before non-priority channels', async () => {
        const channels = [
          { name: 'nonpriority1', onLive: true, onLiveOpen: true, isPriority: false },
          { name: 'priority1', onLive: true, onLiveOpen: true, isPriority: true },
          { name: 'nonpriority2', onLive: true, onLiveOpen: true, isPriority: false },
        ];

        const openedOrder = [];
        let existingTabs = [];
        chromeMock.tabs.query.mockImplementation(() => Promise.resolve([...existingTabs]));
        chromeMock.tabs.create.mockImplementation(({ url }) => {
          openedOrder.push(url);
          const newTab = { url, id: existingTabs.length + 1 };
          existingTabs.push(newTab);
          return Promise.resolve(newTab);
        });

        chromeMock.storage.local.get.mockImplementation((keys) => {
          if (Array.isArray(keys) && keys.includes('isOpenNewWindow')) {
            return Promise.resolve({ isOpenNewWindow: false, isEnabledMaxTabs: false });
          }
          if (Array.isArray(keys) && keys.includes('allowedOnlyCategoryList')) {
            return Promise.resolve({
              allowedOnlyCategoryList: [],
              blockedCategoryList: [],
              blockedCategoryNames: '',
            });
          }
          return Promise.resolve({});
        });

        await channelQueuedStreams(channels);

        // Priority channel should be opened first
        expect(openedOrder[0]).toBe('https://www.twitch.tv/priority1');
        expect(openedOrder).toHaveLength(3);
      });

      it('should give priority channels tab slots first under maxTabs', async () => {
        const channels = [
          { name: 'nonpriority1', onLive: true, onLiveOpen: true, isPriority: false },
          { name: 'priority1', onLive: true, onLiveOpen: true, isPriority: true },
          { name: 'priority2', onLive: true, onLiveOpen: true, isPriority: true },
          { name: 'nonpriority2', onLive: true, onLiveOpen: true, isPriority: false },
        ];

        const openedOrder = [];
        let existingTabs = [];
        chromeMock.tabs.query.mockImplementation(() => Promise.resolve([...existingTabs]));
        chromeMock.tabs.create.mockImplementation(({ url }) => {
          openedOrder.push(url);
          const newTab = { url, id: existingTabs.length + 1 };
          existingTabs.push(newTab);
          return Promise.resolve(newTab);
        });

        chromeMock.storage.local.get.mockImplementation((keys) => {
          if (Array.isArray(keys) && keys.includes('isOpenNewWindow')) {
            return Promise.resolve({ isOpenNewWindow: false, isEnabledMaxTabs: true, maxTabCount: 3 });
          }
          if (Array.isArray(keys) && keys.includes('allowedOnlyCategoryList')) {
            return Promise.resolve({
              allowedOnlyCategoryList: [],
              blockedCategoryList: [],
              blockedCategoryNames: '',
            });
          }
          return Promise.resolve({});
        });

        await channelQueuedStreams(channels);

        // Only 3 tabs should open (maxTabCount=3)
        expect(openedOrder).toHaveLength(3);
        // Priority channels should be first two
        expect(openedOrder[0]).toBe('https://www.twitch.tv/priority1');
        expect(openedOrder[1]).toBe('https://www.twitch.tv/priority2');
      });
    });

    describe('displaceNonPriorityTabs', () => {
      it('should close non-priority tabs to make room for priority channels', async () => {
        const channels = [
          { name: 'priority1', onLive: true, onLiveOpen: true, isPriority: true },
          { name: 'nonpriority1', onLive: true, onLiveOpen: true, isPriority: false },
          { name: 'nonpriority2', onLive: true, onLiveOpen: true, isPriority: false },
        ];

        chromeMock.storage.local.get.mockImplementation((keys) => {
          if (Array.isArray(keys) && keys.includes('isEnabledMaxTabs')) {
            return Promise.resolve({ isEnabledMaxTabs: true, maxTabCount: 2, lastOpenWindowId: null });
          }
          if (Array.isArray(keys) && keys.includes('allowedOnlyCategoryList')) {
            return Promise.resolve({
              allowedOnlyCategoryList: [],
              blockedCategoryList: [],
              blockedCategoryNames: '',
            });
          }
          return Promise.resolve({});
        });

        // 2 non-priority tabs already open (at max)
        chromeMock.tabs.query.mockResolvedValue([
          { id: 1, url: 'https://www.twitch.tv/nonpriority1' },
          { id: 2, url: 'https://www.twitch.tv/nonpriority2' },
        ]);
        chromeMock.tabs.remove.mockResolvedValue();

        await displaceNonPriorityTabs(channels);

        // Should close 1 non-priority tab to make room for priority1
        expect(chromeMock.tabs.remove).toHaveBeenCalledTimes(1);
        expect(chromeMock.tabs.remove).toHaveBeenCalledWith(1);
      });

      it('should do nothing when maxTabs is disabled', async () => {
        const channels = [
          { name: 'priority1', onLive: true, onLiveOpen: true, isPriority: true },
        ];

        chromeMock.storage.local.get.mockResolvedValue({
          isEnabledMaxTabs: false, maxTabCount: 2, lastOpenWindowId: null,
        });

        await displaceNonPriorityTabs(channels);

        expect(chromeMock.tabs.query).not.toHaveBeenCalled();
        expect(chromeMock.tabs.remove).not.toHaveBeenCalled();
      });

      it('should do nothing when there are free slots', async () => {
        const channels = [
          { name: 'priority1', onLive: true, onLiveOpen: true, isPriority: true },
          { name: 'nonpriority1', onLive: true, onLiveOpen: true, isPriority: false },
        ];

        chromeMock.storage.local.get.mockResolvedValue({
          isEnabledMaxTabs: true, maxTabCount: 3, lastOpenWindowId: null,
        });

        // Only 1 tab open, max is 3 -> free slots available
        chromeMock.tabs.query.mockResolvedValue([
          { id: 1, url: 'https://www.twitch.tv/nonpriority1' },
        ]);

        await displaceNonPriorityTabs(channels);

        // Should not close any tabs
        expect(chromeMock.tabs.remove).not.toHaveBeenCalled();
      });

      it('should not close priority tabs', async () => {
        const channels = [
          { name: 'priority1', onLive: true, onLiveOpen: true, isPriority: true },
          { name: 'priority2', onLive: true, onLiveOpen: true, isPriority: true },
        ];

        chromeMock.storage.local.get.mockImplementation((keys) => {
          if (Array.isArray(keys) && keys.includes('isEnabledMaxTabs')) {
            return Promise.resolve({ isEnabledMaxTabs: true, maxTabCount: 2, lastOpenWindowId: null });
          }
          if (Array.isArray(keys) && keys.includes('allowedOnlyCategoryList')) {
            return Promise.resolve({
              allowedOnlyCategoryList: [],
              blockedCategoryList: [],
              blockedCategoryNames: '',
            });
          }
          return Promise.resolve({});
        });

        // Both tabs are priority - none should be closed
        chromeMock.tabs.query.mockResolvedValue([
          { id: 1, url: 'https://www.twitch.tv/priority1' },
          { id: 2, url: 'https://www.twitch.tv/priority2' },
        ]);

        await displaceNonPriorityTabs(channels);

        expect(chromeMock.tabs.remove).not.toHaveBeenCalled();
      });

      it('should handle gracefully when managed window is gone', async () => {
        const channels = [
          { name: 'priority1', onLive: true, onLiveOpen: true, isPriority: true },
        ];

        chromeMock.storage.local.get.mockResolvedValue({
          isEnabledMaxTabs: true, maxTabCount: 2, lastOpenWindowId: 999,
        });

        // Window query throws because window no longer exists
        chromeMock.tabs.query.mockRejectedValue(new Error('Window not found'));

        await displaceNonPriorityTabs(channels);

        // Should not crash, should not try to remove tabs
        expect(chromeMock.tabs.remove).not.toHaveBeenCalled();
      });

      it('should not close tabs when priority channel already has a tab', async () => {
        const channels = [
          { name: 'priority1', onLive: true, onLiveOpen: true, isPriority: true },
          { name: 'nonpriority1', onLive: true, onLiveOpen: true, isPriority: false },
        ];

        chromeMock.storage.local.get.mockImplementation((keys) => {
          if (Array.isArray(keys) && keys.includes('isEnabledMaxTabs')) {
            return Promise.resolve({ isEnabledMaxTabs: true, maxTabCount: 2, lastOpenWindowId: null });
          }
          return Promise.resolve({});
        });

        // Priority channel already has a tab open
        chromeMock.tabs.query.mockResolvedValue([
          { id: 1, url: 'https://www.twitch.tv/priority1' },
          { id: 2, url: 'https://www.twitch.tv/nonpriority1' },
        ]);

        await displaceNonPriorityTabs(channels);

        // No displacement needed - priority channel already open
        expect(chromeMock.tabs.remove).not.toHaveBeenCalled();
      });
    });
  });

  describe('checkOfflineWithTab', () => {
    it('should return true when channel is offline', async () => {
      chromeMock.tabs.get.mockResolvedValue({
        url: 'https://www.twitch.tv/testuser',
      });
      chromeMock.storage.local.get.mockImplementation((key) => {
        if (key === 'oauth_token') {
          return Promise.resolve({ oauth_token: 'valid_token' });
        }
        return Promise.resolve({});
      });

      // 1st fetch: getUserId, 2nd fetch: streams (offline)
      globalThis.fetch = vi.fn()
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ data: [{ id: '12345' }] }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ data: [] }),
        });

      const result = await checkOfflineWithTab(1);
      expect(result).toBe(true);
    });

    it('should return false when channel is online', async () => {
      chromeMock.tabs.get.mockResolvedValue({
        url: 'https://www.twitch.tv/testuser',
      });
      chromeMock.storage.local.get.mockImplementation((key) => {
        if (key === 'oauth_token') {
          return Promise.resolve({ oauth_token: 'valid_token' });
        }
        return Promise.resolve({});
      });

      // 1st fetch: getUserId, 2nd fetch: streams (online)
      globalThis.fetch = vi.fn()
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ data: [{ id: '12345' }] }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ data: [{ type: 'live' }] }),
        });

      const result = await checkOfflineWithTab(1);
      expect(result).toBe(false);
    });

    it('should return false for non-channel pages', async () => {
      chromeMock.tabs.get.mockResolvedValue({
        url: 'https://www.twitch.tv/directory',
      });
      globalThis.fetch = vi.fn();

      const result = await checkOfflineWithTab(1);

      expect(result).toBe(false);
      // Should not attempt any API calls
      expect(globalThis.fetch).not.toHaveBeenCalled();
    });
  });
});
