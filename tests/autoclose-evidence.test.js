import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { createChromeMock } from './setup.js';
import { checkOfflineWithTab, checkStreams } from '../background-functions.js';

describe('auto-close requires current offline evidence', () => {
  let previousChrome, previousFetch, chrome;
  beforeEach(() => {
    previousChrome = globalThis.chrome; previousFetch = globalThis.fetch;
    chrome = createChromeMock(); globalThis.chrome = chrome;
    Object.assign(chrome._storage, { oauth_token: 'test_token', isEnabled: false,
      isEnabledNotifications: true, isEnabledAutoClose: true, lastOpenWindowId: 10,
      channels: [{ name: 'testuser', onLive: false, status: 'offline' }] });
    chrome.tabs.get.mockResolvedValue({ id: 1, windowId: 10, url: 'https://www.twitch.tv/testuser' });
    chrome.tabs.query.mockResolvedValue([{ id: 1, windowId: 10, url: 'https://www.twitch.tv/testuser' }]);
  });
  afterEach(() => { globalThis.chrome = previousChrome; globalThis.fetch = previousFetch; vi.restoreAllMocks(); });
  it.each([{}, {data: {}}, {data: ''}])('does not interpret malformed response %j as offline on activation', async body => {
    globalThis.fetch = vi.fn()
      .mockResolvedValueOnce({ok: true, json: async () => ({data: [{id: '123'}]})})
      .mockResolvedValueOnce({ok: true, json: async () => body});
    expect(await checkOfflineWithTab(1)).toBe(false);
  });
  it('does not close a currently opened tab using stale offline data after HTTP failure', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({ok: false, status: 500});
    await checkStreams();
    expect(chrome.tabs.remove).not.toHaveBeenCalled();
  });
  it('does not close a tab when stream data is not an array', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({ok: true, json: async () => ({data: {}})});
    await checkStreams();
    expect(chrome.tabs.remove).not.toHaveBeenCalled();
  });
  it('still closes an explicitly observed offline channel', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({ok: true, json: async () => ({data: []})});
    await checkStreams();
    expect(chrome.tabs.remove).toHaveBeenCalledWith(1);
  });
});
