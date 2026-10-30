const HELIX_BATCH_SIZE = 100;
const TWITCH_API_ORIGIN = 'https://api.twitch.tv';

const BATCHABLE_ENDPOINTS = new Map([
  ['/helix/streams', {
    queryParam: 'user_login',
    responseField: 'user_login',
    caseInsensitive: true,
    includeFirst: true,
  }],
  ['/helix/channels', {
    queryParam: 'broadcaster_id',
    responseField: 'broadcaster_id',
    caseInsensitive: false,
    includeFirst: false,
  }],
]);

const WRAPPED_FETCH_MARKER = Symbol.for('miteruyo.helixBatchFetch.wrapped');

function makeAbortError() {
  if (typeof DOMException === 'function') {
    return new DOMException('The operation was aborted.', 'AbortError');
  }
  const error = new Error('The operation was aborted.');
  error.name = 'AbortError';
  return error;
}

function normalizeHeaders(headersInit) {
  try {
    return [...new Headers(headersInit || {}).entries()]
      .sort(([a], [b]) => a.localeCompare(b));
  } catch {
    return [];
  }
}

function createGroupKey(pathname, headersInit) {
  return JSON.stringify([pathname, normalizeHeaders(headersInit)]);
}

function createResponse(body, sourceResponse) {
  return new Response(body, {
    status: sourceResponse.status,
    statusText: sourceResponse.statusText,
    headers: sourceResponse.headers,
  });
}

function isBatchableRequest(input, init = {}) {
  if (init.method && init.method.toUpperCase() !== 'GET') return null;
  if (typeof input !== 'string' && !(input instanceof URL)) return null;

  let url;
  try {
    url = new URL(String(input));
  } catch {
    return null;
  }

  if (url.origin !== TWITCH_API_ORIGIN) return null;
  const config = BATCHABLE_ENDPOINTS.get(url.pathname);
  if (!config) return null;

  const values = url.searchParams.getAll(config.queryParam);
  if (values.length !== 1 || !values[0]) return null;

  for (const key of url.searchParams.keys()) {
    if (key !== config.queryParam) return null;
  }

  return { url, config, value: values[0] };
}

export function createHelixBatchFetch(baseFetch) {
  if (typeof baseFetch !== 'function') {
    throw new TypeError('baseFetch must be a function');
  }

  const queues = new Map();
  let flushScheduled = false;

  const scheduleFlush = () => {
    if (flushScheduled) return;
    flushScheduled = true;
    queueMicrotask(() => {
      flushScheduled = false;
      const groups = [...queues.values()];
      queues.clear();
      for (const group of groups) {
        const activeEntries = group.entries.filter(entry => !entry.aborted);
        for (let offset = 0; offset < activeEntries.length; offset += HELIX_BATCH_SIZE) {
          void flushBatch(group, activeEntries.slice(offset, offset + HELIX_BATCH_SIZE));
        }
      }
    });
  };

  const flushBatch = async (group, entries) => {
    if (entries.length === 0) return;

    const controller = new AbortController();
    for (const entry of entries) {
      entry.batchController = controller;
      entry.batchEntries = entries;
    }

    const batchUrl = new URL(group.url.origin + group.url.pathname);
    if (group.config.includeFirst) {
      batchUrl.searchParams.set('first', String(HELIX_BATCH_SIZE));
    }
    for (const entry of entries) {
      batchUrl.searchParams.append(group.config.queryParam, entry.value);
    }

    const batchInit = { ...group.init, signal: controller.signal };

    let response;
    let responseText;
    try {
      response = await baseFetch(batchUrl.toString(), batchInit);
      responseText = await response.text();
    } catch (error) {
      for (const entry of entries) {
        if (!entry.aborted) entry.reject(error);
        entry.cleanup();
      }
      return;
    }

    if (!response.ok) {
      for (const entry of entries) {
        if (!entry.aborted) entry.resolve(createResponse(responseText, response));
        entry.cleanup();
      }
      return;
    }

    let parsed;
    try {
      parsed = JSON.parse(responseText);
    } catch {
      for (const entry of entries) {
        if (!entry.aborted) entry.resolve(createResponse(responseText, response));
        entry.cleanup();
      }
      return;
    }

    if (!Array.isArray(parsed?.data)) {
      const body = JSON.stringify(parsed);
      for (const entry of entries) {
        if (!entry.aborted) entry.resolve(createResponse(body, response));
        entry.cleanup();
      }
      return;
    }

    for (const entry of entries) {
      if (!entry.aborted) {
        const expected = group.config.caseInsensitive ? entry.value.toLowerCase() : entry.value;
        const data = parsed.data.filter(item => {
          const raw = item?.[group.config.responseField];
          if (typeof raw !== 'string') return false;
          return (group.config.caseInsensitive ? raw.toLowerCase() : raw) === expected;
        });
        entry.resolve(createResponse(JSON.stringify({ ...parsed, data }), response));
      }
      entry.cleanup();
    }
  };

  return function helixBatchFetch(input, init = {}) {
    const batchable = isBatchableRequest(input, init);
    if (!batchable) return baseFetch(input, init);

    if (init.signal?.aborted) return Promise.reject(makeAbortError());

    const groupKey = createGroupKey(batchable.url.pathname, init.headers);
    let group = queues.get(groupKey);
    if (!group) {
      group = {
        url: batchable.url,
        config: batchable.config,
        init: { ...init },
        entries: [],
      };
      queues.set(groupKey, group);
    }

    return new Promise((resolve, reject) => {
      const signal = init.signal;
      const entry = {
        value: batchable.value,
        resolve,
        reject,
        aborted: false,
        batchController: null,
        batchEntries: null,
        cleanup: () => {},
      };

      const onAbort = () => {
        if (entry.aborted) return;
        entry.aborted = true;
        reject(makeAbortError());
        if (entry.batchController && entry.batchEntries?.every(candidate => candidate.aborted)) {
          entry.batchController.abort();
        }
      };

      if (signal) {
        if (signal.aborted) {
          onAbort();
          return;
        }
        signal.addEventListener('abort', onAbort, { once: true });
        entry.cleanup = () => signal.removeEventListener('abort', onAbort);
      }

      group.entries.push(entry);
      scheduleFlush();
    });
  };
}

export function installHelixBatchFetch(target = globalThis) {
  if (!target) return undefined;
  if (typeof target.fetch !== 'function') {
    throw new TypeError('target.fetch must be a function');
  }

  if (target.fetch[WRAPPED_FETCH_MARKER]) return target.fetch;

  const wrappedFetch = createHelixBatchFetch(target.fetch.bind(target));
  Object.defineProperty(wrappedFetch, WRAPPED_FETCH_MARKER, { value: true });
  target.fetch = wrappedFetch;
  return wrappedFetch;
}
