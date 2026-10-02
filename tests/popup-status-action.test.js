import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(new URL('../popup.js', import.meta.url), 'utf8');
const helperSource = source.slice(
  source.indexOf('function getChannelStatusButtonDisplay('),
  source.indexOf('async function addChannelToList(')
);

function getDisplay(locale, channel, rendersChannelSettings = true) {
  const localeMessages = JSON.parse(readFileSync(
    new URL(`../_locales/${locale}/messages.json`, import.meta.url),
    'utf8'
  ));
  const context = {
    chrome: {
      i18n: {
        getMessage: key => localeMessages[key]?.message ?? key,
      },
    },
  };
  vm.createContext(context);
  vm.runInContext(`${helperSource}; globalThis.getDisplay = getChannelStatusButtonDisplay;`, context);
  return { display: context.getDisplay(channel, rendersChannelSettings), localeMessages };
}

const normalLiveChannel = { status: 'online', onLive: true, onLiveOpen: true, snoozed: false };

describe.each(['ja', 'en'])('Live button action label (%s)', locale => {
  it('shows the localized open action on hover/focus and keeps the accessible action label', () => {
    const { display, localeMessages } = getDisplay(locale, normalLiveChannel);

    expect(display.label).toBe(localeMessages.statusLive.message);
    expect(display.openActionLabel).toBe(localeMessages.openChannelButton.message);
    expect(display.accessibleLabel).toBe(localeMessages.openChannel.message);
  });

  it.each([
    ['offline', { status: 'offline', onLive: false, onLiveOpen: true }, true, 'statusOffline'],
    ['paused live', { status: 'online', onLive: true, onLiveOpen: false, snoozed: false }, true, 'pause'],
    ['snoozed live', { status: 'online', onLive: true, onLiveOpen: true, snoozed: true }, true, 'snoozed'],
    ['not found', { status: 'error', onLive: true, onLiveOpen: true, snoozed: false }, false, 'statusNotFound'],
  ])('does not apply the open hover label to %s state', (_state, channel, canRenderSettings, statusKey) => {
    const { display, localeMessages } = getDisplay(locale, channel, canRenderSettings);

    expect(display.label).toBe(localeMessages[statusKey].message);
    expect(display.openActionLabel).toBeNull();
  });
});

it('keeps the live status button width fixed while swapping its visible label', () => {
  const html = readFileSync(new URL('../popup.html', import.meta.url), 'utf8');
  const statusButtonRule = html.match(/\.channel-status-btn\s*\{([^}]+)\}/)?.[1];

  expect(statusButtonRule).toMatch(/width:\s*72px/);
  expect(statusButtonRule).toMatch(/flex:\s*0 0 72px/);
  expect(html).toContain('content: attr(data-open-action);');
  expect(html).toContain('data-open-action]:focus-visible::after');
});
