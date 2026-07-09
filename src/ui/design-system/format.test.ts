import { describe, it, expect } from 'vitest';
import { formatMMSS } from './format';

describe('formatMMSS', () => {
  it('formats seconds as m:ss', () => {
    expect(formatMMSS(0)).toBe('0:00');
    expect(formatMMSS(65)).toBe('1:05');
    expect(formatMMSS(222)).toBe('3:42');
  });
});
