import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createChromeMock, createFetchMock } from './setup.js';
import { checkStreams } from '../background-functions.js';

describe('Automatic polling at the tab limit (issue #152)', () => {
  let chromeMock;
  let tabs;
  let originalChrome;
  let originalFetch;

  function liveFetch() {
    return createFetchMock({
      'https://api.twitch.tv/helix/streams?user_login=waiting': {
        data: [{ id: 'new-stream', user_id: '100', game_name: 'Games', tags: [] }],
      },
      'https://api.twitch.tv/helix/channels': {
        data: [{ is_branded_content: false }],
      },
    });
  }

  beforeEach(() => {
    originalChrome = globalThis.chrome;
    originalFetch = globalThis.fetch;
    chromeMock = createChromeMock();
    globalThis.chrome = chromeMock;
    globalThis.fetch = createFetchMock();
    Object.assign(chromeMock._storage, {
      isEnabled: true,
      isEnabledNotifications: false,
      isEnabledMaxTabs: true,
      maxTabCount: 2,
      isOpenMultiTwitch: false,
      isEnabledAutoClose: false,
      oauth_token: 'test-token',
      channels: [{ name: 'waiting', onLive: false, onLiveOpen: true }],
    });
    tabs = [
      { id: 1, url: 'https://www.twitch.tv/occupied_one', windowId: 10 },
      { id: 2, url: 'https://www.twitch.tv/occupied_two', windowId: 20 },
    ];
    chromeMock.tabs.query.mockImplementation(async ({ windowId } = {}) =>
      tabs.filter(tab => windowId === undefined || tab.windowId === windowId));
    chromeMock.tabs.create.mockImplementation(async ({ url, windowId }) => {
      const tab = { id: 100, url, windowId };
      tabs.push(tab);
      return tab;
    });
    chromeMock.tabs.remove.mockImplementation(async id => {
      tabs = tabs.filter(tab => tab.id !== id);
    });
  });

  afterEach(() => {
    globalThis.chrome = originalChrome;
    globalThis.fetch = originalFetch;
    vi.clearAllMocks();
  });

  it.each([2, 3])('does no API work when %i Twitch tabs meet or exceed the limit', async count => {
    if (count === 3) tabs.push({ id: 3, url: 'https://twitch.tv/another' });
    chromeMock._storage.channels.push(null, { name: 'another', onLiveOpen: true });
    const previousChannels = structuredClone(chromeMock._storage.channels);

    await checkStreams({ automatic: true });

    expect(globalThis.fetch).not.toHaveBeenCalled();
    expect(chromeMock.storage.local.set).not.toHaveBeenCalled();
    expect(chromeMock._storage.channels).toEqual(previousChannels);
    expect(chromeMock.tabs.create).not.toHaveBeenCalled();
    expect(chromeMock.windows.create).not.toHaveBeenCalled();
    expect(chromeMock.alarms.clear).not.toHaveBeenCalled();
  });

  it('uses the existing default limit of five when maxTabCount is unset', async () => {
    delete chromeMock._storage.maxTabCount;
    tabs = Array.from({ length: 5 }, (_, id) => ({ id, url: `https://twitch.tv/channel_${id}` }));

    await checkStreams({ automatic: true });

    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it('checks streams below the limit and ignores non-channel or spoofed Twitch tabs', async () => {
    tabs.pop();
    tabs.push(
      { id: 3, url: 'https://example.com/' },
      { id: 4, url: 'https://www.twitch.tv/directory' },
      { id: 5, url: 'https://twitch.tv.evil.example/waiting' },
    );
    globalThis.fetch = liveFetch();

    await checkStreams({ automatic: true });

    expect(globalThis.fetch).toHaveBeenCalledTimes(2);
    expect(chromeMock.tabs.create).toHaveBeenCalledTimes(1);
  });

  it('checks streams when the tab limit is disabled', async () => {
    chromeMock._storage.isEnabledMaxTabs = false;

    await checkStreams({ automatic: true });

    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
  });

  it('resumes on the next automatic check after a tab is closed', async () => {
    globalThis.fetch = liveFetch();
    await checkStreams({ automatic: true });
    expect(globalThis.fetch).not.toHaveBeenCalled();
    tabs.pop();

    await checkStreams({ automatic: true });

    expect(globalThis.fetch).toHaveBeenCalledTimes(2);
    expect(chromeMock.tabs.create).toHaveBeenCalledTimes(1);
  });

  it('does not suppress a manual check when tabs are full', async () => {
    await checkStreams();

    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
  });

  it.each([
    { isEnabled: true, global: true, setting: 'global' },
    { isEnabled: true, global: false, setting: 'on' },
    { isEnabled: false, global: true, setting: 'global' },
    { isEnabled: false, global: false, setting: 'on' },
  ])('keeps notifications working at capacity: %j', async ({ isEnabled, global, setting }) => {
    Object.assign(chromeMock._storage, { isEnabled, isEnabledNotifications: global });
    chromeMock._storage.channels[0].notificationSetting = setting;
    globalThis.fetch = liveFetch();

    await checkStreams({ automatic: true });

    expect(globalThis.fetch).toHaveBeenCalledTimes(2);
    expect(chromeMock.notifications.create).toHaveBeenCalledWith(
      expect.stringMatching(/^miteruyo-live-waiting-/), expect.any(Object),
    );
    expect(chromeMock.tabs.create).not.toHaveBeenCalled();
    expect(chromeMock.windows.create).not.toHaveBeenCalled();
  });

  it('can skip when every channel overrides global notifications to off', async () => {
    chromeMock._storage.isEnabledNotifications = true;
    chromeMock._storage.channels[0].notificationSetting = 'off';

    await checkStreams({ automatic: true });

    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it.each([true, false])('keeps auto-close working with auto-open enabled=%s', async isEnabled => {
    Object.assign(chromeMock._storage, {
      isEnabled,
      isEnabledNotifications: true,
      isEnabledAutoClose: true,
      channels: [{ name: 'occupied_one', onLive: true, onLiveOpen: true, notificationSetting: 'off' }],
    });

    await checkStreams({ automatic: true });

    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
    expect(chromeMock.tabs.remove).toHaveBeenCalledWith(1);
  });

  it.each([false, true])('detects priority streams despite cached current-stream suppression=%s', async suppressed => {
    Object.assign(chromeMock._storage.channels[0], {
      isPriority: true,
      onLive: suppressed,
      streamId: 'old-stream',
      snoozed: suppressed,
      hasBeenOpened: suppressed,
    });
    chromeMock._storage.isAutoOpenOnce = suppressed;
    chromeMock._storage.channels.push({ name: 'occupied_one', onLive: true, onLiveOpen: true });
    globalThis.fetch = liveFetch();

    await checkStreams({ automatic: true });

    expect(chromeMock.tabs.remove).toHaveBeenCalledWith(1);
    expect(chromeMock.tabs.create).toHaveBeenCalledWith({ url: 'https://www.twitch.tv/waiting', windowId: null });
  });

  it('still skips when the priority channel is paused', async () => {
    Object.assign(chromeMock._storage.channels[0], { isPriority: true, onLiveOpen: false });

    await checkStreams({ automatic: true });

    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it('preserves the separate MultiTwitch polling and opening path', async () => {
    chromeMock._storage.isOpenMultiTwitch = true;
    globalThis.fetch = liveFetch();

    await checkStreams({ automatic: true });

    expect(globalThis.fetch).toHaveBeenCalledTimes(2);
    expect(chromeMock.tabs.create).toHaveBeenCalledWith({ url: 'https://multitwitch.tv/waiting', windowId: null });
  });

  it.each([false, true])('rechecks capacity after polling before opening a tab (new window=%s)', async isOpenNewWindow => {
    chromeMock._storage.isOpenNewWindow = isOpenNewWindow;
    tabs.pop();
    const respond = liveFetch();
    globalThis.fetch = vi.fn((...args) => {
      if (tabs.length === 1) tabs.push({ id: 2, url: 'https://twitch.tv/occupied_two' });
      return respond(...args);
    });

    await checkStreams({ automatic: true });

    expect(globalThis.fetch).toHaveBeenCalledTimes(2);
    expect(chromeMock.tabs.create).not.toHaveBeenCalled();
    expect(chromeMock.windows.create).not.toHaveBeenCalled();
  });

  it('skips overlapping automatic checks at capacity without doing API work', async () => {
    await Promise.all([checkStreams({ automatic: true }), checkStreams({ automatic: true })]);

    expect(globalThis.fetch).not.toHaveBeenCalled();
    expect(chromeMock.storage.local.set).not.toHaveBeenCalled();
  });
});
