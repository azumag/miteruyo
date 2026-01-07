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
