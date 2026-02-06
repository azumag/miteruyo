import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createChromeMock } from './setup.js';
import {
  ensureAlarmsExist,
  shouldOpenChannel,
  onWindowRemoved,
  onStorageChangedForTabRotation,
  isTwitchChannelPage,
  showNotification,
  checkTabRotate,
  checkStreams,
  validateToken,
  migrateOAuthToken,
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
});
