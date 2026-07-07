import { vi } from 'vitest';

// Chrome API Mock
export function createChromeMock() {
  const storage = {};
  const sessionStorage = {};
  const createStorageArea = (targetStorage) => ({
    get: vi.fn((keys) => {
      if (typeof keys === 'string') {
        return Promise.resolve({ [keys]: targetStorage[keys] });
      }
      const result = {};
      for (const key of keys) {
        result[key] = targetStorage[key];
      }
      return Promise.resolve(result);
    }),
    set: vi.fn((data) => {
      Object.assign(targetStorage, data);
      return Promise.resolve();
    }),
  });

  return {
    alarms: {
      create: vi.fn(),
      get: vi.fn().mockResolvedValue(null),
      clear: vi.fn(),
      onAlarm: {
        addListener: vi.fn(),
      },
    },
    storage: {
      local: createStorageArea(storage),
      session: createStorageArea(sessionStorage),
      onChanged: {
        addListener: vi.fn(),
      },
    },
    runtime: {
      onStartup: { addListener: vi.fn() },
      onInstalled: { addListener: vi.fn() },
      onMessage: { addListener: vi.fn() },
      lastError: null,
      getURL: vi.fn((path) => `chrome-extension://mock-id/${path}`),
    },
    tabs: {
      query: vi.fn().mockResolvedValue([]),
      create: vi.fn(),
      update: vi.fn(),
      remove: vi.fn().mockResolvedValue(undefined),
      get: vi.fn(),
      sendMessage: vi.fn().mockResolvedValue(undefined),
      onActivated: {
        addListener: vi.fn(),
      },
      onRemoved: {
        addListener: vi.fn(),
      },
    },
    windows: {
      create: vi.fn().mockResolvedValue({ id: 1 }),
      get: vi.fn().mockResolvedValue({ id: 1 }),
      onRemoved: { addListener: vi.fn() },
    },
    notifications: {
      create: vi.fn(),
      clear: vi.fn(),
      getAll: vi.fn((cb) => cb && cb({})),
      onClicked: {
        addListener: vi.fn(),
      },
    },
    contextMenus: {
      create: vi.fn(),
      onClicked: {
        addListener: vi.fn(),
      },
    },
    i18n: {
      getMessage: vi.fn((key, substitutions) => {
        const messages = {
          'notificationTitle': '配信開始！',
          'notificationBody': '$1 が配信を開始しました！',
          'openWithMiteruyo': 'Miteruyoで開く',
          'addToMiteruyo': 'Miteruyoに追加',
        };
        let message = messages[key] || key;
        if (substitutions) {
          const subs = Array.isArray(substitutions) ? substitutions : [substitutions];
          for (let i = 0; i < subs.length; i++) {
            message = message.replace(`$${i + 1}`, subs[i]);
          }
        }
        return message;
      }),
    },
    _storage: storage,
    _sessionStorage: sessionStorage,
  };
}

// Fetch Mock Helper
export function createFetchMock(responses = {}) {
  return vi.fn((url, options) => {
    // Support AbortController signal
    if (options?.signal?.aborted) {
      return Promise.reject(new DOMException('Aborted', 'AbortError'));
    }

    // Find matching response by URL prefix
    let response = responses[url];
    if (!response) {
      // Try prefix matching for URLs with query params
      for (const [key, val] of Object.entries(responses)) {
        if (url.startsWith(key) || url === key) {
          response = val;
          break;
        }
      }
    }
    response = response || { data: [] };

    return Promise.resolve({
      ok: true,
      status: 200,
      json: () => Promise.resolve(response),
    });
  });
}
