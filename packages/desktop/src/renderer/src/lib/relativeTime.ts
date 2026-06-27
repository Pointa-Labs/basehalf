/**
 * "3 hours ago" / "just now" from an epoch-seconds timestamp. Pure (takes `nowMs`
 * explicitly) so it's deterministic to unit-test. Used by the inline git-blame
 * annotation; English to match the rest of the editor chrome.
 *
 * Direct divisors (floored) rather than a cascading roll-up, so the chosen unit is
 * predictable: e.g. 90 days → "2 months", not a week-rounded surprise.
 */
const MIN = 60;
const HOUR = 3600;
const DAY = 86_400;
const WEEK = 604_800;
const MONTH = 2_629_746; // average Gregorian month in seconds
const YEAR = 31_556_952;

function unit(n: number, name: string): string {
  return `${n} ${name}${n === 1 ? '' : 's'} ago`;
}

export function relativeTime(epochSeconds: number, nowMs: number): string {
  const secs = Math.max(0, Math.round(nowMs / 1000 - epochSeconds));
  if (secs < 10) return 'just now';
  if (secs < MIN) return unit(secs, 'second');
  if (secs < HOUR) return unit(Math.floor(secs / MIN), 'minute');
  if (secs < DAY) return unit(Math.floor(secs / HOUR), 'hour');
  if (secs < WEEK) return unit(Math.floor(secs / DAY), 'day');
  if (secs < MONTH) return unit(Math.floor(secs / WEEK), 'week');
  if (secs < YEAR) return unit(Math.floor(secs / MONTH), 'month');
  return unit(Math.floor(secs / YEAR), 'year');
}
