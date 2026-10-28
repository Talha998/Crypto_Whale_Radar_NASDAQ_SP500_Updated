/**
 * Signal history belongs to this browser TAB, not to the live feed.
 * sessionStorage survives refreshes, tab discard/reload and same-tab navigation,
 * but normally ends when the tab is closed. No credentials are stored here.
 */
const STORAGE_KEY = 'crypto-whale-radar:signal-history:session-v1';

function emptyHistory() {
  return {cryptoEvents: [], iexEvents: [], clearedAt: 0};
}

function validEvents(events) {
  return Array.isArray(events)
    ? events.filter(event => event && typeof event.id === 'string' &&
        Number.isFinite(Number(event.time)))
    : [];
}

function getStorage() {
  try {
    return typeof window !== 'undefined' ? window.sessionStorage : null;
  } catch {
    return null;
  }
}

function restore() {
  try {
    const raw = getStorage()?.getItem(STORAGE_KEY);
    if (!raw) return emptyHistory();
    const data = JSON.parse(raw);
    const clearedAt = Number.isFinite(Number(data?.clearedAt))
      ? Math.max(0, Number(data.clearedAt)) : 0;
    return {
      cryptoEvents: validEvents(data.cryptoEvents).filter(e => Number(e.time) > clearedAt),
      iexEvents: validEvents(data.iexEvents).filter(e => Number(e.time) > clearedAt),
      clearedAt,
    };
  } catch (error) {
    console.warn('[WhaleRadar] Could not restore tab signal history:', error);
    return emptyHistory();
  }
}

let history = restore();
let storageWarning = '';

function save() {
  try {
    const storage = getStorage();
    if (storage) storage.setItem(STORAGE_KEY, JSON.stringify(history));
    storageWarning = '';
  } catch (error) {
    storageWarning = 'Browser tab storage is full or disabled. New signals may not survive a reload.';
    console.warn('[WhaleRadar] Tab signal history could not be saved:', error);
  }
}

/**
 * Merge rather than replace: SSE snapshots can contain only the server's
 * recent 150 events, while the browser retains all signals for its session.
 * Incoming updates win for the same ID, except a stale PENDING value must
 * not replace a reaction already measured and saved as READY.
 */
export function mergeSessionSignals(existing = [], incoming = [], clearedAt = history.clearedAt) {
  const map = new Map();
  for (const event of [...validEvents(existing), ...validEvents(incoming)]) {
    if (Number(event.time) <= clearedAt) continue;
    const previous = map.get(event.id);
    if (previous?.reactionStatus === 'READY' && event.reactionStatus === 'PENDING') {
      map.set(event.id, {...previous, ...event, reactionStatus: 'READY',
        reaction30sPct: previous.reaction30sPct, reactionSampleTime: previous.reactionSampleTime});
    } else {
      map.set(event.id, event);
    }
  }
  return [...map.values()].sort((a, b) => Number(b.time) - Number(a.time));
}

export function getCryptoSessionSignals() {
  return [...history.cryptoEvents];
}

export function getIexSessionSignals() {
  return [...history.iexEvents];
}

export function getSignalClearTime() {
  return history.clearedAt;
}

export function getSignalStorageWarning() {
  return storageWarning;
}

export function saveCryptoSessionSignals(events) {
  history.cryptoEvents = mergeSessionSignals([], events);
  save();
}

export function saveIexSessionSignals(events) {
  history.iexEvents = mergeSessionSignals([], events);
  save();
}

/** Clears BOTH sources, including server snapshots older than this action. */
export function clearAllSessionSignals(now = Date.now()) {
  history = {
    cryptoEvents: [],
    iexEvents: [],
    clearedAt: Math.max(history.clearedAt + 1, now),
  };
  save();
  return history.clearedAt;
}
