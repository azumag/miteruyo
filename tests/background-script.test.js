import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createChromeMock } from './setup.js';

const backgroundFunctionsMock = vi.hoisted(() => ({
  ensureAlarmsExist: vi.fn().mockResolvedValue(undefined),
  checkStreams: vi.fn().mockResolvedValue(undefined),
  checkTabRotate: vi.fn().mockResolvedValue(undefined),
  isTwitchChannelPage: vi.fn((url) => {
    try {
      return new URL(url).hostname.endsWith('twitch.tv');
    } catch {
      return false;
    }
  }),
  openInManagedWindow: vi.fn().mockResolvedValue(undefined),
  showNotification: vi.fn(),
  checkOfflineWithTab: vi.fn().mockResolvedValue(false),
  onWindowRemoved: vi.fn().mockResolvedValue(undefined),
  onStorageChangedForTabRotation: vi.fn().mockResolvedValue(undefined),
  onStorageChangedForCheckInterval: vi.fn().mockResolvedValue(undefined),
  onNotificationClicked: vi.fn().mockResolvedValue(undefined),
  restoreAuthExpiredBadge: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../background-functions.js', () => backgroundFunctionsMock);

describe('background.js event handlers', () => {
  let chromeMock;
  let originalChrome;

  async function loadContextMenuHandler() {
    vi.resetModules();
    await import('../background.js');
    return chromeMock.contextMenus.onClicked.addListener.mock.calls[0][0];
  }

  async function loadTabActivatedHandler() {
    vi.resetModules();
    await import('../background.js');
    return chromeMock.tabs.onActivated.addListener.mock.calls[0][0];
  }

  beforeEach(() => {
    chromeMock = createChromeMock();
    originalChrome = globalThis.chrome;
    globalThis.chrome = chromeMock;
    vi.clearAllMocks();
  });

  afterEach(() => {
    globalThis.chrome = originalChrome;
  });

  it('adds a channel from context menu when stored channels is not an array', async () => {
    chromeMock.storage.local.get.mockResolvedValue({ channels: { corrupted: true } });
    const handler = await loadContextMenuHandler();

    await handler({
      menuItemId: 'addToMiteruyo',
      linkUrl: 'https://www.twitch.tv/NewChannel',
    });

    expect(chromeMock.storage.local.set).toHaveBeenCalledWith({
      channels: [{
        name: 'NewChannel',
        categoriesFilter: '',
        tagsFilter: '',
        onLiveOpen: true,
      }],
    });
    expect(backgroundFunctionsMock.checkStreams).toHaveBeenCalledTimes(1);
  });

  it('keeps null filtering when appending a new context menu channel', async () => {
    chromeMock.storage.local.get.mockResolvedValue({
      channels: [
        null,
        { name: 'existing', categoriesFilter: '', tagsFilter: '', onLiveOpen: true },
      ],
    });
    const handler = await loadContextMenuHandler();

    await handler({
      menuItemId: 'addToMiteruyo',
      pageUrl: 'https://www.twitch.tv/another',
    });

    expect(chromeMock.storage.local.set).toHaveBeenCalledWith({
      channels: [
        { name: 'existing', categoriesFilter: '', tagsFilter: '', onLiveOpen: true },
        { name: 'another', categoriesFilter: '', tagsFilter: '', onLiveOpen: true },
      ],
    });
  });

  it('ignores malformed stored channel names when appending a new context menu channel', async () => {
    chromeMock.storage.local.get.mockResolvedValue({
      channels: [
        null,
        { name: 123, categoriesFilter: '', tagsFilter: '', onLiveOpen: true },
        { name: {}, categoriesFilter: '', tagsFilter: '', onLiveOpen: true },
      ],
    });
    const handler = await loadContextMenuHandler();

    await handler({
      menuItemId: 'addToMiteruyo',
      linkUrl: 'https://www.twitch.tv/NewChannel',
    });

    expect(chromeMock.storage.local.set).toHaveBeenCalledWith({
      channels: [
        { name: 123, categoriesFilter: '', tagsFilter: '', onLiveOpen: true },
        { name: {}, categoriesFilter: '', tagsFilter: '', onLiveOpen: true },
        { name: 'NewChannel', categoriesFilter: '', tagsFilter: '', onLiveOpen: true },
      ],
    });
    expect(backgroundFunctionsMock.checkStreams).toHaveBeenCalledTimes(1);
  });

  it('does not add a duplicate context menu channel with different casing', async () => {
    chromeMock.storage.local.get.mockResolvedValue({
      channels: [
        { name: 'testuser', categoriesFilter: '', tagsFilter: '', onLiveOpen: true },
      ],
    });
    const handler = await loadContextMenuHandler();

    await handler({
      menuItemId: 'addToMiteruyo',
      linkUrl: 'https://www.twitch.tv/TestUser',
    });

    expect(chromeMock.storage.local.set).not.toHaveBeenCalled();
    expect(backgroundFunctionsMock.checkStreams).not.toHaveBeenCalled();
  });

  it('clears the managed window state when a managed window is removed', async () => {
    vi.resetModules();
    await import('../background.js');
    const handler = chromeMock.windows.onRemoved.addListener.mock.calls[0][0];

    await handler(42);

    expect(backgroundFunctionsMock.onWindowRemoved).toHaveBeenCalledWith(42);
  });

  it('mutes only Twitch channel tabs when a Twitch tab is activated', async () => {
    chromeMock.storage.local.get.mockResolvedValue({
      lastOpenWindowId: 42,
      isEnabledTabMute: true,
      isEnabledAutoClose: false,
    });
    chromeMock.tabs.query.mockResolvedValue([
      { id: 10, url: 'https://www.twitch.tv/active_channel' },
      { id: 11, url: 'https://www.twitch.tv/inactive_channel' },
      { id: 12, url: 'https://example.com/' },
    ]);
    const handler = await loadTabActivatedHandler();

    await handler({ windowId: 42, tabId: 10 });

    expect(chromeMock.tabs.update).toHaveBeenCalledTimes(2);
    expect(chromeMock.tabs.update).toHaveBeenNthCalledWith(1, 10, { muted: false });
    expect(chromeMock.tabs.update).toHaveBeenNthCalledWith(2, 11, { muted: true });
  });

  it('leaves an active non-Twitch tab unchanged while muting Twitch channel tabs', async () => {
    chromeMock.storage.local.get.mockResolvedValue({
      lastOpenWindowId: 42,
      isEnabledTabMute: true,
      isEnabledAutoClose: false,
    });
    chromeMock.tabs.query.mockResolvedValue([
      { id: 10, url: 'https://www.twitch.tv/channel_one' },
      { id: 11, url: 'https://www.twitch.tv/channel_two' },
      { id: 12, url: 'https://example.com/' },
    ]);
    const handler = await loadTabActivatedHandler();

    await handler({ windowId: 42, tabId: 12 });

    expect(chromeMock.tabs.update).toHaveBeenCalledTimes(2);
    expect(chromeMock.tabs.update).toHaveBeenNthCalledWith(1, 10, { muted: true });
    expect(chromeMock.tabs.update).toHaveBeenNthCalledWith(2, 11, { muted: true });
  });
});
