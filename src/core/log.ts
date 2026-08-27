import { LOG_PREFIX } from './constants';

export function warn(message: string): void {
  console.warn(LOG_PREFIX + ' ' + message);
}

export function error(message: string, err?: unknown): void {
  const detail = err instanceof Error ? err.message || err : err;
  if (detail === undefined) {
    console.error(LOG_PREFIX + ' ' + message);
    return;
  }
  console.error(LOG_PREFIX + ' ' + message, detail);
}
