export function dispatch<T>(name: string, detail: T): void {
  if (typeof CustomEvent !== 'function') {
    return;
  }
  document.dispatchEvent(new CustomEvent(name, { detail }));
}
