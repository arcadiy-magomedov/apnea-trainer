import { describe, it, expect } from 'vitest';
import { formatMMSS, parseMMSS } from './format';

describe('formatMMSS', () => {
  it('formats seconds as m:ss', () => {
    expect(formatMMSS(0)).toBe('0:00');
    expect(formatMMSS(65)).toBe('1:05');
    expect(formatMMSS(222)).toBe('3:42');
  });
});

it('parses m:ss duration input', () => {
  expect(parseMMSS('4:30')).toBe(270);
  expect(parseMMSS('0:45')).toBe(45);
});

it('rejects malformed or non-positive durations', () => {
  expect(parseMMSS('4:75')).toBeNull();
  expect(parseMMSS('abc')).toBeNull();
  expect(parseMMSS('0:00')).toBeNull();
  expect(parseMMSS(`${'9'.repeat(400)}:00`)).toBeNull();
});
