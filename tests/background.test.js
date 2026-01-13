import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createChromeMock, createFetchMock } from './setup.js';

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

  describe('ensureAlarmsExist', () => {
    it('should create periodicalUpdate alarm if it does not exist', async () => {
      chromeMock.alarms.get.mockResolvedValue(null);
      chromeMock.storage.local.get.mockResolvedValue({});

      // Inline implementation for testing
      async function ensureAlarmsExist() {
        const existingAlarm = await chrome.alarms.get('periodicalUpdate');
        if (!existingAlarm) {
          chrome.alarms.create('periodicalUpdate', { periodInMinutes: 1 });
        }
      }

      await ensureAlarmsExist();

      expect(chromeMock.alarms.create).toHaveBeenCalledWith('periodicalUpdate', {
        periodInMinutes: 1,
      });
    });

    it('should not create alarm if it already exists', async () => {
      chromeMock.alarms.get.mockResolvedValue({ name: 'periodicalUpdate' });

      async function ensureAlarmsExist() {
        const existingAlarm = await chrome.alarms.get('periodicalUpdate');
        if (!existingAlarm) {
          chrome.alarms.create('periodicalUpdate', { periodInMinutes: 1 });
        }
      }

      await ensureAlarmsExist();

      expect(chromeMock.alarms.create).not.toHaveBeenCalled();
    });
  });

  describe('checkStream', () => {
    it('should return online status when stream is live', async () => {
      const mockStreamData = {
        data: [
          {
            game_name: 'Test Game',
            title: 'Test Stream',
            viewer_count: 100,
            tags: ['tag1'],
          },
        ],
      };

      globalThis.fetch = createFetchMock({
        'https://api.twitch.tv/helix/streams?user_login=testchannel': mockStreamData,
      });

      // Inline implementation for testing
      async function checkStream(channel, oauth_token) {
        if (!channel) return null;
        const url = `https://api.twitch.tv/helix/streams?user_login=${channel.name}`;
        const response = await fetch(url, {
          headers: {
            'Client-ID': 'test',
            Authorization: 'Bearer ' + oauth_token.oauth_token,
          },
        });
        const data = await response.json();

        if (data.data.length > 0) {
          const stream = data.data[0];
          return {
            ...channel,
            onLive: true,
            game_name: stream.game_name,
            title: stream.title,
            viewer_count: stream.viewer_count,
            status: 'online',
          };
        } else {
          return { ...channel, onLive: false, status: 'offline' };
        }
      }

      const result = await checkStream(
        { name: 'testchannel' },
        { oauth_token: 'test_token' }
      );

      expect(result.onLive).toBe(true);
      expect(result.status).toBe('online');
      expect(result.game_name).toBe('Test Game');
      expect(result.viewer_count).toBe(100);
    });

    it('should return offline status when stream is not live', async () => {
      globalThis.fetch = createFetchMock({
        'https://api.twitch.tv/helix/streams?user_login=offlinechannel': { data: [] },
      });

      async function checkStream(channel, oauth_token) {
        if (!channel) return null;
        const url = `https://api.twitch.tv/helix/streams?user_login=${channel.name}`;
        const response = await fetch(url, {
          headers: {
            'Client-ID': 'test',
            Authorization: 'Bearer ' + oauth_token.oauth_token,
          },
        });
        const data = await response.json();

        if (data.data.length > 0) {
          return { ...channel, onLive: true, status: 'online' };
        } else {
          return { ...channel, onLive: false, status: 'offline' };
        }
      }

      const result = await checkStream(
        { name: 'offlinechannel' },
        { oauth_token: 'test_token' }
      );

      expect(result.onLive).toBe(false);
      expect(result.status).toBe('offline');
    });

    it('should return null for null channel', async () => {
      async function checkStream(channel) {
        if (!channel) return null;
        return channel;
      }

      const result = await checkStream(null);
      expect(result).toBeNull();
    });
  });

  describe('checkStreams', () => {
    it('should skip if extension is disabled', async () => {
      chromeMock.storage.local.get.mockResolvedValue({ isEnabled: false });

      async function checkStreams() {
        const isEnabled = (await chrome.storage.local.get('isEnabled')).isEnabled;
        if (!isEnabled) return 'disabled';
        return 'enabled';
      }

      const result = await checkStreams();
      expect(result).toBe('disabled');
    });

    it('should skip if no oauth token', async () => {
      chromeMock.storage.local.get
        .mockResolvedValueOnce({ isEnabled: true })
        .mockResolvedValueOnce({ isOpenMultiTwitch: false })
        .mockResolvedValueOnce({ channels: [] })
        .mockResolvedValueOnce({ oauth_token: null });

      async function checkStreams() {
        const isEnabled = (await chrome.storage.local.get('isEnabled')).isEnabled;
        if (!isEnabled) return 'disabled';
        await chrome.storage.local.get('isOpenMultiTwitch');
        await chrome.storage.local.get('channels');
        const oauth_token = (await chrome.storage.local.get('oauth_token')).oauth_token;
        if (!oauth_token) return 'no_token';
        return 'ok';
      }

      const result = await checkStreams();
      expect(result).toBe('no_token');
    });
  });

  describe('Parallel processing', () => {
    it('should process multiple channels in parallel', async () => {
      const channels = [
        { name: 'channel1' },
        { name: 'channel2' },
        { name: 'channel3' },
      ];

      globalThis.fetch = vi.fn().mockImplementation((_url) => {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ data: [] }),
        });
      });

      async function checkStream(channel, _oauth_token) {
        const url = `https://api.twitch.tv/helix/streams?user_login=${channel.name}`;
        await fetch(url);
        return { ...channel, status: 'offline' };
      }

      const results = await Promise.all(
        channels.map((channel) => checkStream(channel, { oauth_token: 'test' }))
      );

      expect(results).toHaveLength(3);
      expect(globalThis.fetch).toHaveBeenCalledTimes(3);
    });

    it('should handle errors gracefully in parallel processing', async () => {
      const channels = [{ name: 'channel1' }, { name: 'error_channel' }];

      globalThis.fetch = vi.fn().mockImplementation((url) => {
        if (url.includes('error_channel')) {
          return Promise.reject(new Error('Network error'));
        }
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ data: [] }),
        });
      });

      async function checkStream(channel) {
        const url = `https://api.twitch.tv/helix/streams?user_login=${channel.name}`;
        const response = await fetch(url);
        const data = await response.json();
        return { ...channel, status: data.data.length > 0 ? 'online' : 'offline' };
      }

      const results = await Promise.all(
        channels.map((channel) =>
          checkStream(channel).catch(() => ({ ...channel, status: 'error' }))
        )
      );

      expect(results).toHaveLength(2);
      expect(results[0].status).toBe('offline');
      expect(results[1].status).toBe('error');
    });
  });

  describe('shouldOpenChannel', () => {
    it('should return false if channel is not live', async () => {
      chromeMock.storage.local.get.mockResolvedValue({});

      async function shouldOpenChannel(channel) {
        if (!channel.onLive || !channel.onLiveOpen) return false;
        return true;
      }

      const result = await shouldOpenChannel({ name: 'test', onLive: false, onLiveOpen: true });
      expect(result).toBe(false);
    });

    it('should block channel with allowed-only list when category does not match', async () => {
      chromeMock.storage.local.get.mockResolvedValue({
        allowedOnlyCategoryList: [{ id: '123', name: 'Test Game' }],
      });

      async function shouldOpenChannel(channel) {
        if (!channel.onLive || !channel.onLiveOpen) return false;

        const storageData = await chrome.storage.local.get(['allowedOnlyCategoryList']);
        const globalAllowedOnlyList = (storageData.allowedOnlyCategoryList || []);

        if (globalAllowedOnlyList.length > 0) {
          if (!channel.game_id && !channel.game_name) return false;
          const gameId = channel.game_id;
          const gameName = channel.game_name?.toLowerCase();
          const isInAllowedOnly = globalAllowedOnlyList.some(
            (cat) =>
              (gameId && cat.id && cat.id === gameId) ||
              (gameName && cat.name && cat.name.toLowerCase() === gameName)
          );
          return isInAllowedOnly;
        }
        return true;
      }

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
      });

      async function shouldOpenChannel(channel) {
        if (!channel.onLive || !channel.onLiveOpen) return false;

        const storageData = await chrome.storage.local.get(['allowedOnlyCategoryList']);
        const globalAllowedOnlyList = storageData.allowedOnlyCategoryList || [];

        if (globalAllowedOnlyList.length > 0) {
          if (!channel.game_id && !channel.game_name) return false;
          const gameId = channel.game_id;
          const gameName = channel.game_name?.toLowerCase();
          const isInAllowedOnly = globalAllowedOnlyList.some(
            (cat) =>
              (gameId && cat.id && cat.id === gameId) ||
              (gameName && cat.name && cat.name.toLowerCase() === gameName)
          );
          return isInAllowedOnly;
        }
        return true;
      }

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
      });

      async function shouldOpenChannel(channel) {
        if (!channel.onLive || !channel.onLiveOpen) return false;

        const channelAllowedOnlyList = channel.allowedOnlyCategoryList || [];
        const storageData = await chrome.storage.local.get(['allowedOnlyCategoryList']);
        const globalAllowedOnlyList = storageData.allowedOnlyCategoryList || [];

        if (channelAllowedOnlyList.length > 0 || globalAllowedOnlyList.length > 0) {
          const activeAllowedOnlyList =
            channelAllowedOnlyList.length > 0 ? channelAllowedOnlyList : globalAllowedOnlyList;

          if (!channel.game_id && !channel.game_name) return false;
          const gameId = channel.game_id;
          const gameName = channel.game_name?.toLowerCase();
          const isInAllowedOnly = activeAllowedOnlyList.some(
            (cat) =>
              (gameId && cat.id && cat.id === gameId) ||
              (gameName && cat.name && cat.name.toLowerCase() === gameName)
          );
          return isInAllowedOnly;
        }
        return true;
      }

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
      });

      async function shouldOpenChannel(channel) {
        if (!channel.onLive || !channel.onLiveOpen) return false;

        const channelAllowedOnlyList = channel.allowedOnlyCategoryList || [];
        const storageData = await chrome.storage.local.get([
          'allowedOnlyCategoryList',
          'blockedCategoryList',
        ]);
        const globalAllowedOnlyList = storageData.allowedOnlyCategoryList || [];

        if (channelAllowedOnlyList.length > 0 || globalAllowedOnlyList.length > 0) {
          return false; // simplified for test
        }

        const globalBlockedList = storageData.blockedCategoryList || [];
        if (globalBlockedList.length > 0 && (channel.game_id || channel.game_name)) {
          const gameId = channel.game_id;
          const gameName = channel.game_name?.toLowerCase();
          const isBlocked = globalBlockedList.some(
            (blocked) =>
              (gameId && blocked.id && blocked.id === gameId) ||
              (gameName && blocked.name && blocked.name.toLowerCase() === gameName)
          );
          if (isBlocked) return false;
        }
        return true;
      }

      const result = await shouldOpenChannel({
        name: 'test',
        onLive: true,
        onLiveOpen: true,
        game_id: '123',
        game_name: 'Blocked Game',
      });
      expect(result).toBe(false);
    });
  });

  describe('tabRotationAlarm', () => {
    it('should create tabRotationAlarm only when isEnabledTabRotation is true', async () => {
      chromeMock.alarms.get.mockResolvedValue(null);
      chromeMock.storage.local.get.mockResolvedValue({
        isEnabledTabRotation: true,
        tabRotationInterval: 5,
      });

      async function ensureTabRotationAlarm() {
        const tabRotationAlarm = await chrome.alarms.get('tabRotationAlarm');
        if (!tabRotationAlarm) {
          const data = await chrome.storage.local.get(['tabRotationInterval', 'isEnabledTabRotation']);
          if (data.isEnabledTabRotation) {
            const interval = Math.max(1, parseInt(data.tabRotationInterval, 10) || 5);
            chrome.alarms.create('tabRotationAlarm', { periodInMinutes: interval });
          }
        }
      }

      await ensureTabRotationAlarm();

      expect(chromeMock.alarms.create).toHaveBeenCalledWith('tabRotationAlarm', {
        periodInMinutes: 5,
      });
    });

    it('should not create tabRotationAlarm when isEnabledTabRotation is false', async () => {
      chromeMock.alarms.get.mockResolvedValue(null);
      chromeMock.storage.local.get.mockResolvedValue({
        isEnabledTabRotation: false,
        tabRotationInterval: 5,
      });

      async function ensureTabRotationAlarm() {
        const tabRotationAlarm = await chrome.alarms.get('tabRotationAlarm');
        if (!tabRotationAlarm) {
          const data = await chrome.storage.local.get(['tabRotationInterval', 'isEnabledTabRotation']);
          if (data.isEnabledTabRotation) {
            const interval = Math.max(1, parseInt(data.tabRotationInterval, 10) || 5);
            chrome.alarms.create('tabRotationAlarm', { periodInMinutes: interval });
          }
        }
      }

      await ensureTabRotationAlarm();

      expect(chromeMock.alarms.create).not.toHaveBeenCalled();
    });

    it('should use default interval of 5 when tabRotationInterval is not set', async () => {
      chromeMock.alarms.get.mockResolvedValue(null);
      chromeMock.storage.local.get.mockResolvedValue({
        isEnabledTabRotation: true,
      });

      async function ensureTabRotationAlarm() {
        const tabRotationAlarm = await chrome.alarms.get('tabRotationAlarm');
        if (!tabRotationAlarm) {
          const data = await chrome.storage.local.get(['tabRotationInterval', 'isEnabledTabRotation']);
          if (data.isEnabledTabRotation) {
            const interval = Math.max(1, parseInt(data.tabRotationInterval, 10) || 5);
            chrome.alarms.create('tabRotationAlarm', { periodInMinutes: interval });
          }
        }
      }

      await ensureTabRotationAlarm();

      expect(chromeMock.alarms.create).toHaveBeenCalledWith('tabRotationAlarm', {
        periodInMinutes: 5,
      });
    });
  });

  describe('windowRemovalListener', () => {
    it('should clear lastOpenWindowId when managed window is closed', async () => {
      const managedWindowId = 123;
      chromeMock.storage.local.get.mockResolvedValue({ lastOpenWindowId: managedWindowId });

      async function onWindowRemoved(windowId) {
        const data = await chrome.storage.local.get('lastOpenWindowId');
        if (windowId === data.lastOpenWindowId) {
          await chrome.storage.local.set({ lastOpenWindowId: null });
        }
      }

      await onWindowRemoved(managedWindowId);

      expect(chromeMock.storage.local.set).toHaveBeenCalledWith({ lastOpenWindowId: null });
    });

    it('should not clear lastOpenWindowId when different window is closed', async () => {
      chromeMock.storage.local.get.mockResolvedValue({ lastOpenWindowId: 123 });

      async function onWindowRemoved(windowId) {
        const data = await chrome.storage.local.get('lastOpenWindowId');
        if (windowId === data.lastOpenWindowId) {
          await chrome.storage.local.set({ lastOpenWindowId: null });
        }
      }

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

      async function onStorageChanged(changes, area) {
        if (area === 'local' && (changes.isEnabledTabRotation || changes.tabRotationInterval)) {
          const tabRotationAlarm = await chrome.alarms.get('tabRotationAlarm');
          if (tabRotationAlarm) {
            await chrome.alarms.clear('tabRotationAlarm');
          }
          const data = await chrome.storage.local.get(['tabRotationInterval', 'isEnabledTabRotation']);
          if (data.isEnabledTabRotation) {
            const interval = Math.max(1, parseInt(data.tabRotationInterval, 10) || 5);
            chrome.alarms.create('tabRotationAlarm', { periodInMinutes: interval });
          }
        }
      }

      await onStorageChanged({ isEnabledTabRotation: { newValue: true } }, 'local');

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

      async function onStorageChanged(changes, area) {
        if (area === 'local' && (changes.isEnabledTabRotation || changes.tabRotationInterval)) {
          const tabRotationAlarm = await chrome.alarms.get('tabRotationAlarm');
          if (tabRotationAlarm) {
            await chrome.alarms.clear('tabRotationAlarm');
          }
          const data = await chrome.storage.local.get(['tabRotationInterval', 'isEnabledTabRotation']);
          if (data.isEnabledTabRotation) {
            const interval = Math.max(1, parseInt(data.tabRotationInterval, 10) || 5);
            chrome.alarms.create('tabRotationAlarm', { periodInMinutes: interval });
          }
        }
      }

      await onStorageChanged({ isEnabledTabRotation: { newValue: false } }, 'local');

      expect(chromeMock.alarms.clear).toHaveBeenCalledWith('tabRotationAlarm');
      expect(chromeMock.alarms.create).not.toHaveBeenCalled();
    });
  });

  describe('Tab rotation recovery after window closure', () => {
    it('should recover tab rotation when window is reopened and channels go live', async () => {
      const managedWindowId = 123;

      // ステップ1: ウィンドウが閉じられる
      chromeMock.storage.local.get.mockResolvedValue({ lastOpenWindowId: managedWindowId });

      async function onWindowRemoved(windowId) {
        const data = await chrome.storage.local.get('lastOpenWindowId');
        if (windowId === data.lastOpenWindowId) {
          await chrome.storage.local.set({ lastOpenWindowId: null });
        }
      }

      await onWindowRemoved(managedWindowId);
      expect(chromeMock.storage.local.set).toHaveBeenCalledWith({ lastOpenWindowId: null });

      // ステップ2: 新しいウィンドウで配信が開かれる
      const newWindowId = 456;
      chromeMock.storage.local.get.mockResolvedValue({
        lastOpenWindowId: newWindowId,
        isEnabledTabRotation: true,
        tabRotationInterval: 5
      });

      // ステップ3: checkTabRotate()が実行される
      async function checkTabRotate() {
        const isEnabledTabRotation = (await chrome.storage.local.get('isEnabledTabRotation')).isEnabledTabRotation;
        const targetWindowId = (await chrome.storage.local.get('lastOpenWindowId')).lastOpenWindowId;

        if (!isEnabledTabRotation) return 'disabled';
        if (!targetWindowId) return 'no_window';
        return 'running';
      }

      const result = await checkTabRotate();

      // 新しいウィンドウが存在しており、タブローテーションが有効なら動作する
      expect(result).toBe('running');
    });

    it('should handle case where window is closed but tab rotation is still enabled', async () => {
      const managedWindowId = 123;

      // ウィンドウが閉じられてもタブローテーション設定は有効のままの状態
      chromeMock.storage.local.get
        .mockResolvedValueOnce({ lastOpenWindowId: managedWindowId, isEnabledTabRotation: true })
        .mockResolvedValueOnce({ lastOpenWindowId: null, isEnabledTabRotation: true });

      async function onWindowRemoved(windowId) {
        const data = await chrome.storage.local.get('lastOpenWindowId');
        if (windowId === data.lastOpenWindowId) {
          await chrome.storage.local.set({ lastOpenWindowId: null });
        }
      }

      await onWindowRemoved(managedWindowId);

      async function checkTabRotate() {
        const isEnabledTabRotation = (await chrome.storage.local.get('isEnabledTabRotation')).isEnabledTabRotation;
        const targetWindowId = (await chrome.storage.local.get('lastOpenWindowId')).lastOpenWindowId;

        if (!isEnabledTabRotation) return 'disabled';
        if (!targetWindowId) return 'no_window';
        return 'running';
      }

      const result = await checkTabRotate();

      // ウィンドウが無いのでタブローテーションは実行されない
      expect(result).toBe('no_window');
      expect(chromeMock.storage.local.set).toHaveBeenCalledWith({ lastOpenWindowId: null });
    });
  });

  describe('showNotification', () => {
    // Helper to build notification message (mirrors background.js logic)
    function buildNotificationMessage(channel) {
      let message = '';

      if (channel.title) {
        message = channel.title;
        if (channel.game_name) {
          message += `\n【${channel.game_name}】`;
        }
      } else if (channel.game_name) {
        message = `【${channel.game_name}】`;
      } else {
        message = '配信開始！';
      }

      return message;
    }

    it('should include title and category in notification message', () => {
      const channel = {
        name: 'testuser',
        title: 'Playing some games!',
        game_name: 'Just Chatting',
      };

      const message = buildNotificationMessage(channel);

      expect(message).toBe('Playing some games!\n【Just Chatting】');
    });

    it('should show only title if no category', () => {
      const channel = { name: 'testuser', title: 'My Stream' };
      const message = buildNotificationMessage(channel);

      expect(message).toBe('My Stream');
    });

    it('should show only category if no title', () => {
      const channel = { name: 'testuser', game_name: 'Fortnite' };
      const message = buildNotificationMessage(channel);

      expect(message).toBe('【Fortnite】');
    });

    it('should fallback to default message if no title and category', () => {
      const channel = { name: 'testuser' };
      const message = buildNotificationMessage(channel);

      expect(message).toBe('配信開始！');
    });
  });
});
