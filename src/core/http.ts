import type { RequestOptions } from '../types/public';

export function postJSON<T>(url: string, data: unknown, options?: RequestOptions): Promise<T> {
  return fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(data),
    keepalive: !!(options && options.keepalive),
  }).then((response) => {
    if (!response.ok) {
      return response.text().then((text): never => {
        throw new Error('API ' + response.status + ': ' + text);
      });
    }
    return response.json() as Promise<T>;
  });
}
