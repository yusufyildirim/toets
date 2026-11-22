import { describe, expect, it, vi } from 'vitest';

import { ApiError, createApiClient, resolveApiRoute } from './client';

const HEADER = 'x-dpad-original-origin';

describe('resolveApiRoute', () => {
  it('uses the real API without a mock URL', () => {
    expect(resolveApiRoute('http://localhost:8091/', undefined, HEADER)).toEqual({
      baseUrl: 'http://localhost:8091',
      headers: {},
      mocked: false,
    });
  });

  it('swaps the origin for the mock server and sends the real origin along', () => {
    expect(resolveApiRoute('https://api.example.com/v2', 'http://localhost:9400', HEADER)).toEqual({
      baseUrl: 'http://localhost:9400/v2',
      headers: { [HEADER]: 'https://api.example.com' },
      mocked: true,
    });
  });
});

describe('createApiClient', () => {
  it('requests through the route with its headers', async () => {
    const fetchImpl = vi.fn(async () => Response.json({ rails: [] }));
    const route = resolveApiRoute('http://localhost:8091', 'http://localhost:9400', HEADER);
    await expect(createApiClient(route, fetchImpl).getCatalog()).resolves.toEqual({ rails: [] });
    expect(fetchImpl).toHaveBeenCalledWith('http://localhost:9400/api/catalog', {
      headers: { accept: 'application/json', [HEADER]: 'http://localhost:8091' },
    });
  });

  it('throws ApiError on HTTP errors', async () => {
    const fetchImpl = vi.fn(async () => new Response('{}', { status: 503 }));
    const client = createApiClient(
      resolveApiRoute('http://localhost:8091', undefined, HEADER),
      fetchImpl,
    );
    await expect(client.getItem('x')).rejects.toBeInstanceOf(ApiError);
  });
});
