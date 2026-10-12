// The browser's own settings and marks (stars, notes, filters), in localStorage.

const PREFIX = 'onova-za-imotite:'

export function loadJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(PREFIX + key)
    if (raw == null) return fallback
    return (JSON.parse(raw) as T | null) ?? fallback
  } catch {
    return fallback
  }
}

export function saveJson(key: string, value: unknown) {
  try {
    localStorage.setItem(PREFIX + key, JSON.stringify(value))
  } catch {
    /* private mode / quota */
  }
}
