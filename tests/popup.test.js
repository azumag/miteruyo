import { describe, it, expect, vi } from 'vitest';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

describe('Popup Script', () => {
  async function loadPopupTestExports() {
    const source = await readFile(new URL('../popup.js', import.meta.url), 'utf8');
    const helperSource = source.slice(
      source.indexOf('function parseCategoryOptionValue'),
      source.indexOf('// Category search using Twitch API')
    );
    const sandbox = {
      console: {
        error: vi.fn(),
      }
    };

    vm.createContext(sandbox);
    vm.runInContext(
      `${helperSource}\nglobalThis.__testExports = { parseCategoryOptionValue };`,
      sandbox,
      { filename: 'popup.js' }
    );

    return sandbox;
  }

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
});
