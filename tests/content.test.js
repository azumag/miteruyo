import { describe, it, expect, vi } from 'vitest';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

describe('Content Script', () => {
  async function runContentScript({
    chromeOverrides = {},
    path = '/testchannel',
    channels = [],
    videos = [],
  } = {}) {
    const source = await readFile(new URL('../content.js', import.meta.url), 'utf8');
    const asyncErrors = [];
    const sandbox = {
      console: {
        log: vi.fn(),
        error: vi.fn(),
      },
      window: {
        location: { pathname: path, href: `https://www.twitch.tv${path}` },
        addEventListener: vi.fn(),
      },
      location: { href: `https://www.twitch.tv${path}` },
      document: {
        querySelectorAll: vi.fn(() => videos),
      },
      chrome: {
        runtime: { id: 'extension-id' },
        storage: {
          local: {
            get: vi.fn(() => Promise.resolve({ channels })),
          },
          onChanged: {
            addListener: vi.fn(),
          },
        },
        ...chromeOverrides,
      },
      MutationObserver: vi.fn(function MutationObserver(callback) {
        this.callback = callback;
        this.observe = vi.fn();
        this.disconnect = vi.fn();
      }),
      clearInterval: vi.fn(),
      setInterval: vi.fn(() => 123),
      setTimeout: vi.fn((callback) => {
        const result = callback();
        if (result?.catch) {
          result.catch(error => asyncErrors.push(error));
        }
        return 1;
      }),
    };
    sandbox.window.window = sandbox.window;
    sandbox.window.document = sandbox.document;
    sandbox.window.chrome = sandbox.chrome;

    vm.createContext(sandbox);
    vm.runInContext(source, sandbox, { filename: 'content.js' });
    await Promise.resolve();
    await Promise.resolve();

    return { sandbox, asyncErrors };
  }

  it('does not touch volumeInterval before initialization when runtime is invalid', async () => {
    const { sandbox, asyncErrors } = await runContentScript({
      chromeOverrides: {
        runtime: {},
      },
    });

    expect(asyncErrors).toEqual([]);
    expect(sandbox.clearInterval).not.toHaveBeenCalled();
    expect(sandbox.setInterval).toHaveBeenCalledWith(expect.any(Function), 5000);
  });

  it('handles storage changes before interval assignment when runtime is invalid', async () => {
    const addListener = vi.fn((listener) => {
      const result = listener({ channels: {} });
      if (result?.catch) return result.catch(() => {});
      return undefined;
    });

    const { sandbox, asyncErrors } = await runContentScript({
      chromeOverrides: {
        runtime: {},
        storage: {
          local: {
            get: vi.fn(() => Promise.resolve({ channels: [] })),
          },
          onChanged: { addListener },
        },
      },
    });

    expect(asyncErrors).toEqual([]);
    expect(sandbox.clearInterval).not.toHaveBeenCalled();
    expect(sandbox.setInterval).toHaveBeenCalledWith(expect.any(Function), 5000);
  });

  it('skips malformed channel entries when applying custom volume', async () => {
    const video = { volume: 1 };
    const { sandbox, asyncErrors } = await runContentScript({
      path: '/TestChannel',
      videos: [video],
      channels: [
        null,
        {},
        { name: null },
        { name: 42 },
        { name: 'testchannel', enableCustomVolume: true, customVolume: '42' },
      ],
    });

    expect(asyncErrors).toEqual([]);
    expect(sandbox.console.error).not.toHaveBeenCalled();
    expect(video.volume).toBe(0.42);
  });

  it('ignores non-array channel storage data when applying volume settings', async () => {
    const video = { volume: 1 };
    const { sandbox, asyncErrors } = await runContentScript({
      videos: [video],
      channels: { name: 'testchannel', enableCustomVolume: true, customVolume: '42' },
    });

    expect(asyncErrors).toEqual([]);
    expect(sandbox.console.error).not.toHaveBeenCalled();
    expect(video.volume).toBe(1);
  });
});
