import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';

describe('design tokens', () => {
  it('defines the deep-ocean palette variables', () => {
    const css = readFileSync('src/ui/design-system/tokens.css', 'utf-8');
    for (const token of [
      '--ocean-900', '--surface', '--cyan', '--teal',
      '--success', '--warn', '--danger', '--text',
    ]) {
      expect(css).toContain(token);
    }
  });
});
