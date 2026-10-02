import { describe, expect, it, vi } from 'vitest';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const sortValues = ['registered', 'name', 'started_newest', 'started_oldest'];

async function loadSortControls(initialValue = 'registered') {
  const source = await readFile(new URL('../popup.js', import.meta.url), 'utf8');
  const helperSource = source.slice(
    source.indexOf('function normalizeChannelSort('),
    source.indexOf('function compareChannelRows(')
  );
  const buttons = sortValues.map(value => ({
    dataset: { sortValue: value },
    attributes: {},
    setAttribute(name, value) {
      this.attributes[name] = value;
    },
  }));
  const sandbox = {
    channelSort: { value: initialValue },
    channelSortButtons: buttons,
    chrome: { storage: { local: { set: vi.fn() } } },
    sortChannelRows: vi.fn(),
  };

  vm.createContext(sandbox);
  vm.runInContext(
    `${helperSource}\nglobalThis.__testExports = { normalizeChannelSort, syncChannelSortControls, selectChannelSort, handleChannelSortButtonClick, handleChannelSortStorageChange };`,
    sandbox,
    { filename: 'popup.js' }
  );

  return { ...sandbox, ...sandbox.__testExports };
}

describe('Popup sort controls', () => {
  it('preserves all four saved values and falls back to registered order for unknown values', async () => {
    const controls = await loadSortControls();

    for (const value of sortValues) {
      expect(controls.normalizeChannelSort(value)).toBe(value);
    }
    for (const value of [undefined, null, '', 'unknown']) {
      expect(controls.normalizeChannelSort(value)).toBe('registered');
    }
  });

  it('updates the hidden compatibility value and exactly one pressed state', async () => {
    const controls = await loadSortControls();

    for (const value of sortValues) {
      expect(controls.syncChannelSortControls(value)).toBe(value);
      expect(controls.channelSort.value).toBe(value);
      expect(controls.channelSortButtons.map(button => button.attributes['aria-pressed']))
        .toEqual(sortValues.map(candidate => String(candidate === value)));
    }
  });

  it('persists a button selection and resorts the display rows', async () => {
    const controls = await loadSortControls();

    controls.handleChannelSortButtonClick({ currentTarget: controls.channelSortButtons[1] });

    expect(controls.channelSort.value).toBe('name');
    expect(controls.chrome.storage.local.set).toHaveBeenCalledTimes(1);
    expect(controls.chrome.storage.local.set).toHaveBeenCalledWith({ channelSort: 'name' });
    expect(controls.sortChannelRows).toHaveBeenCalledTimes(1);
    expect(controls.channelSortButtons.map(button => button.attributes['aria-pressed']))
      .toEqual(['false', 'true', 'false', 'false']);
  });

  it('syncs external local storage changes without writing them back', async () => {
    const controls = await loadSortControls();

    controls.handleChannelSortStorageChange({ channelSort: { newValue: 'started_oldest' } }, 'local');

    expect(controls.channelSort.value).toBe('started_oldest');
    expect(controls.channelSortButtons.map(button => button.attributes['aria-pressed']))
      .toEqual(['false', 'false', 'false', 'true']);
    expect(controls.sortChannelRows).toHaveBeenCalledTimes(1);
    expect(controls.chrome.storage.local.set).not.toHaveBeenCalled();

    controls.handleChannelSortStorageChange({ channelSort: { newValue: 'name' } }, 'sync');
    expect(controls.channelSort.value).toBe('started_oldest');
  });

  it('renders four native keyboard buttons with localized full sort labels and pressed state', async () => {
    const html = await readFile(new URL('../popup.html', import.meta.url), 'utf8');
    const ja = JSON.parse(await readFile(new URL('../_locales/ja/messages.json', import.meta.url), 'utf8'));
    const en = JSON.parse(await readFile(new URL('../_locales/en/messages.json', import.meta.url), 'utf8'));
    const controlsStart = html.indexOf('id="channelSortControls"');
    const controlsEnd = html.indexOf('</div>', controlsStart);
    const controlsMarkup = html.slice(controlsStart, controlsEnd);

    expect(html).not.toMatch(/<select[^>]*id="channelSort"/);
    expect(html).toContain('<input type="hidden" id="channelSort" value="registered">');
    expect(html).toContain('role="group" aria-labelledby="channelSortLabel"');
    expect(controlsMarkup.match(/<button type="button"/g)).toHaveLength(4);
    expect(controlsMarkup).not.toContain('tabindex="-1"');
    expect(html).toContain('.channel-sort-button:focus-visible');

    for (const value of sortValues) {
      expect(controlsMarkup).toContain(`data-sort-value="${value}"`);
      expect(controlsMarkup).toContain(`data-sort-aria-key="sort_${value}_accessible"`);
    }

    expect(controlsMarkup).toContain('aria-pressed="true"');
    expect(controlsMarkup.match(/aria-pressed="true"/g)).toHaveLength(1);
    expect(ja.sort_started_newest_short.message).toContain('新しい');
    expect(ja.sort_started_oldest_accessible.message).toContain('古い順');
    expect(en.sort_started_newest_accessible.message).toContain('newest');
    expect(en.sort_started_oldest_accessible.message).toContain('oldest');
    expect(html).not.toMatch(/id="channelTable" class="[^"]*table-striped/);
  });
});
