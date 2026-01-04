import { vi } from 'vitest';

// Chrome API Mock
export function createChromeMock() {
  const storage = {};

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
      local: {
        get: vi.fn((keys) => {
          if (typeof keys === 'string') {
            return Promise.resolve({ [keys]: storage[keys] });
          }
          const result = {};
          for (const key of keys) {
            result[key] = storage[key];
          }
          return Promise.resolve(result);
        }),
        set: vi.fn((data) => {
          Object.assign(storage, data);
          return Promise.resolve();
        }),
      },
      onChanged: {
        addListener: vi.fn(),
      },
    },
    runtime: {
      onStartup: {
        addListener: vi.fn(),
      },
      onInstalled: {
        addListener: vi.fn(),
      },
      lastError: null,
    },
    tabs: {
      query: vi.fn().mockResolvedValue([]),
      create: vi.fn(),
      update: vi.fn(),
      remove: vi.fn(),
      get: vi.fn(),
      onActivated: {
        addListener: vi.fn(),
      },
    },
    windows: {
      create: vi.fn().mockResolvedValue({ id: 1 }),
      get: vi.fn((id, opts, cb) => cb && cb({ id })),
    },
    _storage: storage,
  };
}

// Fetch Mock Helper
export function createFetchMock(responses = {}) {
  return vi.fn((url) => {
    const response = responses[url] || { data: [] };
    return Promise.resolve({
      ok: true,
      json: () => Promise.resolve(response),
    });
  });
}
