import { describe, it, expect, vi } from 'vitest';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

describe('Popup updateList persistence', () => {
  async function loadUpdateList(checkStreamImplementation) {
    const source = await readFile(new URL('../popup.js', import.meta.url), 'utf8');
    const updateListSource = source.slice(
      source.indexOf('async function updateList(dchannels)'),
      source.indexOf('async function addChannelToList')
    );
    const sandbox = {
      normalizeStoredChannels: channels => Array.isArray(channels) ? channels : [],
      checkStream: vi.fn(checkStreamImplementation),
      addChannelToList: vi.fn(),
      chrome: {
        storage: {
local: {
  set: vi.fn(),
},
        },
      },
      console: {
        error: vi.fn(),
      },
    };

    vm.createContext(sandbox);
    vm.runInContext(
      `${updateListSource}\nglobalThis.__testExports = { updateList };`,
      sandbox,
      { filename: 'popup.js' }
    );

    return sandbox;
  }

  it('does not persist undefined entries produced for null stored rows', async () => {
    const validChannel = { name: 'valid_user' };
    const sandbox = await loadUpdateList(async channel => channel ?? undefined);

    await sandbox.__testExports.updateList([validChannel, null]);

    expect(sandbox.checkStream).toHaveBeenCalledTimes(2);
    expect(sandbox.addChannelToList).toHaveBeenCalledTimes(1);
    expect(sandbox.addChannelToList).toHaveBeenCalledWith(validChannel, false, 0);
    expect(sandbox.chrome.storage.local.set).toHaveBeenCalledWith({
      channels: [validChannel],
    });
  });

  it('retains invalid non-null rows as deletable error entries', async () => {
    const malformedChannel = { name: 123 };
    const sandbox = await loadUpdateList(async channel => {
      channel.status = 'error';
      return channel;
    });

    await sandbox.__testExports.updateList([malformedChannel]);

    expect(sandbox.addChannelToList).toHaveBeenCalledWith(malformedChannel, false, 0);
    expect(sandbox.chrome.storage.local.set).toHaveBeenCalledWith({
      channels: [malformedChannel],
    });
  });
});
