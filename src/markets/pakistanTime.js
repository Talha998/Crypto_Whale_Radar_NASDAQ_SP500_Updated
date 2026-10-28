/**
 * Display US market signal timestamps in Pakistan Standard Time (PKT, UTC+05).
 * Binance/Alpaca trade event timestamps arrive as UTC/ISO epoch instants.
 * Twelve Data sends US market candles as New York wall-clock strings without
 * an offset; resolve those with America/New_York to account for DST.
 * Presentation only: no trade time, signal/window calculations are changed.
 */
const PK_ZONE = 'Asia/Karachi';
const NY_ZONE = 'America/New_York';

const pkTimeFormatter = new Intl.DateTimeFormat('en-US', {
  timeZone: PK_ZONE, hour: '2-digit', minute: '2-digit',
  second: '2-digit', hour12: true,
});
const pkDateFormatter = new Intl.DateTimeFormat('en-US', {
  timeZone: PK_ZONE, day: '2-digit', month: 'short', year: 'numeric',
});
const nyWallFormatter = new Intl.DateTimeFormat('en-US', {
  timeZone: NY_ZONE, year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
});
const nyWallPattern = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})$/;

function isValidDate(date) {
  return date instanceof Date && Number.isFinite(date.getTime());
}

/** Convert 'YYYY-MM-DD HH:mm:ss' (New York local wall clock) into UTC. */
export function parseNewYorkMarketTime(value) {
  if (typeof value !== 'string') return null;
  const match = nyWallPattern.exec(value);
  if (!match) return null;
  const [year, month, day, hour, minute, second] = match.slice(1).map(Number);
  const wallUtc = Date.UTC(year, month - 1, day, hour, minute, second);
  if (!Number.isFinite(wallUtc)) return null;

  // During US market hours New York is UTC-4 (EDT) or UTC-5 (EST).
  // Verify the wall clock using Intl rather than assuming one offset all year.
  for (const offsetHours of [4, 5]) {
    const candidate = new Date(wallUtc + offsetHours * 60 * 60 * 1000);
    const parts = Object.fromEntries(
      nyWallFormatter.formatToParts(candidate).map(part => [part.type, part.value]),
    );
    if (Number(parts.year) === year && Number(parts.month) === month &&
        Number(parts.day) === day && Number(parts.hour) === hour &&
        Number(parts.minute) === minute && Number(parts.second) === second) {
      return candidate;
    }
  }
  return null;
}

/** Numeric / ISO trade timestamps are already absolute instants. */
export function toAbsoluteMarketDate(value) {
  if (value == null || value === '') return null;
  if (isValidDate(value)) return value;
  if (typeof value === 'string' && nyWallPattern.test(value)) {
    return parseNewYorkMarketTime(value);
  }
  const date = new Date(value);
  return isValidDate(date) ? date : null;
}

export function formatPakistanTime(value) {
  const date = toAbsoluteMarketDate(value);
  return date ? `${pkTimeFormatter.format(date)} PKT` : '—';
}

export function formatPakistanDate(value) {
  const date = toAbsoluteMarketDate(value);
  return date ? pkDateFormatter.format(date) : '—';
}

export function formatPakistanDateTime(value) {
  const date = toAbsoluteMarketDate(value);
  return date ? `${pkTimeFormatter.format(date)} PKT · ${pkDateFormatter.format(date)}` : '—';
}
