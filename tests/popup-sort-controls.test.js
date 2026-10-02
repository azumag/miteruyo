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
    querySelector() {
      return { textContent: value };
    },
  }));
  const channelSortControls = { hidden: true };
  const channelSortCurrent = { textContent: 'registered', hidden: false };
  const channelSortToggle = {
    attributes: { 'aria-expanded': 'false' },
    setAttribute(name, value) {
      this.attributes[name] = value;
    },
    focus: vi.fn(),
  };
  const channelSortToggleIcon = { className: 'bi bi-chevron-down' };
  const sandbox = {
    channelSort: { value: initialValue },
    channelSortControls,
    channelSortButtons: buttons,
    channelSortCurrent,
    channelSortToggle,
    channelSortToggleIcon,
    chrome: {
      storage: { local: { set: vi.fn() } },
      i18n: { getMessage: vi.fn(key => key) },
    },
    sortChannelRows: vi.fn(),
  };

  vm.createContext(sandbox);
  vm.runInContext(
    `${helperSource}\nglobalThis.__testExports = { normalizeChannelSort, syncChannelSortControls, selectChannelSort, setChannelSortExpanded, handleChannelSortToggleClick, handleChannelSortKeydown, handleChannelSortButtonClick, handleChannelSortStorageChange };`,
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
      expect(controls.channelSortCurrent.textContent).toBe(value);
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
    expect(controls.channelSortControls.hidden).toBe(true);
    expect(controls.channelSortCurrent.hidden).toBe(false);
    expect(controls.channelSortToggle.attributes['aria-expanded']).toBe('false');
    expect(controls.channelSortToggleIcon.className).toBe('bi bi-chevron-down');
    expect(controls.channelSortToggle.focus).toHaveBeenCalledTimes(1);
  });

  it('syncs external local storage changes without writing them back', async () => {
    const controls = await loadSortControls();

    controls.handleChannelSortStorageChange({ channelSort: { newValue: 'started_oldest' } }, 'local');

    expect(controls.channelSort.value).toBe('started_oldest');
    expect(controls.channelSortButtons.map(button => button.attributes['aria-pressed']))
      .toEqual(['false', 'false', 'false', 'true']);
    expect(controls.sortChannelRows).toHaveBeenCalledTimes(1);
    expect(controls.chrome.storage.local.set).not.toHaveBeenCalled();
    expect(controls.channelSortCurrent.textContent).toBe('started_oldest');

    controls.handleChannelSortStorageChange({ channelSort: { newValue: 'name' } }, 'sync');
    expect(controls.channelSort.value).toBe('started_oldest');
  });

  it('toggles the options repeatedly and updates disclosure accessibility state', async () => {
    const controls = await loadSortControls();

    controls.handleChannelSortToggleClick();
    expect(controls.channelSortControls.hidden).toBe(false);
    expect(controls.channelSortCurrent.hidden).toBe(true);
    expect(controls.channelSortToggle.attributes['aria-expanded']).toBe('true');
    expect(controls.channelSortToggle.attributes['aria-label']).toBe('sortOptionsHide');
    expect(controls.channelSortToggleIcon.className).toBe('bi bi-chevron-up');

    controls.handleChannelSortToggleClick();
    expect(controls.channelSortControls.hidden).toBe(true);
    expect(controls.channelSortCurrent.hidden).toBe(false);
    expect(controls.channelSortToggle.attributes['aria-expanded']).toBe('false');
    expect(controls.channelSortToggle.attributes['aria-label']).toBe('sortOptionsShow');
    expect(controls.channelSortToggleIcon.className).toBe('bi bi-chevron-down');

    controls.handleChannelSortToggleClick();
    expect(controls.channelSortControls.hidden).toBe(false);
  });

  it('closes on Escape and returns focus to the disclosure button', async () => {
    const controls = await loadSortControls();
    const preventDefault = vi.fn();

    controls.handleChannelSortToggleClick();
    controls.handleChannelSortKeydown({ key: 'Escape', preventDefault });

    expect(preventDefault).toHaveBeenCalledTimes(1);
    expect(controls.channelSortControls.hidden).toBe(true);
    expect(controls.channelSortCurrent.hidden).toBe(false);
    expect(controls.channelSortToggle.attributes['aria-expanded']).toBe('false');
    expect(controls.channelSortToggle.focus).toHaveBeenCalledTimes(1);

    controls.handleChannelSortToggleClick();
    controls.handleChannelSortKeydown({ key: 'Enter', preventDefault });
    expect(controls.channelSortControls.hidden).toBe(false);
    expect(preventDefault).toHaveBeenCalledTimes(1);
  });

  it('renders four native keyboard buttons with localized full sort labels and pressed state', async () => {
    const html = await readFile(new URL('../popup.html', import.meta.url), 'utf8');
    const ja = JSON.parse(await readFile(new URL('../_locales/ja/messages.json', import.meta.url), 'utf8'));
    const en = JSON.parse(await readFile(new URL('../_locales/en/messages.json', import.meta.url), 'utf8'));
    const controlsStart = html.indexOf('id="channelSortControls"');
    const controlsEnd = html.indexOf('</div>', controlsStart);
    const controlsMarkup = html.slice(controlsStart, controlsEnd);
    const toggleMarkup = html.match(/<button id="channelSortToggle"[\s\S]*?<\/button>/)?.[0];
    const toolbarStyle = html.match(/\.channel-list-toolbar\s*\{([^}]+)\}/)?.[1];
    const sortButtonStyle = html.match(/\.channel-sort-button\s*\{([^}]+)\}/)?.[1];
    const sortFocusStyle = html.match(/\.channel-sort-button:focus-visible\s*\{([^}]+)\}/)?.[1];

    expect(html).not.toMatch(/<select[^>]*id="channelSort"/);
    expect(html).toContain('<input type="hidden" id="channelSort" value="registered">');
    expect(html).toContain('width: 330px;');
    expect(html).toContain('overflow-x: hidden;');
    expect(html).toContain('class="channel-list-toolbar mt-2"');
    expect(html.indexOf('id="channelSortToggle"')).toBeGreaterThan(html.indexOf('id="liveFilterSwitch"'));
    expect(html.indexOf('id="channelSortToggle"')).toBeLessThan(html.indexOf('class="channel-list-toolbar mt-2"'));
    expect(html).toContain('role="group" aria-labelledby="channelSortLabel" hidden>');
    expect(html).toContain('<span id="channelSortCurrent" class="channel-sort-current" aria-live="polite">');
    expect(toggleMarkup).toContain('type="button"');
    expect(toggleMarkup).toContain('aria-controls="channelSortControls"');
    expect(toggleMarkup).toContain('aria-expanded="false"');
    expect(toggleMarkup).toContain('id="channelSortToggleIcon"');
    expect(toggleMarkup).toContain('bi bi-chevron-down');
    expect(controlsMarkup.match(/<button type="button"/g)).toHaveLength(4);
    expect(controlsMarkup).not.toContain('tabindex="-1"');
    expect(html).toContain('.channel-sort-options[hidden]');
    expect(html).toContain('.channel-sort-toggle:focus-visible');
    expect(html).toContain('.channel-sort-button:focus-visible');
    expect(html).toContain('--popup-focus: #0d6efd;');
    expect(html).toContain('--bs-table-border-color: #e9ecef;');
    expect(html).toContain('grid-template-columns: repeat(4, minmax(0, 1fr));');
    expect(html).toContain('min-height: 26px;');
    expect(html).not.toContain('grid-template-columns: repeat(2, minmax(0, 1fr));');
    expect(toolbarStyle).toContain('width: 100%;');
    expect(toolbarStyle).toContain('min-height: 30px;');
    expect(toolbarStyle).toContain('min-width: 0;');
    expect(sortButtonStyle).toContain('white-space: nowrap;');
    expect(sortFocusStyle).toContain('outline-offset: 1px;');

    for (const value of sortValues) {
      expect(controlsMarkup).toContain(`data-sort-value="${value}"`);
      expect(controlsMarkup).toContain(`data-sort-aria-key="sort_${value}_accessible"`);
    }

    expect(controlsMarkup).toContain('aria-pressed="true"');
    expect(controlsMarkup.match(/aria-pressed="true"/g)).toHaveLength(1);
    expect(ja.sort_started_newest_short.message).toBe('開始・新');
    expect(ja.sort_started_oldest_short.message).toBe('開始・古');
    expect(ja.sort_started_oldest_accessible.message).toContain('古い順');
    expect(en.sort_started_newest_short.message).toBe('Start new');
    expect(en.sort_started_oldest_short.message).toBe('Start old');
    expect(en.sort_started_newest_accessible.message).toContain('newest');
    expect(en.sort_started_oldest_accessible.message).toContain('oldest');
    expect(ja.sortOptionsShow.message).toBe('並び順を展開');
    expect(ja.sortOptionsHide.message).toBe('並び順を閉じる');
    expect(en.sortOptionsShow.message).toBe('Show sort options');
    expect(en.sortOptionsHide.message).toBe('Hide sort options');
    expect(html).not.toMatch(/id="channelTable" class="[^"]*table-striped/);
  });
});
