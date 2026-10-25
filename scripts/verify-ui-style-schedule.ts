/**
 * Regression checks for the ui-style schedule helpers (day window parsing,
 * overnight windows, effective style resolution).
 * Run: npx tsc -p tsconfig.verify.json && node .tmp-verify/scripts/verify-ui-style-schedule.js
 */
import {
  DEFAULT_DAY_END_MIN,
  DEFAULT_DAY_START_MIN,
  describeDayWindow,
  formatMinutes,
  isDayTime,
  isOvernightWindow,
  normalizeDayMinutes,
  parseTimeToMinutes,
  resolveEffectiveUiStyle,
  uiStyleBackgroundColor,
} from '../src/shared/uiStyle';

function assert(name: string, condition: boolean, detail?: string): void {
  if (!condition) {
    throw new Error(`${name} failed${detail ? `: ${detail}` : ''}`);
  }
  console.log(`  ok ${name}`);
}

/** 本地时间构造，避免时区影响。 */
function at(hours: number, minutes: number): Date {
  return new Date(2026, 0, 1, hours, minutes, 0, 0);
}

console.log('parseTimeToMinutes / formatMinutes');

assert('parses 07:00', parseTimeToMinutes('07:00') === 420);
assert('parses 19:00', parseTimeToMinutes('19:00') === 1140);
assert('parses 00:00', parseTimeToMinutes('00:00') === 0);
assert('parses 23:59', parseTimeToMinutes('23:59') === 1439);
assert('rejects empty string', parseTimeToMinutes('') === null);
assert('rejects hour overflow', parseTimeToMinutes('25:00') === null);
assert('rejects minute overflow', parseTimeToMinutes('07:60') === null);
assert('rejects garbage', parseTimeToMinutes('abc') === null);
assert('rejects missing minutes', parseTimeToMinutes('07') === null);
assert('formats 420', formatMinutes(420) === '07:00');
assert('formats 0', formatMinutes(0) === '00:00');
assert('formats 1439', formatMinutes(1439) === '23:59');
assert(
  'round-trips through parse',
  parseTimeToMinutes(formatMinutes(DEFAULT_DAY_START_MIN)) === DEFAULT_DAY_START_MIN,
);

console.log('\nnormalizeDayMinutes');

assert('keeps valid value', normalizeDayMinutes(600, 420) === 600);
assert('rounds fractional value', normalizeDayMinutes(600.4, 420) === 600);
assert('falls back on NaN', normalizeDayMinutes(Number.NaN, 420) === 420);
assert('falls back on Infinity', normalizeDayMinutes(Number.POSITIVE_INFINITY, 420) === 420);
assert('falls back on negative', normalizeDayMinutes(-1, 420) === 420);
assert('falls back on overflow', normalizeDayMinutes(1440, 420) === 420);
assert('falls back on non-number', normalizeDayMinutes('600', 420) === 420);

console.log('\nisOvernightWindow');

assert('same-day window is not overnight', isOvernightWindow(420, 1140) === false);
assert('cross-midnight window is overnight', isOvernightWindow(1320, 360) === true);

console.log('\nisDayTime (default 07:00-19:00)');

assert('06:59 is night', isDayTime(at(6, 59), DEFAULT_DAY_START_MIN, DEFAULT_DAY_END_MIN) === false);
assert('07:00 is day (start inclusive)', isDayTime(at(7, 0), DEFAULT_DAY_START_MIN, DEFAULT_DAY_END_MIN) === true);
assert('12:00 is day', isDayTime(at(12, 0), DEFAULT_DAY_START_MIN, DEFAULT_DAY_END_MIN) === true);
assert('18:59 is day', isDayTime(at(18, 59), DEFAULT_DAY_START_MIN, DEFAULT_DAY_END_MIN) === true);
assert('19:00 is night (end exclusive)', isDayTime(at(19, 0), DEFAULT_DAY_START_MIN, DEFAULT_DAY_END_MIN) === false);
assert('00:00 is night', isDayTime(at(0, 0), DEFAULT_DAY_START_MIN, DEFAULT_DAY_END_MIN) === false);

console.log('\nisDayTime (overnight 22:00-06:00)');

assert('21:59 is night', isDayTime(at(21, 59), 1320, 360) === false);
assert('22:00 is day', isDayTime(at(22, 0), 1320, 360) === true);
assert('23:59 is day', isDayTime(at(23, 59), 1320, 360) === true);
assert('00:00 is day', isDayTime(at(0, 0), 1320, 360) === true);
assert('05:59 is day', isDayTime(at(5, 59), 1320, 360) === true);
assert('06:00 is night', isDayTime(at(6, 0), 1320, 360) === false);
assert('12:00 is night', isDayTime(at(12, 0), 1320, 360) === false);

console.log('\nisDayTime (empty window)');

assert('identical bounds yield no day time', isDayTime(at(10, 0), 600, 600) === false);

console.log('\nresolveEffectiveUiStyle');

assert(
  'manual aurora stays aurora at noon',
  resolveEffectiveUiStyle('aurora', 420, 1140, false, at(12, 0)) === 'aurora',
);
assert(
  'manual aurora stays aurora at night',
  resolveEffectiveUiStyle('aurora', 420, 1140, false, at(23, 0)) === 'aurora',
);
assert(
  'manual calm stays calm at night',
  resolveEffectiveUiStyle('calm', 420, 1140, false, at(23, 0)) === 'calm',
);
assert(
  'auto is calm inside the day window',
  resolveEffectiveUiStyle('auto', 420, 1140, false, at(10, 0)) === 'calm',
);
assert(
  'auto is aurora outside the day window',
  resolveEffectiveUiStyle('auto', 420, 1140, false, at(22, 0)) === 'aurora',
);
assert(
  'auto respects overnight window',
  resolveEffectiveUiStyle('auto', 1320, 360, false, at(23, 30)) === 'calm',
);
assert(
  'system follows a dark OS theme',
  resolveEffectiveUiStyle('system', 420, 1140, true, at(12, 0)) === 'aurora',
);
assert(
  'system follows a light OS theme',
  resolveEffectiveUiStyle('system', 420, 1140, false, at(12, 0)) === 'calm',
);
assert(
  'system ignores the day window',
  resolveEffectiveUiStyle('system', 420, 1140, true, at(10, 0)) === 'aurora',
);
assert(
  'system ignores an overnight window',
  resolveEffectiveUiStyle('system', 1320, 360, false, at(23, 30)) === 'calm',
);

console.log('\nuiStyleBackgroundColor');

assert('calm uses light backdrop', uiStyleBackgroundColor('calm') === '#f2f4f8');
assert('aurora uses dark backdrop', uiStyleBackgroundColor('aurora') === '#0b1026');

console.log('\ndescribeDayWindow');

assert('describes same-day window', describeDayWindow(420, 1140) === '07:00–19:00');
assert('describes overnight window', describeDayWindow(1320, 360) === '22:00–次日 06:00');

console.log('\nAll ui-style schedule checks passed.');
