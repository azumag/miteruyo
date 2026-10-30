import { describe, it, expect, vi } from 'vitest';
import { createHelixBatchFetch } from '../helix-batch-fetch.js';

function jsonResponse(body, init = {}) {
  return new Response(JSON.stringify(body), {
    status: init.status || 200,
    headers: init.headers,
  });
}

const headers = {
  'Client-ID': 'client-id',
  'Authorization': 'Bearer token',
};

describe('createHelixBatchFetch', () => {
  it('batches concurrent stream lookups and fans out per-channel responses', async () => {
    const baseFetch = vi.fn(async (url) => {
      const requestUrl = new URL(url);
      const data = requestUrl.searchParams.getAll('user_login')
        .filter(login => login !== 'offline')
        .map((login, index) => ({
          id: `stream-${index}`,
          user_id: `user-${index}`,
          user_login: login,
        }));
      return jsonResponse({ data, pagination: {} });
    });
    const fetch = createHelixBatchFetch(baseFetch);

    const responses = await Promise.all([
      fetch('https://api.twitch.tv/helix/streams?user_login=Alpha', { headers }),
      fetch('https://api.twitch.tv/helix/streams?user_login=offline', { headers }),
      fetch('https://api.twitch.tv/helix/streams?user_login=Beta', { headers }),
    ]);

    expect(baseFetch).toHaveBeenCalledTimes(1);
    const batchedUrl = new URL(baseFetch.mock.calls[0][0]);
    expect(batchedUrl.searchParams.get('first')).toBe('100');
    expect(batchedUrl.searchParams.getAll('user_login')).toEqual(['Alpha', 'offline', 'Beta']);
    expect((await responses[0].json()).data.map(stream => stream.user_login)).toEqual(['Alpha']);
    expect((await responses[1].json()).data).toEqual([]);
    expect((await responses[2].json()).data.map(stream => stream.user_login)).toEqual(['Beta']);
  });

  it('splits more than 100 concurrent stream lookups into API-sized batches', async () => {
    const baseFetch = vi.fn(async (url) => {
      const requestUrl = new URL(url);
      const data = requestUrl.searchParams.getAll('user_login').map(login => ({
        id: `stream-${login}`,
        user_id: `user-${login}`,
        user_login: login,
      }));
      return jsonResponse({ data, pagination: {} });
    });
    const fetch = createHelixBatchFetch(baseFetch);

    const responses = await Promise.all(
      Array.from({ length: 101 }, (_, index) =>
        fetch(`https://api.twitch.tv/helix/streams?user_login=user_${index}`, { headers })
      )
    );

    expect(baseFetch).toHaveBeenCalledTimes(2);
    expect(new URL(baseFetch.mock.calls[0][0]).searchParams.getAll('user_login')).toHaveLength(100);
    expect(new URL(baseFetch.mock.calls[1][0]).searchParams.getAll('user_login')).toHaveLength(1);
    expect((await responses[100].json()).data[0].user_login).toBe('user_100');
  });

  it('batches channel-information lookups by broadcaster id', async () => {
    const baseFetch = vi.fn(async (url) => {
      const requestUrl = new URL(url);
      const data = requestUrl.searchParams.getAll('broadcaster_id').map(id => ({
        broadcaster_id: id,
        is_branded_content: id === '2',
      }));
      return jsonResponse({ data });
    });
    const fetch = createHelixBatchFetch(baseFetch);

    const [first, second] = await Promise.all([
      fetch('https://api.twitch.tv/helix/channels?broadcaster_id=1', { headers }),
      fetch('https://api.twitch.tv/helix/channels?broadcaster_id=2', { headers }),
    ]);

    expect(baseFetch).toHaveBeenCalledTimes(1);
    const batchedUrl = new URL(baseFetch.mock.calls[0][0]);
    expect(batchedUrl.searchParams.getAll('broadcaster_id')).toEqual(['1', '2']);
    expect((await first.json()).data).toEqual([{ broadcaster_id: '1', is_branded_content: false }]);
    expect((await second.json()).data).toEqual([{ broadcaster_id: '2', is_branded_content: true }]);
  });

  it('does not combine requests that use different authorization headers', async () => {
    const baseFetch = vi.fn(async (url) => {
      const requestUrl = new URL(url);
      const data = requestUrl.searchParams.getAll('user_login').map(login => ({
        id: `stream-${login}`,
        user_id: `user-${login}`,
        user_login: login,
      }));
      return jsonResponse({ data });
    });
    const fetch = createHelixBatchFetch(baseFetch);

    await Promise.all([
      fetch('https://api.twitch.tv/helix/streams?user_login=one', {
        headers: { ...headers, Authorization: 'Bearer token-one' },
      }),
      fetch('https://api.twitch.tv/helix/streams?user_login=two', {
        headers: { ...headers, Authorization: 'Bearer token-two' },
      }),
    ]);

    expect(baseFetch).toHaveBeenCalledTimes(2);
  });

  it('preserves non-success status and headers for every caller', async () => {
    const baseFetch = vi.fn(async () => new Response('unauthorized', {
      status: 401,
      headers: { 'Ratelimit-Reset': '123' },
    }));
    const fetch = createHelixBatchFetch(baseFetch);

    const responses = await Promise.all([
      fetch('https://api.twitch.tv/helix/streams?user_login=one', { headers }),
      fetch('https://api.twitch.tv/helix/streams?user_login=two', { headers }),
    ]);

    expect(baseFetch).toHaveBeenCalledTimes(1);
    for (const response of responses) {
      expect(response.status).toBe(401);
      expect(response.headers.get('Ratelimit-Reset')).toBe('123');
      expect(await response.text()).toBe('unauthorized');
    }
  });

  it('leaves non-batchable Helix requests unchanged', async () => {
    const baseFetch = vi.fn(async () => jsonResponse({ data: [] }));
    const fetch = createHelixBatchFetch(baseFetch);
    const url = 'https://api.twitch.tv/helix/streams?user_id=123';

    await fetch(url, { headers });

    expect(baseFetch).toHaveBeenCalledWith(url, { headers });
  });
});
