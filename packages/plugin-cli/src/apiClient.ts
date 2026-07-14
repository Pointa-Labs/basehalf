import type { ApiEnvelope, StoredSession } from './types.js';

const API_PREFIX = '/plugin-service/api/v1';

export function normalizeServer(value: string): string {
  const url = new URL(value);
  const loopback =
    url.hostname === 'localhost' || url.hostname === '127.0.0.1' || url.hostname === '[::1]';
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback)) {
    throw new Error('Publishing servers must use HTTPS, except local development.');
  }
  if (url.username || url.password || url.search || url.hash) {
    throw new Error('Publishing server URL must not contain credentials, query, or fragment.');
  }
  return url.origin;
}

export class PluginApiClient {
  constructor(
    readonly server: string,
    private readonly session?: StoredSession,
  ) {}

  get<T>(path: string): Promise<T> {
    return this.request<T>('GET', path);
  }

  post<T>(path: string, body?: unknown): Promise<T> {
    return this.request<T>('POST', path, body);
  }

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const response = await fetch(`${this.server}${API_PREFIX}${path}`, {
      method,
      headers: {
        accept: 'application/json',
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
        ...(this.session ? { authorization: `Bearer ${this.session.accessToken}` } : {}),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(30_000),
    });
    let envelope: ApiEnvelope<T> | undefined;
    try {
      envelope = (await response.json()) as ApiEnvelope<T>;
    } catch {
      throw new Error(`Publishing service returned ${response.status} without JSON.`);
    }
    if (!response.ok || envelope.code !== '00000') {
      throw new Error(envelope.message || `Publishing service returned ${response.status}.`);
    }
    return envelope.data;
  }
}
