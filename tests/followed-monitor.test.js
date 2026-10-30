// tests/followed-monitor.test.js — Issue #151: フォロー中チャンネル監視
// 専用ランタイム状態・1分に1件の分散巡回・手動設定優先・scope検査を pin する。
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createChromeMock } from './setup.js';
import {
  FOLLOWED_CHECK_ALARM,
  FOLLOWED_STATE_KEY,
  fetchFollowedChannels,
  validateTokenScopes,
  syncFollowedChannels,
  ensureFollowedCheckAlarm,
  followedChannelTick,
} from '../background-functions.js';

describe('Followed channels monitoring (Issue #151)', () => {
  let chromeMock;
  let originalChrome;
  let originalFetch;

  beforeEach(() => {
    chromeMock = createChromeMock();
    originalChrome = globalThis.chrome;
    originalFetch = globalThis.fetch;
    globalThis.chrome = chromeMock;
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    globalThis.chrome = originalChrome;
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  function storageWith(overrides = {}) {
    chromeMock.storage.local.get.mockImplementation((keys) => {
      const base = {
        isMonitorAllFollowedChannels: true,
        oauth_token: 'tok',
        channels: [],
        isEnabled: true,
        isEnabledNotifications: true,
        isEnabledMaxTabs: false,
        isEnabledAutoClose: false,
        [FOLLOWED_STATE_KEY]: { lastFollowListRefreshAt: 0, entries: {} },
      };
      const merged = { ...base, ...overrides };
      if (Array.isArray(keys)) {
        return Promise.resolve(Object.fromEntries(keys.map(k => [k, merged[k]])));
      }
      return Promise.resolve(merged);
    });
  }

  it('fetchFollowedChannels paginates with cursor until exhausted', async () => {
    const calls = [];
    globalThis.fetch = vi.fn().mockImplementation((url) => {
      calls.push(url);
      const page = calls.length;
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({
          data: [{ broadcaster_id: `id${page}`, broadcaster_login: `ch${page}` }],
          pagination: page < 2 ? { cursor: `c${page}` } : {},
        }),
      });
    });
    const out = await fetchFollowedChannels('tok', 'u1');
    expect(out).toHaveLength(2);
    expect(calls[0]).toContain('first=100');
    expect(calls[1]).toContain('after=c1');
  });

  it('validateTokenScopes returns user id and scopes', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ user_id: 'u1', scopes: ['user:read:email', 'user:read:follows'] }),
    });
    const out = await validateTokenScopes('tok');
    expect(out.userId).toBe('u1');
    expect(out.scopes).toContain('user:read:follows');
  });

  it('syncFollowedChannels reports needScope when follows scope missing', async () => {
    storageWith();
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ user_id: 'u1', scopes: ['user:read:email'] }),
    });
    const out = await syncFollowedChannels();
    expect(out.needScope).toBe('user:read:follows');
  });

  it('sync adds new follows with staggered nextCheckAt and skips manual channels', async () => {
    storageWith({ channels: [{ name: 'ManualCh' }] });
    globalThis.fetch = vi.fn().mockImplementation((url) => {
      if (url.includes('oauth2/validate')) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ user_id: 'u1', scopes: ['user:read:follows'] }) });
      }
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({
          data: [
            { broadcaster_id: 'm1', broadcaster_login: 'ManualCh' },
            { broadcaster_id: 'f1', broadcaster_login: 'follow1' },
            { broadcaster_id: 'f2', broadcaster_login: 'follow2' },
          ],
          pagination: {},
        }),
      });
    });
    const out = await syncFollowedChannels();
    expect(out.total).toBe(2);
    const saved = chromeMock.storage.local.set.mock.calls
      .map(c => c[0][FOLLOWED_STATE_KEY]).filter(Boolean).pop();
    expect(saved.entries.m1).toBeUndefined();
    expect(saved.entries.f1.login).toBe('follow1');
    // 初回巡回は1分ずつずらされる（一斉実行しない）
    expect(saved.entries.f1.nextCheckAt).not.toBe(saved.entries.f2.nextCheckAt);
    expect(saved.entries.f2.nextCheckAt - saved.entries.f1.nextCheckAt).toBe(60000);
  });

  it('tick processes at most one channel per alarm and schedules random recheck', async () => {
    const now = Date.now();
    storageWith({
      [FOLLOWED_STATE_KEY]: {
        lastFollowListRefreshAt: now,
        entries: {
          a: { login: 'chA', nextCheckAt: now - 1, lastStreamId: null, isLive: false, hasBeenOpened: false, snoozedForCurrentStream: false, consecutiveFailures: 0 },
          b: { login: 'chB', nextCheckAt: now - 1, lastStreamId: null, isLive: false, hasBeenOpened: false, snoozedForCurrentStream: false, consecutiveFailures: 0 },
        },
      },
    });
    const fetchCalls = [];
    globalThis.fetch = vi.fn().mockImplementation((url) => {
      fetchCalls.push(url);
      if (url.includes('/helix/streams')) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ data: [] }) });
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ data: [] }) });
    });
    const out = await followedChannelTick();
    expect(out.checked).toBeDefined();
    // 1回のtickでstreams問い合わせは最大1チャンネル分
    expect(fetchCalls.filter(u => u.includes('/helix/streams'))).toHaveLength(1);
    const saved = chromeMock.storage.local.set.mock.calls
      .map(c => c[0][FOLLOWED_STATE_KEY]).filter(Boolean).pop();
    const checkedId = out.checked === 'chA' ? 'a' : 'b';
    // チェック済みエントリはランダムな次回時刻へ（最小1分）
    expect(saved.entries[checkedId].nextCheckAt).toBeGreaterThan(now + 60000);
  });

  it('tick skips when disabled and removes manual-registered entry', async () => {
    const now = Date.now();
    storageWith({
      isMonitorAllFollowedChannels: true,
      channels: [{ name: 'chA' }],
      [FOLLOWED_STATE_KEY]: {
        lastFollowListRefreshAt: now,
        entries: { a: { login: 'chA', nextCheckAt: now - 1 } },
      },
    });
    globalThis.fetch = vi.fn();
    const out = await followedChannelTick();
    expect(out.skipped).toBe('manual');
    const saved = chromeMock.storage.local.set.mock.calls
      .map(c => c[0][FOLLOWED_STATE_KEY]).filter(Boolean).pop();
    expect(saved.entries.a).toBeUndefined();
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it('disabled setting clears the dedicated alarm', async () => {
    storageWith({ isMonitorAllFollowedChannels: false });
    chromeMock.alarms.get.mockResolvedValue({ name: FOLLOWED_CHECK_ALARM });
    await ensureFollowedCheckAlarm();
    expect(chromeMock.alarms.clear).toHaveBeenCalledWith(FOLLOWED_CHECK_ALARM);
  });

  it('enabled setting creates the dedicated alarm', async () => {
    storageWith();
    chromeMock.alarms.get.mockResolvedValue(undefined);
    await ensureFollowedCheckAlarm();
    expect(chromeMock.alarms.create).toHaveBeenCalledWith(
      FOLLOWED_CHECK_ALARM, { periodInMinutes: 1 });
  });
});
